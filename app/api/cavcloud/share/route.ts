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

type CreateShareBody = {
  kind?: unknown;
  id?: unknown;
  expiresInDays?: unknown;
  mode?: unknown;
  accessPolicy?: unknown;
};

function jsonNoStore<T>(body: T, init?: { status?: number }) {
  noStore();
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      "Cache-Control": "no-store",
    },
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

function parseKind(value: unknown): "file" | "folder" | null {
  const v = String(value || "").trim().toLowerCase();
  if (v === "file") return "file";
  if (v === "folder") return "folder";
  return null;
}

function parseMode(value: unknown): CavCloudShareMode | null {
  const v = String(value || "READ_ONLY").trim().toUpperCase();
  if (v === "READ_ONLY") return "READ_ONLY";
  return null;
}

function parseExpiresInDays(value: unknown, fallbackDays = 7): number | null {
  const n = Number(value == null || value === "" ? fallbackDays : value);
  if (!Number.isFinite(n)) return null;
  if (n === 1 || n === 7 || n === 30) return n;
  return null;
}

function parseAccessPolicy(value: unknown): "anyone" | "cavbotUsers" | "workspaceMembers" | null {
  const v = String(value || "anyone").trim();
  if (v === "anyone" || v === "cavbotUsers" || v === "workspaceMembers") return v;
  return null;
}

async function writeShareActivity(args: {
  accountId: string;
  operatorUserId: string;
  targetType: "file" | "folder";
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
        targetType: args.targetType,
        targetId: args.targetId,
        targetPath: args.targetPath,
        metaJson: args.metaJson,
      },
    });
  } catch {
    // Sharing must not fail on activity write errors.
  }
}

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const accountId = String(sess.accountId || "").trim();
    const userId = String(sess.sub || "").trim();
    if (!accountId || !userId) {
      return jsonNoStore({ ok: false, message: "Unauthorized" }, { status: 401 });
    }

    await assertCavCloudActionAllowed({
      accountId,
      userId,
      action: "SHARE_READ_ONLY",
      errorCode: "UNAUTHORIZED",
    });

    const settings = await getCavCloudSettings({ accountId, userId });

    const body = (await readSanitizedJson(req, null)) as CreateShareBody | null;
    if (!body) return jsonNoStore({ ok: false, message: "Invalid JSON body." }, { status: 400 });

    const kind = parseKind(body.kind);
    const targetId = String(body.id || "").trim();
    const expiresInDays = parseExpiresInDays(body.expiresInDays, settings.shareDefaultExpiryDays);
    const mode = parseMode(body.mode);
    const accessPolicy = parseAccessPolicy(body.accessPolicy ?? settings.shareAccessPolicy);

    if (!kind) return jsonNoStore({ ok: false, message: "kind must be file or folder." }, { status: 400 });
    if (!targetId) return jsonNoStore({ ok: false, message: "id is required." }, { status: 400 });
    if (!expiresInDays) return jsonNoStore({ ok: false, message: "expiresInDays must be 1, 7, or 30." }, { status: 400 });
    if (!mode) return jsonNoStore({ ok: false, message: "mode must be READ_ONLY." }, { status: 400 });
    if (!accessPolicy) {
      return jsonNoStore(
        { ok: false, message: "accessPolicy must be anyone, cavbotUsers, or workspaceMembers." },
        { status: 400 },
      );
    }

    if (kind === "file") {
      await assertCavCloudActionAllowed({
        accountId,
        userId,
        action: "SHARE_READ_ONLY",
        resourceType: "FILE",
        resourceId: targetId,
        neededPermission: "VIEW",
        errorCode: "UNAUTHORIZED",
      });

      const file = await prisma.cavCloudFile.findFirst({
        where: {
          id: targetId,
          accountId,
          deletedAt: null,
        },
        select: {
          id: true,
          path: true,
        },
      });
      if (!file) return jsonNoStore({ ok: false, message: "File not found." }, { status: 404 });

      const share = await prisma.cavCloudStorageShare.create({
        data: {
          accountId,
          fileId: file.id,
          mode,
          accessPolicy,
          expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
          createdByUserId: userId,
        },
        select: {
          id: true,
          expiresAt: true,
        },
      });

      await writeShareActivity({
        accountId,
        operatorUserId: userId,
        targetType: "file",
        targetId: file.id,
        targetPath: file.path,
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
        label: file.path || file.id,
        meta: {
          fileId: file.id,
          expiresInDays,
          mode,
          accessPolicy,
        },
      });

      return jsonNoStore({
        ok: true,
        shareId: share.id,
        shareUrl: `${appOrigin(req)}/cavcloud/share/${share.id}`,
        expiresAtISO: new Date(share.expiresAt).toISOString(),
        accessPolicy,
      }, { status: 200 });
    }

    await assertCavCloudActionAllowed({
      accountId,
      userId,
      action: "SHARE_READ_ONLY",
      resourceType: "FOLDER",
      resourceId: targetId,
      neededPermission: "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    const folder = await prisma.cavCloudFolder.findFirst({
      where: {
        id: targetId,
        accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        path: true,
      },
    });
    if (!folder) return jsonNoStore({ ok: false, message: "Folder not found." }, { status: 404 });

    const share = await prisma.cavCloudStorageShare.create({
      data: {
        accountId,
        folderId: folder.id,
        mode,
        accessPolicy,
        expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
        createdByUserId: userId,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });

    await writeShareActivity({
      accountId,
      operatorUserId: userId,
      targetType: "folder",
      targetId: folder.id,
      targetPath: folder.path,
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
      label: folder.path || folder.id,
      meta: {
        folderId: folder.id,
        expiresInDays,
        mode,
        accessPolicy,
      },
    });

    return jsonNoStore({
      ok: true,
      shareId: share.id,
      shareUrl: `${appOrigin(req)}/cavcloud/share/${share.id}`,
      expiresAtISO: new Date(share.expiresAt).toISOString(),
      accessPolicy,
    }, { status: 200 });
  } catch (e: unknown) {
    const err = e as { status?: unknown };
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status === 401 || status === 403) {
      return jsonNoStore({ ok: false, message: "Unauthorized" }, { status });
    }
    return jsonNoStore({ ok: false, message: "Failed to create share." }, { status: 500 });
  }
}
