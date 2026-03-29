import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import type { CavCloudShareMode, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { getCavCloudSettings } from "@/lib/cavcloud/settings.server";
import { writeCavCloudOperationLog } from "@/lib/cavcloud/operationLog.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ShareLinkBody = {
  fileId?: unknown;
  expiresInDays?: unknown;
  mode?: unknown;
  accessPolicy?: unknown;
};

function jsonNoStore<T>(body: T, init?: { status?: number }) {
  noStore();
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { "Cache-Control": "no-store" },
  });
}

function appOrigin(req: Request): string {
  const env = String(process.env.NEXT_PUBLIC_APP_URL || process.env.CAVBOT_APP_ORIGIN || "").trim();
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      // fall through
    }
  }
  return new URL(req.url).origin;
}

function parseMode(raw: unknown): CavCloudShareMode | null {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "READ_ONLY") return "READ_ONLY";
  return null;
}

function parseExpiresInDays(raw: unknown, fallbackDays = 7): number | null {
  if (raw == null || String(raw).trim() === "") return fallbackDays;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n === 1 || n === 7 || n === 30) return n;
  return null;
}

function parseAccessPolicy(value: unknown): "anyone" | "cavbotUsers" | "workspaceMembers" | null {
  const v = String(value || "anyone").trim();
  if (v === "anyone" || v === "cavbotUsers" || v === "workspaceMembers") return v;
  return null;
}

function safeTitle(name: string): string {
  const cleaned = String(name || "")
    .trim()
    .replace(/[\\/\u0000\r\n"]/g, "_")
    .slice(0, 140);
  return cleaned || "Shared file";
}

function extUpper(filename: string): string {
  const n = String(filename || "");
  const idx = n.lastIndexOf(".");
  if (idx === -1) return "FILE";
  const e = n.slice(idx + 1).trim().toUpperCase();
  return e || "FILE";
}

async function writeShareActivity(args: {
  accountId: string;
  operatorUserId: string;
  targetId: string;
  targetPath: string;
  metaJson?: Prisma.InputJsonValue;
}) {
  try {
    await prisma.cavCloudActivity.create({
      data: {
        accountId: args.accountId,
        operatorUserId: args.operatorUserId,
        action: "share.create",
        targetType: "file",
        targetId: args.targetId,
        targetPath: args.targetPath,
        metaJson: args.metaJson,
      },
    });
  } catch {
    // Activity logging should never block share link creation.
  }
}

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const userId = String(sess.sub || "").trim();
    const accountId = String(sess.accountId || "").trim();
    await assertCavCloudActionAllowed({
      accountId,
      userId,
      action: "SHARE_READ_ONLY",
      errorCode: "UNAUTHORIZED",
    });
    const settings = await getCavCloudSettings({ accountId, userId });

    const body = (await readSanitizedJson(req, null)) as ShareLinkBody | null;
    if (!body) return jsonNoStore({ ok: false, message: "Invalid JSON body." }, { status: 400 });

    const fileId = String(body.fileId || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, message: "fileId is required." }, { status: 400 });

    await assertCavCloudActionAllowed({
      accountId,
      userId,
      action: "SHARE_READ_ONLY",
      resourceType: "FILE",
      resourceId: fileId,
      neededPermission: "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    const expiresInDays = parseExpiresInDays(body.expiresInDays, settings.shareDefaultExpiryDays);
    if (!expiresInDays) {
      return jsonNoStore({ ok: false, message: "expiresInDays must be 1, 7, or 30." }, { status: 400 });
    }

    const mode = parseMode(body.mode || "READ_ONLY");
    if (!mode) return jsonNoStore({ ok: false, message: "Invalid mode." }, { status: 400 });
    const accessPolicy = parseAccessPolicy(body.accessPolicy ?? settings.shareAccessPolicy);
    if (!accessPolicy) {
      return jsonNoStore(
        { ok: false, message: "accessPolicy must be anyone, cavbotUsers, or workspaceMembers." },
        { status: 400 },
      );
    }

    const file = await prisma.cavCloudFile.findFirst({
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
      },
    });
    if (!file) return jsonNoStore({ ok: false, message: "File not found." }, { status: 404 });

    const objectKey = String(file.r2Key || "").trim();
    if (!objectKey) return jsonNoStore({ ok: false, message: "File is missing storage key." }, { status: 400 });

    const displayTitle = safeTitle(file.name);
    const type = extUpper(file.name);

    const artifact = await prisma.publicArtifact.upsert({
      where: { userId_sourcePath: { userId, sourcePath: file.path } },
      create: {
        userId,
        sourcePath: file.path,
        displayTitle,
        type,
        storageKey: objectKey,
        mimeType: String(file.mimeType || "").trim() || "application/octet-stream",
        visibility: "LINK_ONLY",
        publishedAt: new Date(),
      },
      update: {
        displayTitle,
        type,
        storageKey: objectKey,
        mimeType: String(file.mimeType || "").trim() || "application/octet-stream",
        visibility: "LINK_ONLY",
        publishedAt: new Date(),
      },
      select: {
        id: true,
        sourcePath: true,
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
      select: {
        id: true,
        expiresAt: true,
      },
    });

    await writeShareActivity({
      accountId,
      operatorUserId: userId,
      targetId: artifact.id,
      targetPath: artifact.sourcePath || file.path,
      metaJson: {
        shareId: share.id,
        expiresInDays,
        mode,
        accessPolicy,
        channel: "copy_link",
      },
    });
    await writeCavCloudOperationLog({
      accountId,
      operatorUserId: userId,
      kind: "SHARE_CREATED",
      subjectType: "share",
      subjectId: share.id,
      label: artifact.sourcePath || file.path || artifact.id,
      meta: {
        shareId: share.id,
        artifactId: artifact.id,
        channel: "copy_link",
        expiresInDays,
        mode,
        accessPolicy,
      },
    });

    return jsonNoStore(
      {
        ok: true,
        shareId: share.id,
        shareUrl: `${appOrigin(req)}/share/${share.id}`,
        expiresAtISO: new Date(share.expiresAt).toISOString(),
        accessPolicy,
      },
      { status: 200 }
    );
  } catch (e: unknown) {
    const err = e as { status?: unknown };
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status === 401 || status === 403) {
      return jsonNoStore({ ok: false, message: "Unauthorized" }, { status });
    }
    return jsonNoStore({ ok: false, message: "Failed to create share link." }, { status: 500 });
  }
}
