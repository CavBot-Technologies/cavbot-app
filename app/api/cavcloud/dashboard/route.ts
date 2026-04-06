import type { Prisma } from "@prisma/client";

import { ApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import {
  findLatestEntitledSubscription,
  isTrialSeatEntitled,
  resolveEffectivePlanId as resolveEffectiveAccountPlanId,
} from "@/lib/accountPlan.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { CAVCLOUD_ACTIVITY_OPERATION_KINDS } from "@/lib/cavcloud/historyLayers.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { getPlanLimits, type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STAR_ACTIONS = new Set(["file.star", "folder.star", "file.unstar", "folder.unstar"]);
const FALLBACK_ACTIVITY_ACTIONS = new Set([
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
  "share.create",
  "share.revoke",
  "share.unshare",
  "file.update",
  "folder.update",
  "artifact.publish",
  "artifact.unpublish",
  "collab.grant",
  "collab.revoke",
  "access_granted",
  "access_revoked",
]);

function toSafeNumber(value: bigint): number {
  if (value <= BigInt(0)) return 0;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  return Number(value);
}

function parseBigIntLike(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) {
      try {
        return BigInt(trimmed);
      } catch {
        return BigInt(0);
      }
    }
  }
  return BigInt(0);
}

function parseDateLike(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function basename(path: string): string {
  const parts = String(path || "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function normalizePath(raw: unknown): string {
  const input = String(raw || "").trim();
  if (!input) return "/";
  const withSlash = input.startsWith("/") ? input : `/${input}`;
  const normalized = withSlash.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function asMetaObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRange(raw: string | null): { key: "7d"; start: Date } {
  const normalized = String(raw || "").trim().toLowerCase();
  if (normalized === "7d" || !normalized) {
    return { key: "7d", start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
  }
  return { key: "7d", start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
}

type AccountPlanShape = {
  tier: unknown;
  trialSeatActive: boolean;
  trialEndsAt: Date | null;
};

function resolveEffectivePlanId(account: AccountPlanShape | null): PlanId {
  return resolveEffectiveAccountPlanId({
    account,
  });
}

function storageLimitBytesForPlan(planId: PlanId): number | null {
  const limits = getPlanLimits(planId);
  if (limits.storageGb === "unlimited") return null;
  const bytes = Number(limits.storageGb || 0) * 1024 * 1024 * 1024;
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.trunc(bytes);
}

function planLimitBytes(account: AccountPlanShape | null, planId: PlanId): number | null {
  if (isTrialSeatEntitled(account)) return null;
  return storageLimitBytesForPlan(planId);
}

function isMissingUsagePointTableError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  return msg.includes("cavcloudusagepoint") && (msg.includes("does not exist") || msg.includes("relation"));
}

let cavCloudUsagePointTableAvailable: boolean | null = null;

function parseSqlBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "bigint") return value !== BigInt(0);
  const text = String(value || "").trim().toLowerCase();
  return text === "true" || text === "t" || text === "1" || text === "yes";
}

async function ensureUsagePointTableAvailable(): Promise<boolean> {
  if (cavCloudUsagePointTableAvailable != null) return cavCloudUsagePointTableAvailable;
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: unknown }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'CavCloudUsagePoint'
      ) AS "exists"
    `;
    const exists = parseSqlBool(rows[0]?.exists);
    cavCloudUsagePointTableAvailable = exists;
    return exists;
  } catch {
    cavCloudUsagePointTableAvailable = false;
    return false;
  }
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

function isCavCloudDashboardSchemaMismatch(err: unknown) {
  return isSchemaMismatchError(err, {
    tables: [
      "Account",
      "CavCloudFile",
      "CavCloudFolder",
      "CavCloudUsagePoint",
      "CavCloudOperationLog",
      "CavCloudActivity",
      "CavCloudStorageShare",
      "CavCloudShare",
      "PublicArtifact",
      "CavCloudFolderUploadSession",
      "CavCloudImportSession",
    ],
    columns: [
      "tier",
      "trialSeatActive",
      "trialEndsAt",
      "bytes",
      "deletedAt",
      "mimeType",
      "name",
      "path",
      "folderId",
      "bucketStart",
      "usedBytes",
      "kind",
      "subjectType",
      "subjectId",
      "label",
      "meta",
      "action",
      "targetType",
      "targetId",
      "targetPath",
      "metaJson",
      "expiresAt",
      "revokedAt",
      "sourcePath",
      "displayTitle",
      "visibility",
      "publishedAt",
      "rootFolderId",
      "resolvedRootName",
      "discoveredFilesCount",
      "finalizedFilesCount",
      "failedFilesCount",
      "provider",
      "status",
      "targetFolderId",
      "discoveredCount",
      "importedCount",
      "failedCount",
    ],
  });
}

function degradedDashboardPayload(account: AccountPlanShape | null = null) {
  const planId = resolveEffectivePlanId(account);
  const totalBytesLimit = planLimitBytes(account, planId);
  return {
    ok: true,
    degraded: true,
    storage: {
      usedBytes: 0,
      totalBytesLimit,
      freeBytes: totalBytesLimit,
      growthBytesRange: 0,
      trendPoints: [{ t: Date.now(), usedBytes: 0 }],
      breakdown: ["images", "video", "code", "docs", "archives", "other"].map((kind) => ({ kind, bytes: 0 })),
      largestFolders: [],
    },
    activity: {
      events: [],
    },
    sharesArtifacts: {
      activeSharesCount: 0,
      expiringSoon: [],
      recentArtifacts: [],
    },
    pinned: {
      items: [],
    },
    uploads: {
      activeFolderUploads: [],
    },
  };
}

async function buildDegradedDashboardResponse(req: Request) {
  const sess = await requireSession(req);
  requireAccountContext(sess);
  requireUser(sess);
  const accountId = String(sess.accountId || "");

  const [account, entitledSubscription] = await Promise.all([
    prisma.account
      .findUnique({
        where: { id: accountId },
        select: { tier: true, trialSeatActive: true, trialEndsAt: true },
      })
      .catch((error) => {
        if (
          isSchemaMismatchError(error, {
            tables: ["Account"],
            columns: ["tier", "trialSeatActive", "trialEndsAt"],
          })
        ) {
          return null;
        }
        throw error;
      }),
    findLatestEntitledSubscription(accountId),
  ]);

  const degradedAccount = account
    ? {
        ...account,
        tier: planTierFromAccountAndSubscription(account, entitledSubscription),
      }
    : null;

  return jsonNoStore(degradedDashboardPayload(degradedAccount), 200);
}

function planTierFromAccountAndSubscription(
  account: AccountPlanShape | null,
  subscription: { tier?: unknown; status?: unknown; currentPeriodEnd?: Date | null } | null,
) {
  const planId = resolveEffectiveAccountPlanId({
    account,
    subscription,
  });
  if (planId === "premium_plus") return "ENTERPRISE";
  if (planId === "premium") return "PREMIUM";
  return "FREE";
}

function sanitizeEventMeta(args: {
  subjectType: string;
  subjectId: string;
  label: string;
  meta: Record<string, unknown> | null;
}) {
  const out: Record<string, string | number | boolean | null> = {};
  const input = args.meta;

  const allow = [
    "fileId",
    "folderId",
    "artifactId",
    "shareId",
    "fromPath",
    "toPath",
    "targetPath",
    "path",
    "visibility",
    "mode",
    "expiresInDays",
    "expiresAtISO",
    "channel",
    "kind",
    "action",
  ] as const;

  for (const key of allow) {
    const value = input?.[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      out[key] = trimmed.slice(0, 900);
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (value === null) {
      out[key] = null;
    }
  }

  const rawLabel = String(args.label || "").trim();
  if (rawLabel.startsWith("/")) out.path = normalizePath(rawLabel);

  if (args.subjectType === "file") out.fileId = out.fileId || args.subjectId;
  if (args.subjectType === "folder") out.folderId = out.folderId || args.subjectId;
  if (args.subjectType === "share") out.shareId = out.shareId || args.subjectId;
  if (args.subjectType === "artifact") out.artifactId = out.artifactId || args.subjectId;

  return out;
}

function formatOperationLabel(kind: string, meta: Record<string, unknown> | null): string {
  const upper = String(kind || "").trim().toUpperCase();
  if (upper === "UPLOAD_FILE" || upper === "FILE_UPLOADED") {
    const action = String(meta?.action || "").trim().toLowerCase();
    const fileCount = Number(meta?.fileCount || 0);
    if (action === "upload.folder" || Number.isFinite(fileCount) && fileCount > 1) return "Upload folder completed";
    return "Uploaded file";
  }
  if (upper === "CREATE_FOLDER") return "Created folder";
  if (upper === "MOVE_FILE" || upper === "FOLDER_MOVED") return "Moved item";
  if (upper === "RENAME_FILE" || upper === "FILE_RENAMED") return "Renamed item";
  if (upper === "DELETE_FILE" || upper === "FILE_DELETED") return "Moved to Trash";
  if (upper === "RESTORE_FILE") return "Restored from Trash";
  if (upper === "SHARE_CREATED") return "Shared link created";
  if (upper === "SHARE_REVOKED") return "Share revoked";
  if (upper === "DUPLICATE_FILE") return "Duplicated file";
  if (upper === "ZIP_CREATED") return "Created zip";
  if (upper === "PUBLISHED_ARTIFACT" || upper === "ARTIFACT_PUBLISHED") return "Published artifact";
  if (upper === "UNPUBLISHED_ARTIFACT") return "Updated artifact visibility";
  if (upper === "GOOGLE_DRIVE_CONNECTED") return "Google Drive connected";
  if (upper === "GOOGLE_DRIVE_DISCONNECTED") return "Google Drive disconnected";
  if (upper === "GOOGLE_DRIVE_IMPORT_STARTED") return "Google Drive import started";
  if (upper === "GOOGLE_DRIVE_IMPORT_COMPLETED") return "Google Drive import completed";
  if (upper === "GOOGLE_DRIVE_IMPORT_FILE_FAILED") return "Google Drive file import failed";
  if (upper === "COLLAB_GRANTED" || upper === "ACCESS_GRANTED") return "Collaboration granted";
  if (upper === "COLLAB_REVOKED" || upper === "ACCESS_REVOKED") return "Collaboration revoked";
  return upper.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()) || "Activity";
}

function downsampleTrend(points: Array<{ t: number; usedBytes: number }>, maxPoints = 14): Array<{ t: number; usedBytes: number }> {
  if (points.length <= maxPoints) return points;
  const out: Array<{ t: number; usedBytes: number }> = [];
  const denom = Math.max(1, maxPoints - 1);
  const span = points.length - 1;
  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.min(points.length - 1, Math.round((i * span) / denom));
    out.push(points[index]);
  }
  return out;
}

async function accountPathSetFor(accountId: string, paths: string[]): Promise<Set<string>> {
  const normalized = Array.from(new Set(paths.map((p) => normalizePath(p)).filter((p) => p !== "/"))).slice(0, 600);
  if (!normalized.length) return new Set<string>();

  const [fileRows, folderRows] = await Promise.all([
    prisma.cavCloudFile.findMany({
      where: {
        accountId,
        deletedAt: null,
        path: { in: normalized },
      },
      select: { path: true },
    }),
    prisma.cavCloudFolder.findMany({
      where: {
        accountId,
        deletedAt: null,
        path: { in: normalized },
      },
      select: { path: true },
    }),
  ]).catch((error) => {
    if (isCavCloudDashboardSchemaMismatch(error)) {
      return [[], []] as const;
    }
    throw error;
  });

  const out = new Set<string>();
  for (const row of fileRows) out.add(normalizePath(row.path));
  for (const row of folderRows) out.add(normalizePath(row.path));
  return out;
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const accountId = String(sess.accountId || "").trim();
    const userId = String(sess.sub || "").trim();
    const url = new URL(req.url);
    const range = parseRange(url.searchParams.get("range"));
    const now = new Date();

    const [
      account,
      entitledSubscription,
      bytesAgg,
      breakdownRows,
      largestFolderRows,
      usageRows,
      operationRowsResult,
      storageShareCount,
      storageShareExpiring,
      artifactShareRows,
      artifactRows,
      starActivityRows,
      activeFolderUploads,
      activeGoogleDriveImports,
    ] = await Promise.all([
      prisma.account.findUnique({
        where: { id: accountId },
        select: {
          tier: true,
          trialSeatActive: true,
          trialEndsAt: true,
        },
      }).catch((error) => {
        if (
          isSchemaMismatchError(error, {
            tables: ["Account"],
            columns: ["tier", "trialSeatActive", "trialEndsAt"],
          })
        ) {
          return null;
        }
        throw error;
      }),
      findLatestEntitledSubscription(accountId),
      prisma.cavCloudFile.aggregate({
        where: {
          accountId,
          deletedAt: null,
        },
        _sum: {
          bytes: true,
        },
      }),
      prisma.$queryRaw<Array<{ kind: string; bytes: unknown }>>`
        SELECT
          CASE
            WHEN "mimeType" ILIKE 'image/%'
              OR "name" ~* '\\.(png|jpe?g|gif|webp|avif|svg|bmp|heic|heif|tiff?)$'
              THEN 'images'
            WHEN "mimeType" ILIKE 'video/%'
              OR "name" ~* '\\.(mp4|mov|m4v|webm|ogv|ogg|avi|mkv|wmv|flv|3gp)$'
              THEN 'video'
            WHEN "name" ~* '\\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst)$'
              THEN 'archives'
            WHEN "mimeType" IN (
              'application/pdf',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-powerpoint',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/rtf',
              'text/plain',
              'text/csv'
            )
              OR "name" ~* '\\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|csv|tsv|md)$'
              THEN 'docs'
            WHEN "name" ~* '\\.(ts|tsx|js|jsx|mjs|cjs|json|yaml|yml|xml|html?|css|scss|sass|less|py|go|rs|java|c|cc|cpp|hpp|h|sh|bash|zsh|sql)$'
              OR "mimeType" ILIKE 'text/%'
              OR "mimeType" IN ('application/json', 'application/xml', 'application/javascript', 'text/javascript', 'application/typescript', 'text/typescript')
              THEN 'code'
            ELSE 'other'
          END AS "kind",
          COALESCE(SUM("bytes"), 0) AS "bytes"
        FROM "CavCloudFile"
        WHERE "accountId" = ${accountId}
          AND "deletedAt" IS NULL
        GROUP BY 1
      `,
      prisma.$queryRaw<Array<{ folderId: string; name: string; path: string; bytes: unknown }>>`
        SELECT
          f."folderId" AS "folderId",
          d."name" AS "name",
          d."path" AS "path",
          COALESCE(SUM(f."bytes"), 0) AS "bytes"
        FROM "CavCloudFile" f
        INNER JOIN "CavCloudFolder" d
          ON d."id" = f."folderId"
         AND d."accountId" = ${accountId}
         AND d."deletedAt" IS NULL
        WHERE f."accountId" = ${accountId}
          AND f."deletedAt" IS NULL
          AND d."path" <> '/'
        GROUP BY f."folderId", d."name", d."path"
        ORDER BY SUM(f."bytes") DESC
        LIMIT 3
      `,
      (async () => {
        if (!(await ensureUsagePointTableAvailable())) return [];
        try {
          const rows = await prisma.$queryRaw<Array<{ bucketStart: unknown; usedBytes: unknown }>>`
            SELECT "bucketStart", "usedBytes"
            FROM "CavCloudUsagePoint"
            WHERE "accountId" = ${accountId}
              AND "bucketStart" >= ${range.start}
            ORDER BY "bucketStart" ASC
            LIMIT 240
          `;
          cavCloudUsagePointTableAvailable = true;
          return rows;
        } catch (err) {
          if (isMissingUsagePointTableError(err)) {
            cavCloudUsagePointTableAvailable = false;
            return [];
          }
          throw err;
        }
      })(),
      (async () => {
        try {
          const rows = await prisma.cavCloudOperationLog.findMany({
            where: {
              accountId,
              kind: {
                in: CAVCLOUD_ACTIVITY_OPERATION_KINDS,
              },
            },
            orderBy: { createdAt: "desc" },
            take: 80,
            select: {
              id: true,
              kind: true,
              subjectType: true,
              subjectId: true,
              label: true,
              meta: true,
              createdAt: true,
            },
          });
          return { mode: "operation" as const, rows };
        } catch (err) {
          if (!isMissingOperationLogTableError(err) && !isCavCloudDashboardSchemaMismatch(err)) throw err;
          try {
            const fallback = await prisma.cavCloudActivity.findMany({
              where: {
                accountId,
                action: { in: Array.from(FALLBACK_ACTIVITY_ACTIONS) },
              },
              orderBy: { createdAt: "desc" },
              take: 80,
              select: {
                id: true,
                action: true,
                targetType: true,
                targetId: true,
                targetPath: true,
                metaJson: true,
                createdAt: true,
              },
            });
            return { mode: "activity" as const, rows: fallback };
          } catch (fallbackError) {
            if (isCavCloudDashboardSchemaMismatch(fallbackError)) {
              return { mode: "activity" as const, rows: [] };
            }
            throw fallbackError;
          }
        }
      })(),
      (async () => {
        try {
          return await prisma.cavCloudStorageShare.count({
            where: {
              accountId,
              revokedAt: null,
              expiresAt: { gt: now },
            },
          });
        } catch (error) {
          if (isCavCloudDashboardSchemaMismatch(error)) return 0;
          throw error;
        }
      })(),
      (async () => {
        try {
          return await prisma.cavCloudStorageShare.findMany({
            where: {
              accountId,
              revokedAt: null,
              expiresAt: { gt: now },
            },
            orderBy: { expiresAt: "asc" },
            take: 12,
            select: {
              id: true,
              expiresAt: true,
              file: {
                select: {
                  id: true,
                  name: true,
                  path: true,
                },
              },
              folder: {
                select: {
                  id: true,
                  name: true,
                  path: true,
                },
              },
            },
          });
        } catch (error) {
          if (isCavCloudDashboardSchemaMismatch(error)) return [];
          throw error;
        }
      })(),
      (async () => {
        try {
          return await prisma.cavCloudShare.findMany({
            where: {
              createdByUserId: userId,
              revokedAt: null,
              expiresAt: { gt: now },
            },
            orderBy: { expiresAt: "asc" },
            take: 120,
            select: {
              id: true,
              expiresAt: true,
              artifact: {
                select: {
                  sourcePath: true,
                  displayTitle: true,
                },
              },
            },
          });
        } catch (error) {
          if (isCavCloudDashboardSchemaMismatch(error)) return [];
          throw error;
        }
      })(),
      (async () => {
        try {
          return await prisma.publicArtifact.findMany({
            where: {
              userId,
              sourcePath: { not: null },
            },
            orderBy: { updatedAt: "desc" },
            take: 80,
            select: {
              id: true,
              sourcePath: true,
              displayTitle: true,
              visibility: true,
              publishedAt: true,
              updatedAt: true,
            },
          });
        } catch (error) {
          if (isCavCloudDashboardSchemaMismatch(error)) return [];
          throw error;
        }
      })(),
      (async () => {
        try {
          return await prisma.cavCloudActivity.findMany({
            where: {
              accountId,
              action: {
                in: ["file.star", "folder.star", "file.unstar", "folder.unstar"],
              },
            },
            orderBy: { createdAt: "desc" },
            take: 4000,
            select: {
              action: true,
              targetType: true,
              targetId: true,
              targetPath: true,
              createdAt: true,
            },
          });
        } catch (error) {
          if (isCavCloudDashboardSchemaMismatch(error)) return [];
          throw error;
        }
      })(),
      (async () => {
        try {
          return await prisma.cavCloudFolderUploadSession.findMany({
            where: {
              accountId,
              status: {
                in: ["CREATED", "UPLOADING", "FAILED"],
              },
            },
            orderBy: { updatedAt: "desc" },
            take: 10,
            select: {
              id: true,
              rootFolderId: true,
              status: true,
              resolvedRootName: true,
              discoveredFilesCount: true,
              finalizedFilesCount: true,
              failedFilesCount: true,
              rootFolder: {
                select: {
                  path: true,
                },
              },
            },
          });
        } catch (error) {
          if (isCavCloudDashboardSchemaMismatch(error)) return [];
          throw error;
        }
      })(),
      (async () => {
        try {
          return await prisma.cavCloudImportSession.findMany({
            where: {
              accountId,
              provider: "GOOGLE_DRIVE",
              status: {
                in: ["CREATED", "RUNNING", "FAILED"],
              },
            },
            orderBy: {
              updatedAt: "desc",
            },
            take: 10,
            select: {
              id: true,
              targetFolderId: true,
              status: true,
              discoveredCount: true,
              importedCount: true,
              failedCount: true,
              targetFolder: {
                select: {
                  path: true,
                  name: true,
                },
              },
            },
          });
        } catch (error) {
          if (isCavCloudDashboardSchemaMismatch(error)) return [];
          throw error;
        }
      })(),
    ]);

    const usedBig = bytesAgg._sum.bytes ?? BigInt(0);
    const usedBytes = toSafeNumber(usedBig);
    const planId = resolveEffectiveAccountPlanId({
      account,
      subscription: entitledSubscription,
    });
    const totalBytesLimit = planLimitBytes(account, planId);
    const freeBytes = totalBytesLimit == null ? null : Math.max(0, totalBytesLimit - usedBytes);

    const trendPointsRaw = usageRows
      .map((row) => {
        const t = parseDateLike(row.bucketStart)?.getTime() || 0;
        const used = toSafeNumber(parseBigIntLike(row.usedBytes));
        if (!Number.isFinite(t) || t <= 0) return null;
        return { t, usedBytes: used };
      })
      .filter((row): row is { t: number; usedBytes: number } => !!row)
      .sort((left, right) => left.t - right.t);

    const trendPointsWithNow = [...trendPointsRaw];
    const lastTrend = trendPointsWithNow.length ? trendPointsWithNow[trendPointsWithNow.length - 1] : null;
    if (!lastTrend || Math.abs(Date.now() - lastTrend.t) > 45 * 60 * 1000) {
      trendPointsWithNow.push({
        t: Date.now(),
        usedBytes,
      });
    }

    const growthBytesRange = trendPointsWithNow.length >= 2
      ? Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, trendPointsWithNow[trendPointsWithNow.length - 1].usedBytes - trendPointsWithNow[0].usedBytes))
      : 0;

    const breakdownMap = new Map<string, number>();
    for (const row of breakdownRows) {
      breakdownMap.set(String(row.kind || "other").toLowerCase(), toSafeNumber(parseBigIntLike(row.bytes)));
    }
    const breakdown = ["images", "video", "code", "docs", "archives", "other"].map((kind) => ({
      kind,
      bytes: Math.max(0, Number(breakdownMap.get(kind) || 0)),
    }));

    const largestFolders = largestFolderRows.map((row) => ({
      folderId: String(row.folderId || ""),
      name: String(row.name || basename(row.path) || "Folder"),
      bytes: toSafeNumber(parseBigIntLike(row.bytes)),
      path: normalizePath(row.path),
    })).filter((row) => row.folderId && row.path);

    const operationEvents = operationRowsResult.mode === "operation"
      ? operationRowsResult.rows.map((row) => {
        const meta = asMetaObject(row.meta as Prisma.JsonValue | null | undefined);
        return {
          id: row.id,
          kind: String(row.kind || "").toUpperCase(),
          label: formatOperationLabel(String(row.kind || ""), meta),
          createdAt: row.createdAt.toISOString(),
          subjectType: String(row.subjectType || "file").toLowerCase(),
          subjectId: String(row.subjectId || row.id),
          metaSafe: sanitizeEventMeta({
            subjectType: String(row.subjectType || "file").toLowerCase(),
            subjectId: String(row.subjectId || row.id),
            label: String(row.label || ""),
            meta,
          }),
        };
      })
      : operationRowsResult.rows.map((row) => {
        const action = String(row.action || "").toLowerCase();
        const targetType = String(row.targetType || "file").toLowerCase();
        const targetId = String(row.targetId || row.id);
        const targetPath = String(row.targetPath || "");
        const meta = asMetaObject(row.metaJson as Prisma.JsonValue | null | undefined);

        const pseudoKind = (() => {
          if (action.startsWith("upload") || action.startsWith("file.upload")) return "FILE_UPLOADED";
          if (action.startsWith("share.")) return action.includes("revoke") || action.includes("unshare") ? "SHARE_REVOKED" : "SHARE_CREATED";
          if (action.startsWith("artifact.")) return action.includes("unpublish") ? "UNPUBLISHED_ARTIFACT" : "ARTIFACT_PUBLISHED";
          if (action === "collab.grant" || action === "access_granted") return "COLLAB_GRANTED";
          if (action === "collab.revoke" || action === "access_revoked") return "COLLAB_REVOKED";
          if (action.includes("restore")) return "RESTORE_FILE";
          if (action === "folder.update") return "FOLDER_MOVED";
          if (action === "file.update") return "FILE_RENAMED";
          if (action.includes("delete")) return "DELETE_FILE";
          if (action.includes("rename") || action.includes("update")) return "FILE_RENAMED";
          if (action.includes("create") && targetType === "folder") return "CREATE_FOLDER";
          return "FILE_UPLOADED";
        })();

        return {
          id: row.id,
          kind: pseudoKind,
          label: formatOperationLabel(pseudoKind, meta),
          createdAt: row.createdAt.toISOString(),
          subjectType: targetType,
          subjectId: targetId,
          metaSafe: sanitizeEventMeta({
            subjectType: targetType,
            subjectId: targetId,
            label: targetPath,
            meta,
          }),
        };
      });

    const artifactSourcePaths = artifactRows.map((row) => String(row.sourcePath || "")).filter(Boolean);
    const artifactShareSourcePaths = artifactShareRows
      .map((row) => String(row.artifact?.sourcePath || "").trim())
      .filter(Boolean);

    const pathScopeSet = await accountPathSetFor(accountId, [...artifactSourcePaths, ...artifactShareSourcePaths]);

    const scopedArtifactShares = artifactShareRows.filter((row) => {
      const path = normalizePath(row.artifact?.sourcePath || "");
      return path !== "/" && pathScopeSet.has(path);
    });

    const scopedArtifacts = artifactRows.filter((row) => {
      const path = normalizePath(row.sourcePath || "");
      return path !== "/" && pathScopeSet.has(path);
    });

    const activeSharesCount = storageShareCount + scopedArtifactShares.length;

    const expiringSoonCombined = [
      ...storageShareExpiring.map((row) => ({
        shareId: row.id,
        label: row.file?.path || row.folder?.path || row.file?.name || row.folder?.name || "Shared item",
        expiresAt: row.expiresAt.toISOString(),
      })),
      ...scopedArtifactShares.map((row) => ({
        shareId: row.id,
        label: String(row.artifact?.sourcePath || row.artifact?.displayTitle || "Shared artifact"),
        expiresAt: row.expiresAt.toISOString(),
      })),
    ]
      .sort((left, right) => (Date.parse(left.expiresAt) || 0) - (Date.parse(right.expiresAt) || 0))
      .slice(0, 3);

    const recentArtifacts = scopedArtifacts.slice(0, 3).map((row) => ({
      artifactId: row.id,
      title: String(row.displayTitle || basename(String(row.sourcePath || "")) || "Artifact"),
      visibility: String(row.visibility || "PRIVATE"),
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      sourcePath: normalizePath(row.sourcePath || ""),
    }));

    const starRowsChronological = [...starActivityRows].reverse();
    const pinnedMap = new Map<string, { kind: "file" | "folder"; name: string; path: string; fileId?: string; folderId?: string; createdAt: number }>();

    for (const row of starRowsChronological) {
      const action = String(row.action || "").toLowerCase();
      if (!STAR_ACTIONS.has(action)) continue;

      const kind: "file" | "folder" = action.startsWith("folder") || String(row.targetType || "").toLowerCase() === "folder" ? "folder" : "file";
      const path = normalizePath(row.targetPath || "");
      const targetId = String(row.targetId || "").trim();
      const key = path !== "/" ? `${kind}:${path}` : `${kind}:${targetId || row.createdAt.toISOString()}`;

      if (action.endsWith(".star")) {
        pinnedMap.set(key, {
          kind,
          name: basename(path) || (kind === "folder" ? "Folder" : "File"),
          path,
          fileId: kind === "file" ? targetId || undefined : undefined,
          folderId: kind === "folder" ? targetId || undefined : undefined,
          createdAt: row.createdAt.getTime(),
        });
      } else {
        pinnedMap.delete(key);
      }
    }

    const pinnedItems = Array.from(pinnedMap.values())
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 6)
      .map((item, index) => ({
        id: `${item.kind}:${item.fileId || item.folderId || item.path || index}`,
        kind: item.kind,
        name: item.name,
        folderId: item.folderId || null,
        fileId: item.fileId || null,
        path: item.path,
      }));

    const uploads = [
      ...activeFolderUploads.map((session) => ({
        sessionId: session.id,
        rootFolderId: session.rootFolderId,
        rootFolderPath: normalizePath(session.rootFolder?.path || ""),
        rootName: String(session.resolvedRootName || basename(session.rootFolder?.path || "") || "Upload"),
        status: String(session.status || "CREATED"),
        discovered: Math.max(0, Number(session.discoveredFilesCount || 0)),
        uploaded: Math.max(0, Number(session.finalizedFilesCount || 0)),
        failed: Math.max(0, Number(session.failedFilesCount || 0)),
        provider: "LOCAL_UPLOAD",
      })),
      ...activeGoogleDriveImports.map((session) => ({
        sessionId: session.id,
        rootFolderId: session.targetFolderId,
        rootFolderPath: normalizePath(session.targetFolder?.path || ""),
        rootName: `Google Drive • ${String(session.targetFolder?.name || "Import")}`,
        status: String(session.status || "RUNNING"),
        discovered: Math.max(0, Number(session.discoveredCount || 0)),
        uploaded: Math.max(0, Number(session.importedCount || 0)),
        failed: Math.max(0, Number(session.failedCount || 0)),
        provider: "GOOGLE_DRIVE",
      })),
    ].map((session) => ({
      sessionId: session.sessionId,
      rootFolderId: session.rootFolderId,
      rootFolderPath: session.rootFolderPath,
      rootName: session.rootName,
      status: session.status,
      discovered: session.discovered,
      uploaded: session.uploaded,
      failed: session.failed,
      provider: session.provider,
    }));

    return jsonNoStore({
      ok: true,
      storage: {
        usedBytes,
        totalBytesLimit,
        freeBytes,
        growthBytesRange,
        trendPoints: downsampleTrend(trendPointsWithNow).map((point) => ({
          t: point.t,
          usedBytes: point.usedBytes,
        })),
        breakdown,
        largestFolders,
      },
      activity: {
        events: operationEvents,
      },
      sharesArtifacts: {
        activeSharesCount,
        expiringSoon: expiringSoonCombined,
        recentArtifacts,
      },
      pinned: {
        items: pinnedItems,
      },
      uploads: {
        activeFolderUploads: uploads,
      },
    }, 200);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return cavcloudErrorResponse(err, "Failed to load CavCloud dashboard.");
    }
    if (isMissingUsagePointTableError(err) || isMissingOperationLogTableError(err) || isCavCloudDashboardSchemaMismatch(err)) {
      try {
        return await buildDegradedDashboardResponse(req);
      } catch (fallbackError) {
        return cavcloudErrorResponse(fallbackError, "Failed to load CavCloud dashboard.");
      }
    }
    try {
      return await buildDegradedDashboardResponse(req);
    } catch {}
    return cavcloudErrorResponse(err, "Failed to load CavCloud dashboard.");
  }
}
