import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import {
  CAVCLOUD_ACTIVITY_OPERATION_KINDS,
  operationKindToLegacyActivityAction,
} from "@/lib/cavcloud/historyLayers.server";
import {
  cavcloudOperationCursorWhere,
  decodeCavCloudOperationCursor,
  encodeCavCloudOperationCursor,
} from "@/lib/cavcloud/operationCursor.server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_ACTIONS = new Set([
  "upload.files",
  "upload.folder",
  "upload.camera_roll",
  "upload.preview",
  "file.star",
  "file.unstar",
  "folder.star",
  "folder.unstar",
]);

const FALLBACK_ACTIVITY_ACTIONS = [
  "file.upload.simple",
  "file.upload.multipart.complete",
  "upload.files",
  "upload.folder",
  "upload.camera_roll",
  "upload.preview",
  "folder.create",
  "file.metadata.create",
  "file.delete",
  "folder.delete",
  "trash.restore",
  "trash.permanent_delete",
  "share.create",
  "share.revoke",
  "share.unshare",
  "file.star",
  "file.unstar",
  "file.update",
  "file.duplicate",
  "file.zip",
  "folder.zip",
  "file.sync.upsert",
  "folder.update",
  "artifact.publish",
  "artifact.unpublish",
  "ACCESS_GRANTED",
  "ACCESS_REVOKED",
] as const;

function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 40;
  return Math.max(1, Math.min(120, n));
}

function isMissingOperationLogTableError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  return msg.includes("cavcloudoperationlog") && (msg.includes("does not exist") || msg.includes("relation"));
}

type ActivityBody = {
  action?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  targetPath?: unknown;
  metaJson?: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const cursor = decodeCavCloudOperationCursor(url.searchParams.get("cursor"));

    try {
      const rows = await prisma.cavCloudOperationLog.findMany({
        where: {
          accountId: sess.accountId,
          kind: {
            in: CAVCLOUD_ACTIVITY_OPERATION_KINDS,
          },
          ...cavcloudOperationCursorWhere(cursor),
        },
        orderBy: [
          { createdAt: "desc" },
          { id: "desc" },
        ],
        take: limit + 1,
        select: {
          id: true,
          kind: true,
          subjectType: true,
          subjectId: true,
          label: true,
          meta: true,
          operatorUserId: true,
          createdAt: true,
        },
      });

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? encodeCavCloudOperationCursor(pageRows[pageRows.length - 1]) : null;

      return jsonNoStore({
        ok: true,
        rows: pageRows.map((row) => {
          const metaJson = asObject(row.meta);
          const targetPath = String(
            metaJson?.targetPath
            || metaJson?.toPath
            || metaJson?.path
            || row.label
            || "",
          ).trim() || null;
          return {
            id: row.id,
            kind: row.kind,
            action: operationKindToLegacyActivityAction({
              kind: row.kind,
              subjectType: row.subjectType,
              meta: metaJson,
            }),
            targetType: row.subjectType,
            targetId: row.subjectId || null,
            targetPath,
            subjectType: row.subjectType,
            subjectId: row.subjectId,
            label: row.label,
            metaJson,
            meta: metaJson,
            operatorUserId: row.operatorUserId ?? null,
            createdAtISO: row.createdAt.toISOString(),
          };
        }),
        nextCursor,
      }, 200);
    } catch (err) {
      if (!isMissingOperationLogTableError(err)) throw err;

      const fallback = await prisma.cavCloudActivity.findMany({
        where: {
          accountId: sess.accountId,
          action: {
            in: [...FALLBACK_ACTIVITY_ACTIONS],
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: limit + 1,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          targetPath: true,
          metaJson: true,
          operatorUserId: true,
          createdAt: true,
        },
      });

      const hasMore = fallback.length > limit;
      const pageRows = hasMore ? fallback.slice(0, limit) : fallback;
      const nextCursor = null;

      return jsonNoStore({
        ok: true,
        rows: pageRows.map((row) => ({
          id: row.id,
          kind: row.action,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          targetPath: row.targetPath,
          subjectType: row.targetType,
          subjectId: row.targetId || row.id,
          label: row.targetPath || row.targetId || row.action,
          metaJson: asObject(row.metaJson),
          meta: asObject(row.metaJson),
          operatorUserId: row.operatorUserId ?? null,
          createdAtISO: row.createdAt.toISOString(),
        })),
        nextCursor,
      }, 200);
    }
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load activity.");
  }
}

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const body = (await readSanitizedJson(req, null)) as ActivityBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const action = String(body.action || "").trim().toLowerCase();
    if (!action || !ALLOWED_ACTIONS.has(action)) {
      return jsonNoStore({ ok: false, error: "ACTION_INVALID", message: "Action is not allowed." }, 400);
    }

    const targetType = String(body.targetType || "upload").trim().slice(0, 32) || "upload";
    const targetId = String(body.targetId || "").trim().slice(0, 128) || null;
    const targetPath = String(body.targetPath || "").trim().slice(0, 800) || null;
    const metaJson = asObject(body.metaJson);

    await prisma.cavCloudActivity.create({
      data: {
        accountId: sess.accountId,
        operatorUserId: sess.sub,
        action,
        targetType,
        targetId,
        targetPath,
        metaJson: (metaJson || undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    return jsonNoStore({ ok: true }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to record activity.");
  }
}
