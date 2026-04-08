import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import crypto from "crypto";
import type { CavCloudShareMode, Prisma, PublicArtifactVisibility } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { getCavCloudSettings } from "@/lib/cavcloud/settings.server";
import { isCavCloudServiceUnavailableError, withCavCloudDeadline } from "@/lib/cavcloud/http.server";
import { putCavcloudObject } from "@/lib/cavcloud/r2.server";
import { writeCavCloudOperationLog } from "@/lib/cavcloud/operationLog.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { readSanitizedJson, readSanitizedFormData } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore<T>(body: T, init?: { status?: number }) {
  noStore();
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { "Cache-Control": "no-store" },
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

function normalizePath(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "/";
  const withSlash = s.startsWith("/") ? s : `/${s}`;
  return withSlash.replace(/\/+/g, "/");
}

function normalizePathNoTrailingSlash(raw: string) {
  const n = normalizePath(raw);
  if (n.length > 1 && n.endsWith("/")) return n.slice(0, -1);
  return n;
}

function extUpper(filename: string) {
  const n = String(filename || "");
  const idx = n.lastIndexOf(".");
  if (idx === -1) return "FILE";
  const e = n.slice(idx + 1).trim().toUpperCase();
  return e || "FILE";
}

function parseMode(raw: unknown): CavCloudShareMode | null {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "READ_ONLY") return "READ_ONLY";
  return null;
}

function parseExpiresInDays(raw: unknown, fallbackDays = 7): number | null {
  const n = Number(raw == null || raw === "" ? fallbackDays : raw);
  if (!Number.isFinite(n)) return null;
  if (n === 1 || n === 7 || n === 30) return n;
  return null;
}

function parseAccessPolicy(value: unknown): "anyone" | "cavbotUsers" | "workspaceMembers" | null {
  const v = String(value || "anyone").trim();
  if (v === "anyone" || v === "cavbotUsers" || v === "workspaceMembers") return v;
  return null;
}

function parseVisibility(raw: unknown): PublicArtifactVisibility | null {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "PRIVATE") return "PRIVATE";
  if (v === "LINK_ONLY") return "LINK_ONLY";
  if (v === "PUBLIC_PROFILE") return "PUBLIC_PROFILE";
  return null;
}

function appOrigin(req: Request): string {
  const env = String(process.env.NEXT_PUBLIC_APP_URL || process.env.CAVBOT_APP_ORIGIN || "").trim();
  if (env) {
    try {
      return new URL(env).origin;
    } catch {}
  }
  return new URL(req.url).origin;
}

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

async function writeShareActivity(args: {
  accountId: string;
  operatorUserId: string;
  action: "share.create";
  targetType: "file" | "folder";
  targetId?: string | null;
  targetPath?: string | null;
  metaJson?: Prisma.InputJsonValue;
}) {
  try {
    await prisma.cavCloudActivity.create({
      data: {
        accountId: args.accountId,
        operatorUserId: args.operatorUserId,
        action: args.action,
        targetType: args.targetType,
        targetId: args.targetId || null,
        targetPath: args.targetPath || null,
        metaJson: args.metaJson,
      },
    });
  } catch {
    // Activity logging should not block share creation.
  }
}

function missingCavcloudR2EnvVars(): string[] {
  const missing: string[] = [];
  if (!String(process.env.CAVCLOUD_R2_ENDPOINT || "").trim()) missing.push("CAVCLOUD_R2_ENDPOINT");
  if (!String(process.env.CAVCLOUD_R2_ACCESS_KEY_ID || "").trim()) missing.push("CAVCLOUD_R2_ACCESS_KEY_ID");
  if (!String(process.env.CAVCLOUD_R2_SECRET_ACCESS_KEY || "").trim()) missing.push("CAVCLOUD_R2_SECRET_ACCESS_KEY");
  if (!String(process.env.CAVCLOUD_R2_BUCKET || "").trim()) missing.push("CAVCLOUD_R2_BUCKET");
  return missing;
}

function isCavCloudShareSchemaMismatch(err: unknown) {
  return isSchemaMismatchError(err, {
    tables: ["CavCloudShare", "PublicArtifact", "User"],
    columns: [
      "artifactId",
      "createdByUserId",
      "accessPolicy",
      "expiresAt",
      "revokedAt",
      "displayTitle",
      "sourcePath",
      "mimeType",
      "type",
      "sizeBytes",
    ],
    fields: ["artifact"],
  });
}

