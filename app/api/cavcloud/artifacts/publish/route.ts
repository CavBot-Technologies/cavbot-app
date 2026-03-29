import { NextResponse } from "next/server";
import { revalidatePath, unstable_noStore as noStore } from "next/cache";

import crypto from "crypto";
import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import type { PublicArtifactVisibility } from "@prisma/client";

import { auditLogWrite } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudArtifactPublishedState } from "@/lib/cavcloud/notifications.server";
import { getCavCloudSettings } from "@/lib/cavcloud/settings.server";
import { putCavcloudObject, putCavcloudObjectStream } from "@/lib/cavcloud/r2.server";
import { writeCavCloudOperationLog } from "@/lib/cavcloud/operationLog.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { notifyCavSafeEvidencePublished } from "@/lib/cavsafe/notifications.server";
import { writeCavSafeOperationLog } from "@/lib/cavsafe/operationLog.server";
import { getCavsafeObjectStream } from "@/lib/cavsafe/r2.server";
import { resolveCavSafeEvidenceDefaults } from "@/lib/cavsafe/settings.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { readSanitizedJson, readSanitizedFormData } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore<T>(body: T, init?: { status?: number; headers?: Record<string, string> }) {
  noStore();
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

function safeFilename(name: string) {
  const n = String(name || "").trim();
  const cleaned = n.replace(/[\\/\u0000\r\n"]/g, "_").slice(0, 200);
  return cleaned || "artifact";
}

function basename(path: string) {
  const p = String(path || "");
  const parts = p.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function extUpper(filename: string) {
  const n = String(filename || "");
  const idx = n.lastIndexOf(".");
  if (idx === -1) return "FILE";
  const e = n.slice(idx + 1).trim().toUpperCase();
  return e || "FILE";
}

function parseVisibility(raw: unknown): PublicArtifactVisibility | null {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "PRIVATE") return "PRIVATE";
  if (v === "LINK_ONLY") return "LINK_ONLY";
  if (v === "PUBLIC_PROFILE") return "PUBLIC_PROFILE";
  return null;
}

function parsePublishExpiryDays(raw: unknown, fallbackDays = 0): 0 | 1 | 7 | 30 | null {
  const n = Number(raw == null || raw === "" ? fallbackDays : raw);
  if (!Number.isFinite(n)) return null;
  const value = Math.trunc(n);
  if (value === 0 || value === 1 || value === 7 || value === 30) return value;
  return null;
}

function resolvePublishExpiresAt(visibility: PublicArtifactVisibility, days: 0 | 1 | 7 | 30): Date | null {
  if (visibility === "PRIVATE") return null;
  if (days === 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
const MAX_DB_ARTIFACT_SIZE = 2_147_483_647;

type PublishJsonBody = {
  fileId?: unknown;
  folderId?: unknown;
  title?: unknown;
  typeLabel?: unknown;
  visibility?: unknown;
  expiresInDays?: unknown;
};

function intSizeFromBigInt(value: bigint): number {
  if (value <= BigInt(0)) return 0;
  const max = BigInt(MAX_DB_ARTIFACT_SIZE);
  if (value > max) return MAX_DB_ARTIFACT_SIZE;
  return Number(value);
}

function missingCavcloudR2EnvVars(): string[] {
  const missing: string[] = [];
  if (!String(process.env.CAVCLOUD_R2_ENDPOINT || "").trim()) missing.push("CAVCLOUD_R2_ENDPOINT");
  if (!String(process.env.CAVCLOUD_R2_ACCESS_KEY_ID || "").trim()) missing.push("CAVCLOUD_R2_ACCESS_KEY_ID");
  if (!String(process.env.CAVCLOUD_R2_SECRET_ACCESS_KEY || "").trim()) missing.push("CAVCLOUD_R2_SECRET_ACCESS_KEY");
  if (!String(process.env.CAVCLOUD_R2_BUCKET || "").trim()) missing.push("CAVCLOUD_R2_BUCKET");
  return missing;
}

function readClientIp(req: Request): string {
  const direct =
    String(req.headers.get("cf-connecting-ip") || "").trim() ||
    String(req.headers.get("true-client-ip") || "").trim() ||
    String(req.headers.get("x-real-ip") || "").trim();
  if (direct) return direct;
  const forwarded = String(req.headers.get("x-forwarded-for") || "").trim();
  if (!forwarded) return "";
  return String(forwarded.split(",")[0] || "").trim();
}

async function copyCavsafeObjectToArtifact(args: {
  sourceKey: string;
  destinationKey: string;
  mimeType: string;
  bytes: bigint;
}) {
  const source = await getCavsafeObjectStream({ objectKey: args.sourceKey });
  if (!source) throw Object.assign(new Error("CAVSAFE_SOURCE_NOT_FOUND"), { status: 404 });

  const body = Readable.fromWeb(source.body as unknown as NodeReadableStream<Uint8Array>);
  const contentLength = Number(args.bytes);
  await putCavcloudObjectStream({
    objectKey: args.destinationKey,
    body,
    contentType: String(args.mimeType || source.contentType || "application/octet-stream").trim(),
    contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
  });
}

async function writeArtifactOperation(args: {
  accountId: string;
  operatorUserId: string;
  artifactId: string;
  sourcePath: string;
  fileId?: string | null;
  visibility: PublicArtifactVisibility;
  kind: "ARTIFACT_PUBLISHED" | "UNPUBLISHED_ARTIFACT";
}) {
  const action = args.kind === "UNPUBLISHED_ARTIFACT" ? "artifact.unpublish" : "artifact.publish";
  try {
    await prisma.cavCloudActivity.create({
      data: {
        accountId: args.accountId,
        operatorUserId: args.operatorUserId,
        action,
        targetType: "artifact",
        targetId: args.artifactId,
        targetPath: args.sourcePath,
        metaJson: {
          fileId: args.fileId || null,
          visibility: args.visibility,
        },
      },
    });
  } catch {
    // Non-blocking activity write.
  }

  await auditLogWrite({
    accountId: args.accountId,
    operatorUserId: args.operatorUserId,
    action: "PROJECT_UPDATED",
    actionLabel: args.kind === "UNPUBLISHED_ARTIFACT" ? "Artifact unpublished" : "Artifact published",
    targetType: "artifact",
    targetId: args.artifactId,
    targetLabel: args.sourcePath || args.artifactId,
    metaJson: {
      source: "api/cavcloud/artifacts/publish",
      kind: args.kind,
      fileId: args.fileId || null,
      visibility: args.visibility,
    },
  });

  await writeCavCloudOperationLog({
    accountId: args.accountId,
    operatorUserId: args.operatorUserId,
    kind: args.kind,
    subjectType: "artifact",
    subjectId: args.artifactId,
    label: args.sourcePath || args.artifactId,
    meta: {
      fileId: args.fileId || null,
      visibility: args.visibility,
    },
  });

  try {
    await notifyCavCloudArtifactPublishedState({
      accountId: args.accountId,
      userId: args.operatorUserId,
      published: args.kind === "ARTIFACT_PUBLISHED",
      artifactLabel: args.sourcePath || args.artifactId,
      visibility: args.visibility,
      href: "/cavcloud",
    });
  } catch {
    // Non-blocking notification write.
  }
}

export async function POST(req: Request) {
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return jsonNoStore(
        { ok: false, error: "BAD_CSRF", message: "Missing request integrity token." },
        { status: 403 }
      );
    }

    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);
    const userId = String(sess.sub);
    const accountId = String(sess.accountId || "").trim();

    const userRate = consumeInMemoryRateLimit({
      key: `artifact-publish:user:${userId}`,
      limit: 40,
      windowMs: 60_000,
    });
    if (!userRate.allowed) {
      return jsonNoStore(
        { ok: false, error: "RATE_LIMITED", message: "Too many publish requests. Please retry shortly." },
        { status: 429, headers: { "Retry-After": String(userRate.retryAfterSec) } }
      );
    }
    const ip = readClientIp(req);
    if (ip) {
      const ipRate = consumeInMemoryRateLimit({
        key: `artifact-publish:ip:${ip}`,
        limit: 120,
        windowMs: 60_000,
      });
      if (!ipRate.allowed) {
        return jsonNoStore(
          { ok: false, error: "RATE_LIMITED", message: "Too many publish requests from this network." },
          { status: 429, headers: { "Retry-After": String(ipRate.retryAfterSec) } }
        );
      }
    }

    await assertCavCloudActionAllowed({
      accountId,
      userId,
      action: "PUBLISH_ARTIFACT",
      errorCode: "UNAUTHORIZED",
    });
    const settings = await getCavCloudSettings({ accountId, userId });
    const contentType = String(req.headers.get("content-type") || "").toLowerCase();

    if (contentType.includes("application/json")) {
      const body = (await readSanitizedJson(req, null)) as PublishJsonBody | null;
      if (!body) return jsonNoStore({ ok: false, message: "Invalid JSON body." }, { status: 400 });

      const fileId = String(body.fileId || "").trim();
      const folderId = String(body.folderId || "").trim();
      if (!fileId && !folderId) return jsonNoStore({ ok: false, message: "fileId or folderId is required." }, { status: 400 });
      if (fileId && folderId) return jsonNoStore({ ok: false, message: "Pass exactly one of fileId or folderId." }, { status: 400 });

      const cloudVisibility = parseVisibility(body.visibility || "LINK_ONLY");
      if (!cloudVisibility) return jsonNoStore({ ok: false, message: "Invalid visibility." }, { status: 400 });
      const cloudPublishExpiryDays = parsePublishExpiryDays(body.expiresInDays, settings.publishDefaultExpiryDays);
      if (cloudPublishExpiryDays == null) {
        return jsonNoStore({ ok: false, message: "expiresInDays must be 0, 1, 7, or 30." }, { status: 400 });
      }

      if (folderId) {
        const folder = await prisma.cavCloudFolder.findFirst({
          where: {
            id: folderId,
            accountId,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            path: true,
          },
        });
        if (!folder) return jsonNoStore({ ok: false, message: "Folder not found." }, { status: 404 });

        await assertCavCloudActionAllowed({
          accountId,
          userId,
          action: "PUBLISH_ARTIFACT",
          resourceType: "FOLDER",
          resourceId: folder.id,
          neededPermission: "VIEW",
          errorCode: "UNAUTHORIZED",
        });

        const displayTitle = String(body.title || folder.name || "").trim().slice(0, 140) || folder.name;
        const publishedAt = cloudVisibility === "PRIVATE" ? null : new Date();
        const expiresAt = resolvePublishExpiresAt(cloudVisibility, cloudPublishExpiryDays);

        const artifact = await prisma.publicArtifact.upsert({
          where: {
            userId_sourcePath: {
              userId,
              sourcePath: folder.path,
            },
          },
          create: {
            userId,
            sourcePath: folder.path,
            displayTitle,
            type: "FOLDER",
            storageKey: "",
            mimeType: "application/x-directory",
            sizeBytes: 0,
            sha256: null,
            visibility: cloudVisibility,
            publishedAt,
            expiresAt,
          },
          update: {
            displayTitle,
            type: "FOLDER",
            storageKey: "",
            mimeType: "application/x-directory",
            sizeBytes: 0,
            sha256: null,
            visibility: cloudVisibility,
            publishedAt,
            expiresAt,
          },
          select: {
            id: true,
            sourcePath: true,
            displayTitle: true,
            type: true,
            visibility: true,
            publishedAt: true,
            expiresAt: true,
            storageKey: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            updatedAt: true,
          },
        });

        await writeArtifactOperation({
          accountId,
          operatorUserId: userId,
          artifactId: artifact.id,
          sourcePath: folder.path,
          fileId: null,
          visibility: artifact.visibility,
          kind: artifact.visibility === "PRIVATE" ? "UNPUBLISHED_ARTIFACT" : "ARTIFACT_PUBLISHED",
        });

        try {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { username: true },
          });
          const username = String(user?.username || "").trim();
          if (username) {
            revalidatePath(`/u/${username}`);
            revalidatePath(`/${username}`);
          }
        } catch {
          // Best-effort cache invalidation.
        }

        return jsonNoStore(
          {
            ok: true,
            artifact: {
              id: artifact.id,
              sourcePath: artifact.sourcePath,
              displayTitle: artifact.displayTitle,
              type: artifact.type,
              visibility: artifact.visibility,
              publishedAtISO: artifact.publishedAt ? new Date(artifact.publishedAt).toISOString() : null,
              expiresAtISO: artifact.expiresAt ? new Date(artifact.expiresAt).toISOString() : null,
              storageKey: artifact.storageKey,
              mimeType: artifact.mimeType,
              sizeBytes: artifact.sizeBytes,
              sha256: artifact.sha256,
              updatedAtISO: artifact.updatedAt ? new Date(artifact.updatedAt).toISOString() : null,
            },
          },
          { status: 200 }
        );
      }

      const cloudFile = await prisma.cavCloudFile.findFirst({
        where: {
          id: fileId,
          accountId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          path: true,
          r2Key: true,
          mimeType: true,
          bytes: true,
          sha256: true,
        },
      });
      if (cloudFile?.id) {
        await assertCavCloudActionAllowed({
          accountId,
          userId,
          action: "PUBLISH_ARTIFACT",
          resourceType: "FILE",
          resourceId: cloudFile.id,
          neededPermission: "VIEW",
          errorCode: "UNAUTHORIZED",
        });
      }
      if (!cloudFile) {
        const safeFile = await prisma.cavSafeFile.findFirst({
          where: {
            id: fileId,
            accountId,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            path: true,
            r2Key: true,
            mimeType: true,
            bytes: true,
            sha256: true,
          },
        });
        if (!safeFile) return jsonNoStore({ ok: false, message: "File not found." }, { status: 404 });

        // CavSafe publishing is owner-only and Premium+ aware via CavSafe guard.
        const cavsafeSess = await requireCavsafeOwnerSession(req);
        const safeDefaults = await resolveCavSafeEvidenceDefaults({
          accountId,
          userId,
          premiumPlus: cavsafeSess.cavsafePremiumPlus,
        });
        const safeVisibility = parseVisibility(
          body.visibility == null || body.visibility === ""
            ? safeDefaults.visibility
            : body.visibility,
        );
        if (!safeVisibility) return jsonNoStore({ ok: false, message: "Invalid visibility." }, { status: 400 });
        const safePublishExpiryDays = parsePublishExpiryDays(body.expiresInDays, safeDefaults.expiresInDays);
        if (safePublishExpiryDays == null) {
          return jsonNoStore({ ok: false, message: "expiresInDays must be 0, 1, 7, or 30." }, { status: 400 });
        }

        const displayTitle = String(body.title || safeFile.name || "").trim().slice(0, 140) || safeFile.name;
        const type = String(body.typeLabel || "").trim().slice(0, 32) || extUpper(safeFile.name);
        const publishedAt = safeVisibility === "PRIVATE" ? null : new Date();
        const expiresAt = resolvePublishExpiresAt(safeVisibility, safePublishExpiryDays);

        const artifactRef = await prisma.publicArtifact.upsert({
          where: {
            userId_sourcePath: {
              userId,
              sourcePath: safeFile.path,
            },
          },
          create: {
            userId,
            sourcePath: safeFile.path,
            displayTitle,
            type,
            visibility: "PRIVATE",
            publishedAt: null,
            storageKey: "",
            mimeType: "application/octet-stream",
            sizeBytes: 0,
            sha256: null,
          },
          update: {
            displayTitle,
            type,
          },
          select: {
            id: true,
          },
        });

        const artifactStorageKey = `a/${artifactRef.id}/${safeFilename(safeFile.name)}`;
        await copyCavsafeObjectToArtifact({
          sourceKey: safeFile.r2Key,
          destinationKey: artifactStorageKey,
          mimeType: String(safeFile.mimeType || "").trim() || "application/octet-stream",
          bytes: safeFile.bytes,
        });

        const artifact = await prisma.publicArtifact.update({
          where: { id: artifactRef.id },
          data: {
            displayTitle,
            type,
            storageKey: artifactStorageKey,
            mimeType: String(safeFile.mimeType || "").trim() || "application/octet-stream",
            sizeBytes: intSizeFromBigInt(safeFile.bytes),
            sha256: String(safeFile.sha256 || "").trim() || null,
            visibility: safeVisibility,
            publishedAt,
            expiresAt,
          },
          select: {
            id: true,
            sourcePath: true,
            displayTitle: true,
            type: true,
            visibility: true,
            publishedAt: true,
            expiresAt: true,
            storageKey: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            updatedAt: true,
          },
        });

        await writeArtifactOperation({
          accountId,
          operatorUserId: userId,
          artifactId: artifact.id,
          sourcePath: safeFile.path,
          fileId: safeFile.id,
          visibility: artifact.visibility,
          kind: artifact.visibility === "PRIVATE" ? "UNPUBLISHED_ARTIFACT" : "ARTIFACT_PUBLISHED",
        });
        await writeCavSafeOperationLog({
          accountId,
          operatorUserId: userId,
          kind: "PUBLISH_ARTIFACT",
          subjectType: "file",
          subjectId: safeFile.id,
          label: "CavSafe artifact published",
          meta: {
            artifactId: artifact.id,
            visibility: artifact.visibility,
          },
        });
        if (artifact.visibility !== "PRIVATE") {
          try {
            await notifyCavSafeEvidencePublished({
              accountId,
              userId,
              artifactLabel: artifact.displayTitle || safeFile.path,
              visibility: artifact.visibility,
              href: "/cavsafe",
            });
          } catch {
            // Non-blocking notification write.
          }
        }

        try {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { username: true },
          });
          const username = String(user?.username || "").trim();
          if (username) {
            revalidatePath(`/u/${username}`);
            revalidatePath(`/${username}`);
          }
        } catch {
          // Best-effort cache invalidation.
        }

        return jsonNoStore(
          {
            ok: true,
            artifact: {
              id: artifact.id,
              sourcePath: artifact.sourcePath,
              displayTitle: artifact.displayTitle,
              type: artifact.type,
              visibility: artifact.visibility,
              publishedAtISO: artifact.publishedAt ? new Date(artifact.publishedAt).toISOString() : null,
              expiresAtISO: artifact.expiresAt ? new Date(artifact.expiresAt).toISOString() : null,
              storageKey: artifact.storageKey,
              mimeType: artifact.mimeType,
              sizeBytes: artifact.sizeBytes,
              sha256: artifact.sha256,
              updatedAtISO: artifact.updatedAt ? new Date(artifact.updatedAt).toISOString() : null,
            },
          },
          { status: 200 }
        );
      }

      const file = cloudFile;

      const displayTitle = String(body.title || file.name || "").trim().slice(0, 140) || file.name;
      const type = String(body.typeLabel || "").trim().slice(0, 32) || extUpper(file.name);
      const publishedAt = cloudVisibility === "PRIVATE" ? null : new Date();
      const expiresAt = resolvePublishExpiresAt(cloudVisibility, cloudPublishExpiryDays);

      const artifact = await prisma.publicArtifact.upsert({
        where: {
          userId_sourcePath: {
            userId,
            sourcePath: file.path,
          },
        },
        create: {
          userId,
          sourcePath: file.path,
          displayTitle,
          type,
          storageKey: String(file.r2Key || "").trim(),
          mimeType: String(file.mimeType || "").trim() || "application/octet-stream",
          sizeBytes: intSizeFromBigInt(file.bytes),
          sha256: String(file.sha256 || "").trim() || null,
          visibility: cloudVisibility,
          publishedAt,
          expiresAt,
        },
        update: {
          displayTitle,
          type,
          storageKey: String(file.r2Key || "").trim(),
          mimeType: String(file.mimeType || "").trim() || "application/octet-stream",
          sizeBytes: intSizeFromBigInt(file.bytes),
          sha256: String(file.sha256 || "").trim() || null,
          visibility: cloudVisibility,
          publishedAt,
          expiresAt,
        },
        select: {
          id: true,
          sourcePath: true,
          displayTitle: true,
          type: true,
          visibility: true,
          publishedAt: true,
          expiresAt: true,
          storageKey: true,
          mimeType: true,
          sizeBytes: true,
          sha256: true,
          updatedAt: true,
        },
      });

      await writeArtifactOperation({
        accountId,
        operatorUserId: userId,
        artifactId: artifact.id,
        sourcePath: file.path,
        fileId: file.id,
        visibility: artifact.visibility,
        kind: artifact.visibility === "PRIVATE" ? "UNPUBLISHED_ARTIFACT" : "ARTIFACT_PUBLISHED",
      });

      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { username: true },
        });
        const username = String(user?.username || "").trim();
        if (username) {
          revalidatePath(`/u/${username}`);
          revalidatePath(`/${username}`);
        }
      } catch {
        // Best-effort cache invalidation.
      }

      return jsonNoStore(
        {
          ok: true,
          artifact: {
            id: artifact.id,
            sourcePath: artifact.sourcePath,
            displayTitle: artifact.displayTitle,
            type: artifact.type,
            visibility: artifact.visibility,
            publishedAtISO: artifact.publishedAt ? new Date(artifact.publishedAt).toISOString() : null,
            expiresAtISO: artifact.expiresAt ? new Date(artifact.expiresAt).toISOString() : null,
            storageKey: artifact.storageKey,
            mimeType: artifact.mimeType,
            sizeBytes: artifact.sizeBytes,
            sha256: artifact.sha256,
            updatedAtISO: artifact.updatedAt ? new Date(artifact.updatedAt).toISOString() : null,
          },
        },
        { status: 200 }
      );
    }

    const form = await readSanitizedFormData(req, null);
    if (!form) return jsonNoStore({ ok: false, message: "Invalid form data." }, { status: 400 });

    const sourcePath = String(form.get("sourcePath") || "").trim();
    if (!sourcePath) return jsonNoStore({ ok: false, message: "sourcePath is required." }, { status: 400 });

    const visibility = parseVisibility(form.get("visibility"));
    if (!visibility) return jsonNoStore({ ok: false, message: "Invalid visibility." }, { status: 400 });
    const publishExpiryDays = parsePublishExpiryDays(form.get("expiresInDays"), settings.publishDefaultExpiryDays);
    if (publishExpiryDays == null) {
      return jsonNoStore({ ok: false, message: "expiresInDays must be 0, 1, 7, or 30." }, { status: 400 });
    }

    const providedTitle = String(form.get("displayTitle") || "").trim();
    const filenameFromPath = safeFilename(basename(sourcePath));
    const displayTitle = (providedTitle || filenameFromPath || "Artifact").slice(0, 140);

    const fileFromForm = form.get("file");
    const file = fileFromForm instanceof File ? fileFromForm : null;

    // Ensure an artifact row exists so we can derive a stable CavCloud storageKey.
    // This keeps a durable identity even when unpublished.
    const artifact = await prisma.publicArtifact.upsert({
      where: { userId_sourcePath: { userId, sourcePath } },
      create: {
        userId,
        sourcePath,
        displayTitle,
        type: extUpper(filenameFromPath),
        visibility: "PRIVATE",
        publishedAt: null,
      },
      update: {
        displayTitle,
        type: extUpper(filenameFromPath),
      },
      select: {
        id: true,
        storageKey: true,
      },
    });

    // PRIVATE = fully unpublished. Do not mint external access.
    if (visibility === "PRIVATE") {
      const updated = await prisma.publicArtifact.update({
        where: { id: artifact.id },
        data: { visibility: "PRIVATE", publishedAt: null, expiresAt: null, displayTitle },
        select: {
          id: true,
          sourcePath: true,
          displayTitle: true,
          type: true,
          visibility: true,
          publishedAt: true,
          expiresAt: true,
          storageKey: true,
          mimeType: true,
          sizeBytes: true,
          sha256: true,
          updatedAt: true,
        },
      });
      await writeArtifactOperation({
        accountId,
        operatorUserId: userId,
        artifactId: updated.id,
        sourcePath: updated.sourcePath || sourcePath,
        visibility: updated.visibility,
        kind: "UNPUBLISHED_ARTIFACT",
      });
      return jsonNoStore(
        {
          ok: true,
          artifact: {
            id: updated.id,
            sourcePath: updated.sourcePath,
            displayTitle: updated.displayTitle,
            type: updated.type,
            visibility: updated.visibility,
            publishedAtISO: updated.publishedAt ? new Date(updated.publishedAt).toISOString() : null,
            expiresAtISO: updated.expiresAt ? new Date(updated.expiresAt).toISOString() : null,
            storageKey: updated.storageKey,
            mimeType: updated.mimeType,
            sizeBytes: updated.sizeBytes,
            sha256: updated.sha256,
            updatedAtISO: updated.updatedAt ? new Date(updated.updatedAt).toISOString() : null,
          },
        },
        { status: 200 }
      );
    }

    // If bytes already exist in CavCloud, allow visibility promotion without requiring an upload.
    if (!file) {
      if (String(artifact.storageKey || "").trim()) {
        const updated = await prisma.publicArtifact.update({
          where: { id: artifact.id },
          data: {
            visibility,
            publishedAt: new Date(),
            expiresAt: resolvePublishExpiresAt(visibility, publishExpiryDays),
            displayTitle,
            type: extUpper(filenameFromPath),
          },
          select: {
            id: true,
            sourcePath: true,
            displayTitle: true,
            type: true,
            visibility: true,
            publishedAt: true,
            expiresAt: true,
            storageKey: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            updatedAt: true,
          },
        });
        await writeArtifactOperation({
          accountId,
          operatorUserId: userId,
          artifactId: updated.id,
          sourcePath: updated.sourcePath || sourcePath,
          visibility: updated.visibility,
          kind: updated.visibility === "PRIVATE" ? "UNPUBLISHED_ARTIFACT" : "ARTIFACT_PUBLISHED",
        });
        return jsonNoStore(
          {
            ok: true,
            artifact: {
              id: updated.id,
              sourcePath: updated.sourcePath,
              displayTitle: updated.displayTitle,
              type: updated.type,
              visibility: updated.visibility,
              publishedAtISO: updated.publishedAt ? new Date(updated.publishedAt).toISOString() : null,
              expiresAtISO: updated.expiresAt ? new Date(updated.expiresAt).toISOString() : null,
              storageKey: updated.storageKey,
              mimeType: updated.mimeType,
              sizeBytes: updated.sizeBytes,
              sha256: updated.sha256,
              updatedAtISO: updated.updatedAt ? new Date(updated.updatedAt).toISOString() : null,
            },
          },
          { status: 200 }
        );
      }

      return jsonNoStore({ ok: false, message: "file is required to publish." }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > MAX_UPLOAD_BYTES) {
      return jsonNoStore({ ok: false, message: `File too large (max ${MAX_UPLOAD_BYTES} bytes).` }, { status: 413 });
    }

    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    const mimeType = String(form.get("mimeType") || file.type || "").trim() || "application/octet-stream";

    const filename = safeFilename(String(file.name || filenameFromPath || "artifact"));
    const nextStorageKey = artifact.storageKey?.trim() ? artifact.storageKey.trim() : `a/${artifact.id}/${filename}`;

    // Upload to R2 under the Worker contract prefix (cavcloud/{objectKey}).
    await putCavcloudObject({
      objectKey: nextStorageKey,
      body: buf,
      contentType: mimeType,
    });

    const updated = await prisma.publicArtifact.update({
      where: { id: artifact.id },
      data: {
        storageKey: nextStorageKey,
        mimeType,
        sizeBytes: buf.length,
        sha256,
        visibility,
        publishedAt: new Date(),
        expiresAt: resolvePublishExpiresAt(visibility, publishExpiryDays),
        displayTitle,
        type: extUpper(filename),
      },
      select: {
        id: true,
        sourcePath: true,
        displayTitle: true,
        type: true,
        visibility: true,
        publishedAt: true,
        expiresAt: true,
        storageKey: true,
        mimeType: true,
        sizeBytes: true,
        sha256: true,
        updatedAt: true,
      },
    });
    await writeArtifactOperation({
      accountId,
      operatorUserId: userId,
      artifactId: updated.id,
      sourcePath: updated.sourcePath || sourcePath,
      visibility: updated.visibility,
      kind: updated.visibility === "PRIVATE" ? "UNPUBLISHED_ARTIFACT" : "ARTIFACT_PUBLISHED",
    });

    return jsonNoStore(
      {
        ok: true,
        artifact: {
          id: updated.id,
          sourcePath: updated.sourcePath,
          displayTitle: updated.displayTitle,
          type: updated.type,
          visibility: updated.visibility,
          publishedAtISO: updated.publishedAt ? new Date(updated.publishedAt).toISOString() : null,
          expiresAtISO: updated.expiresAt ? new Date(updated.expiresAt).toISOString() : null,
          storageKey: updated.storageKey,
          mimeType: updated.mimeType,
          sizeBytes: updated.sizeBytes,
          sha256: updated.sha256,
          updatedAtISO: updated.updatedAt ? new Date(updated.updatedAt).toISOString() : null,
        },
      },
      { status: 200 }
    );
  } catch (e: unknown) {
    const err = e as { message?: unknown; code?: unknown; status?: unknown };
    const code = String(err?.message || err?.code || "");
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status === 401 || status === 403) return jsonNoStore({ ok: false, message: "Unauthorized" }, { status });
    if (code === "CAVCLOUD_R2_NOT_CONFIGURED") {
      const missing = missingCavcloudR2EnvVars();
      const hint = missing.length ? ` (missing ${missing.join(", ")})` : "";
      return jsonNoStore({ ok: false, message: `CavCloud storage is not configured${hint}.` }, { status: 500 });
    }
    return jsonNoStore({ ok: false, message: "Publish failed." }, { status: 500 });
  }
}