async function buildDegradedSharesResponse(req: Request) {
  const sess = await requireSession(req);
  requireUser(sess);
  return jsonNoStore({ ok: true, degraded: true, items: [] }, { status: 200 });
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    const userId = String(sess.sub);

    const url = new URL(req.url);
    const artifactId = String(url.searchParams.get("artifactId") || "").trim();
    const where = artifactId ? { artifactId, createdByUserId: userId } : { createdByUserId: userId };
    const items = await withCavCloudDeadline(
      prisma.cavCloudShare.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          mode: true,
          accessPolicy: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          artifact: {
            select: {
              id: true,
              displayTitle: true,
              sourcePath: true,
              mimeType: true,
              type: true,
              sizeBytes: true,
            },
          },
        },
        take: artifactId ? 50 : 200,
      }),
      { message: "Timed out loading CavCloud shares." },
    );

    return jsonNoStore(
      {
        ok: true,
        items: items.map((s) => ({
          id: s.id,
          mode: s.mode,
          accessPolicy: s.accessPolicy || "anyone",
          expiresAtISO: new Date(s.expiresAt).toISOString(),
          revokedAtISO: s.revokedAt ? new Date(s.revokedAt).toISOString() : null,
          createdAtISO: new Date(s.createdAt).toISOString(),
          shareUrl: `${appOrigin(req)}/share/${s.id}`,
          artifact: s.artifact
            ? {
                id: s.artifact.id,
                displayTitle: s.artifact.displayTitle,
                sourcePath: s.artifact.sourcePath,
                mimeType: s.artifact.mimeType,
                type: s.artifact.type,
                sizeBytes: Number.isFinite(Number(s.artifact.sizeBytes))
                  ? Math.max(0, Math.trunc(Number(s.artifact.sizeBytes)))
                  : null,
              }
            : null,
        })),
      },
      { status: 200 }
    );
  } catch (e: unknown) {
    const err = e as { status?: unknown };
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status === 401 || status === 403) return jsonNoStore({ ok: false, message: "Unauthorized" }, { status });
    if (isCavCloudServiceUnavailableError(e) || isCavCloudShareSchemaMismatch(e)) {
      try {
        return await buildDegradedSharesResponse(req);
      } catch (fallbackError) {
        const fallbackStatus =
          typeof (fallbackError as { status?: unknown })?.status === "number"
            ? Number((fallbackError as { status?: unknown }).status)
            : 500;
        if (fallbackStatus === 401 || fallbackStatus === 403) {
          return jsonNoStore({ ok: false, message: "Unauthorized" }, { status: fallbackStatus });
        }
      }
    }
    try {
      return await buildDegradedSharesResponse(req);
    } catch {
      // Preserve the original error response if degraded auth/context recovery also fails.
    }
    if (status === 502 || status === 503 || status === 504) {
      return jsonNoStore({ ok: false, message: "Service temporarily unavailable." }, { status: 503 });
    }
    return jsonNoStore({ ok: false, message: "Failed to load shares." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);
    const userId = String(sess.sub);
    const accountId = String(sess.accountId);
    await assertCavCloudActionAllowed({
      accountId,
      userId,
      action: "SHARE_READ_ONLY",
      errorCode: "UNAUTHORIZED",
    });
    const settings = await getCavCloudSettings({ accountId, userId });

    const ct = String(req.headers.get("content-type") || "").toLowerCase();

    // Mode A: JSON body (artifactId)
    if (ct.includes("application/json")) {
      const body = (await readSanitizedJson(req, null)) as null | {
        artifactId?: string;
        folderPath?: string;
        expiresInDays?: number;
        mode?: string;
        accessPolicy?: string;
      };
      if (!body) return jsonNoStore({ ok: false, message: "Invalid JSON." }, { status: 400 });

      const artifactId = String(body.artifactId || "").trim();
      const folderPath = normalizePathNoTrailingSlash(String(body.folderPath || ""));
      if (!artifactId && !folderPath) {
        return jsonNoStore({ ok: false, message: "artifactId or folderPath is required." }, { status: 400 });
      }

      const normalizedExpiresInDays = parseExpiresInDays(body.expiresInDays, settings.shareDefaultExpiryDays);
      if (!normalizedExpiresInDays) {
        return jsonNoStore({ ok: false, message: "expiresInDays must be 1, 7, or 30." }, { status: 400 });
      }

      const mode = parseMode(body.mode || "READ_ONLY");
      if (!mode) return jsonNoStore({ ok: false, message: "Invalid mode." }, { status: 400 });
      const accessPolicy = parseAccessPolicy((body as { accessPolicy?: unknown })?.accessPolicy ?? settings.shareAccessPolicy);
      if (!accessPolicy) {
        return jsonNoStore(
          { ok: false, message: "accessPolicy must be anyone, cavbotUsers, or workspaceMembers." },
          { status: 400 },
        );
      }

      // Folder share: creates a revocable share URL that resolves to a read-only listing page.
      if (folderPath) {
        const folder = await prisma.cavCloudFolder.findFirst({
          where: {
            accountId,
            path: folderPath,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });
        if (!folder?.id) {
          return jsonNoStore({ ok: false, message: "Folder not found." }, { status: 404 });
        }
        await assertCavCloudActionAllowed({
          accountId,
          userId,
          action: "SHARE_READ_ONLY",
          resourceType: "FOLDER",
          resourceId: folder.id,
          neededPermission: "VIEW",
          errorCode: "UNAUTHORIZED",
        });

        const folderName = safeFilename(basename(folderPath) || "Folder").slice(0, 140) || "Folder";

        const artifactAfter = await prisma.publicArtifact.upsert({
          where: { userId_sourcePath: { userId, sourcePath: folderPath } },
          create: {
            userId,
            sourcePath: folderPath,
            displayTitle: folderName,
            type: "FOLDER",
            visibility: "LINK_ONLY",
            publishedAt: new Date(),
          },
          update: {
            displayTitle: folderName,
            type: "FOLDER",
            visibility: "LINK_ONLY",
            publishedAt: new Date(),
          },
          select: {
            id: true,
            sourcePath: true,
            displayTitle: true,
            type: true,
            visibility: true,
            publishedAt: true,
          },
        });

        const share = await prisma.cavCloudShare.create({
          data: {
            accountId,
            artifactId: artifactAfter.id,
            createdByUserId: userId,
            mode,
            accessPolicy,
            expiresAt: new Date(Date.now() + normalizedExpiresInDays * 24 * 60 * 60 * 1000),
          },
          select: { id: true, expiresAt: true },
        });

        await writeShareActivity({
          accountId,
          operatorUserId: userId,
          action: "share.create",
          targetType: "folder",
          targetId: artifactAfter.id,
          targetPath: artifactAfter.sourcePath,
          metaJson: {
            shareId: share.id,
            expiresInDays: normalizedExpiresInDays,
            mode,
            accessPolicy,
          },
        });
        await writeCavCloudOperationLog({
          accountId,
          operatorUserId: userId,
          kind: "SHARE_CREATED",
          subjectType: "share",
          subjectId: share.id,
          label: artifactAfter.sourcePath || artifactAfter.id,
          meta: {
            artifactId: artifactAfter.id,
            expiresInDays: normalizedExpiresInDays,
            mode,
            accessPolicy,
            kind: "folder",
          },
        });

        return jsonNoStore(
          {
            ok: true,
            shareId: share.id,
            artifactId: artifactAfter.id,
            artifact: {
              id: artifactAfter.id,
              sourcePath: artifactAfter.sourcePath,
              displayTitle: artifactAfter.displayTitle,
              type: artifactAfter.type,
              visibility: artifactAfter.visibility,
              publishedAtISO: artifactAfter.publishedAt ? new Date(artifactAfter.publishedAt).toISOString() : null,
            },
            shareUrl: `${appOrigin(req)}/share/${share.id}`,
            expiresAtISO: new Date(share.expiresAt).toISOString(),
            accessPolicy,
          },
          { status: 200 }
        );
      }

      const artifact = await prisma.publicArtifact.findFirst({
        where: { id: artifactId, userId },
        select: {
          id: true,
          storageKey: true,
          visibility: true,
          publishedAt: true,
          sourcePath: true,
          displayTitle: true,
          type: true,
        },
      });
      if (!artifact) return jsonNoStore({ ok: false, message: "Not found." }, { status: 404 });

      const artifactPath = String(artifact.sourcePath || "").trim();
      if (artifactPath) {
        const [file, folder] = await Promise.all([
          prisma.cavCloudFile.findFirst({
            where: {
              accountId,
              path: artifactPath,
              deletedAt: null,
            },
            select: {
              id: true,
            },
          }),
          prisma.cavCloudFolder.findFirst({
            where: {
              accountId,
              path: artifactPath,
              deletedAt: null,
            },
            select: {
              id: true,
            },
          }),
        ]);

        if (file?.id) {
          await assertCavCloudActionAllowed({
            accountId,
            userId,
            action: "SHARE_READ_ONLY",
            resourceType: "FILE",
            resourceId: file.id,
            neededPermission: "VIEW",
            errorCode: "UNAUTHORIZED",
          });
        } else if (folder?.id) {
          await assertCavCloudActionAllowed({
            accountId,
            userId,
            action: "SHARE_READ_ONLY",
            resourceType: "FOLDER",
            resourceId: folder.id,
            neededPermission: "VIEW",
            errorCode: "UNAUTHORIZED",
          });
        }
      }

      if (!String(artifact.storageKey || "").trim()) {
        return jsonNoStore({ ok: false, message: "Artifact has no CavCloud bytes yet. Publish/upload first." }, { status: 400 });
      }

      // Sharing is explicit: if an artifact exists but is PRIVATE/unpublished, promote to LINK_ONLY.
      if (artifact.visibility === "PRIVATE" || !artifact.publishedAt) {
        await prisma.publicArtifact.update({
          where: { id: artifact.id },
          data: { visibility: "LINK_ONLY", publishedAt: new Date() },
        });
      }

      const artifactAfter = await prisma.publicArtifact.findUnique({
        where: { id: artifact.id },
        select: {
          id: true,
          sourcePath: true,
          displayTitle: true,
          type: true,
          visibility: true,
          publishedAt: true,
        },
      });

      const share = await prisma.cavCloudShare.create({
        data: {
          accountId,
          artifactId: artifact.id,
          createdByUserId: userId,
          mode,
          accessPolicy,
          expiresAt: new Date(Date.now() + normalizedExpiresInDays * 24 * 60 * 60 * 1000),
        },
        select: { id: true, expiresAt: true },
      });

      await writeShareActivity({
        accountId,
        operatorUserId: userId,
        action: "share.create",
        targetType: artifactAfter?.type === "FOLDER" ? "folder" : "file",
        targetId: artifact.id,
        targetPath: artifactAfter?.sourcePath || artifact.sourcePath || null,
        metaJson: {
          shareId: share.id,
          expiresInDays: normalizedExpiresInDays,
          mode,
          accessPolicy,
        },
      });
      await writeCavCloudOperationLog({
        accountId,
        operatorUserId: userId,
        kind: "SHARE_CREATED",
        subjectType: "share",
        subjectId: share.id,
        label: artifactAfter?.sourcePath || artifact.sourcePath || artifact.id,
        meta: {
          artifactId: artifact.id,
          expiresInDays: normalizedExpiresInDays,
          mode,
          accessPolicy,
          kind: artifactAfter?.type === "FOLDER" ? "folder" : "file",
        },
      });

      return jsonNoStore(
        {
          ok: true,
          shareId: share.id,
          artifactId: artifact.id,
          artifact: artifactAfter
            ? {
                id: artifactAfter.id,
                sourcePath: artifactAfter.sourcePath,
                displayTitle: artifactAfter.displayTitle,
                type: artifactAfter.type,
                visibility: artifactAfter.visibility,
                publishedAtISO: artifactAfter.publishedAt ? new Date(artifactAfter.publishedAt).toISOString() : null,
              }
            : null,
          shareUrl: `${appOrigin(req)}/share/${share.id}`,
          expiresAtISO: new Date(share.expiresAt).toISOString(),
          accessPolicy,
        },
        { status: 200 }
      );
    }

    // Mode B: multipart/form-data (CavCloud UI: share a file by uploading bytes + sourcePath)
    const form = await readSanitizedFormData(req, null);
    if (!form) return jsonNoStore({ ok: false, message: "Invalid form data." }, { status: 400 });

    const sourcePath = String(form.get("sourcePath") || "").trim();
    if (!sourcePath) return jsonNoStore({ ok: false, message: "sourcePath is required." }, { status: 400 });

    const expiresInDays = parseExpiresInDays(form.get("expiresInDays"), settings.shareDefaultExpiryDays);
    if (!expiresInDays) return jsonNoStore({ ok: false, message: "expiresInDays must be 1, 7, or 30." }, { status: 400 });

    const mode = parseMode(form.get("mode") || "READ_ONLY");
    if (!mode) return jsonNoStore({ ok: false, message: "Invalid mode." }, { status: 400 });
    const accessPolicy = parseAccessPolicy(form.get("accessPolicy") || settings.shareAccessPolicy);
    if (!accessPolicy) {
      return jsonNoStore(
        { ok: false, message: "accessPolicy must be anyone, cavbotUsers, or workspaceMembers." },
        { status: 400 },
      );
    }

    const providedTitle = String(form.get("displayTitle") || "").trim();
    const filenameFromPath = safeFilename(basename(sourcePath));
    const displayTitle = (providedTitle || filenameFromPath || "Artifact").slice(0, 140);

    const visibility = parseVisibility(form.get("visibility") || "LINK_ONLY") || "LINK_ONLY";
    const effectiveVisibility: PublicArtifactVisibility = visibility === "PRIVATE" ? "LINK_ONLY" : visibility;

    const fileFromForm = form.get("file");
    const file = fileFromForm instanceof File ? fileFromForm : null;
    if (!file) return jsonNoStore({ ok: false, message: "file is required to share." }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > MAX_UPLOAD_BYTES) {
      return jsonNoStore({ ok: false, message: `File too large (max ${MAX_UPLOAD_BYTES} bytes).` }, { status: 413 });
    }

    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    const mimeType = String(form.get("mimeType") || file.type || "").trim() || "application/octet-stream";
    const filename = safeFilename(String(file.name || filenameFromPath || "artifact"));

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
      select: { id: true, storageKey: true },
    });

    const nextStorageKey = artifact.storageKey?.trim() ? artifact.storageKey.trim() : `a/${artifact.id}/${filename}`;

    await putCavcloudObject({
      objectKey: nextStorageKey,
      body: buf,
      contentType: mimeType,
    });

    const artifactAfter = await prisma.publicArtifact.update({
      where: { id: artifact.id },
      data: {
        storageKey: nextStorageKey,
        mimeType,
        sizeBytes: buf.length,
        sha256,
        visibility: effectiveVisibility,
        publishedAt: new Date(),
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
      },
    });

    const share = await prisma.cavCloudShare.create({
      data: {
        accountId,
        artifactId: artifact.id,
        createdByUserId: userId,
        mode,
        accessPolicy,
        expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
      },
      select: { id: true, expiresAt: true },
    });

    await writeShareActivity({
      accountId,
      operatorUserId: userId,
      action: "share.create",
      targetType: "file",
      targetId: artifact.id,
      targetPath: sourcePath,
      metaJson: {
        shareId: share.id,
        expiresInDays,
        mode,
        accessPolicy,
      },
    });
    await writeCavCloudOperationLog({
      accountId,
      operatorUserId: userId,
      kind: "SHARE_CREATED",
      subjectType: "share",
      subjectId: share.id,
      label: sourcePath || artifact.id,
      meta: {
        artifactId: artifact.id,
        expiresInDays,
        mode,
        accessPolicy,
        kind: "file",
      },
    });

    return jsonNoStore(
      {
        ok: true,
        shareId: share.id,
        artifactId: artifact.id,
        artifact: {
          id: artifactAfter.id,
          sourcePath: artifactAfter.sourcePath,
          displayTitle: artifactAfter.displayTitle,
          type: artifactAfter.type,
          visibility: artifactAfter.visibility,
          publishedAtISO: artifactAfter.publishedAt ? new Date(artifactAfter.publishedAt).toISOString() : null,
        },
        shareUrl: `${appOrigin(req)}/share/${share.id}`,
        expiresAtISO: new Date(share.expiresAt).toISOString(),
        accessPolicy,
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
    return jsonNoStore({ ok: false, message: "Share creation failed." }, { status: 500 });
  }
}
