import type { CavSafeOperationKind, Prisma } from "@prisma/client";

import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { cavsafeSecuredStorageLimitBytesForPlan } from "@/lib/cavsafe/policy.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACTIVITY_KINDS: CavSafeOperationKind[] = [
  "CREATE_FOLDER",
  "UPLOAD_FILE",
  "MOVE",
  "RENAME",
  "DELETE",
  "RESTORE",
  "MOVE_IN",
  "MOVE_OUT",
  "PUBLISH_ARTIFACT",
  "SNAPSHOT_CREATED",
];

const AUDIT_KINDS: CavSafeOperationKind[] = [
  "ACCESS_ATTEMPT",
  "OPEN_DENIED",
  "SHARE_ATTEMPT",
  "IMMUTABLE_SET",
  "IMMUTABLE_CLEAR",
  "TIMELOCK_SET",
  "TIMELOCK_CLEAR",
  "SNAPSHOT_CREATED",
];

const RANGE_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
} as const;

type RangeToken = keyof typeof RANGE_MS;

function parseRange(raw: string | null): RangeToken {
  const normalized = String(raw || "").trim().toLowerCase();
  if (normalized === "24h") return "24h";
  return "7d";
}

function normalizePath(raw: unknown): string {
  const input = String(raw || "").trim();
  if (!input) return "/";
  const withSlash = input.startsWith("/") ? input : `/${input}`;
  const normalized = withSlash.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function basename(path: string): string {
  const parts = String(path || "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

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

function asMetaObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isMissingUsagePointTableError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  return msg.includes("cavsafeusagepoint") && (msg.includes("does not exist") || msg.includes("relation"));
}

let cavSafeUsagePointTableAvailable: boolean | null = null;

function parseSqlBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "bigint") return value !== BigInt(0);
  const text = String(value || "").trim().toLowerCase();
  return text === "true" || text === "t" || text === "1" || text === "yes";
}

async function ensureUsagePointTableAvailable(): Promise<boolean> {
  if (cavSafeUsagePointTableAvailable != null) return cavSafeUsagePointTableAvailable;
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: unknown }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'CavSafeUsagePoint'
      ) AS "exists"
    `;
    const exists = parseSqlBool(rows[0]?.exists);
    cavSafeUsagePointTableAvailable = exists;
    return exists;
  } catch {
    cavSafeUsagePointTableAvailable = false;
    return false;
  }
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

function operationLabel(kind: CavSafeOperationKind, fallbackLabel: string): string {
  const clean = String(fallbackLabel || "").trim();
  if (clean && !clean.startsWith("/")) return clean.slice(0, 220);

  if (kind === "CREATE_FOLDER") return "Created folder";
  if (kind === "UPLOAD_FILE") return "Uploaded file";
  if (kind === "MOVE") return "Moved item";
  if (kind === "RENAME") return "Renamed item";
  if (kind === "DELETE") return "Moved to trash";
  if (kind === "RESTORE") return "Restored item";
  if (kind === "MOVE_IN") return "Moved into CavSafe";
  if (kind === "MOVE_OUT") return "Moved out to CavCloud";
  if (kind === "PUBLISH_ARTIFACT") return "Published artifact";
  if (kind === "ACCESS_ATTEMPT") return "Access attempt";
  if (kind === "OPEN_DENIED") return "Open denied";
  if (kind === "SHARE_ATTEMPT") return "Share attempt blocked";
  if (kind === "IMMUTABLE_SET") return "Integrity lock enabled";
  if (kind === "IMMUTABLE_CLEAR") return "Integrity lock cleared";
  if (kind === "TIMELOCK_SET") return "Time lock updated";
  if (kind === "TIMELOCK_CLEAR") return "Time lock cleared";
  if (kind === "SNAPSHOT_CREATED") return "Snapshot created";
  return "CavSafe activity";
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
    "path",
    "fromPath",
    "toPath",
    "targetPath",
    "fileId",
    "folderId",
    "artifactId",
    "visibility",
    "code",
    "reasonCode",
    "unlockAtISO",
    "expireAtISO",
    "sourcePath",
    "mode",
    "kind",
    "direction",
    "movedFiles",
    "movedFolders",
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

  const pathFromLabel = String(args.label || "").trim();
  if (pathFromLabel.startsWith("/")) out.path = normalizePath(pathFromLabel);
  if (args.subjectType === "file") out.fileId = out.fileId || args.subjectId;
  if (args.subjectType === "folder") out.folderId = out.folderId || args.subjectId;
  if (args.subjectType === "artifact") out.artifactId = out.artifactId || args.subjectId;

  return out;
}

export async function GET(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);
    const url = new URL(req.url);
    const range = parseRange(url.searchParams.get("range"));
    const now = Date.now();
    const rangeStart = new Date(now - RANGE_MS[range]);
    const pulse24hStart = new Date(now - RANGE_MS["24h"]);
    const pulse7dStart = new Date(now - RANGE_MS["7d"]);
    const plus = sess.cavsafePremiumPlus;

    const [
      usageAgg,
      activityRows,
      publishRows,
      activeUploadRows,
      failedUploadRows,
      moveRows,
      trendRows,
    ] = await Promise.all([
      prisma.cavSafeFile.aggregate({
        where: {
          accountId: sess.accountId,
          deletedAt: null,
        },
        _sum: {
          bytes: true,
        },
      }),
      prisma.cavSafeOperationLog.findMany({
        where: {
          accountId: sess.accountId,
          kind: { in: ACTIVITY_KINDS },
        },
        orderBy: { createdAt: "desc" },
        take: 24,
        select: {
          id: true,
          kind: true,
          subjectType: true,
          subjectId: true,
          label: true,
          meta: true,
          createdAt: true,
        },
      }),
      prisma.cavSafeOperationLog.findMany({
        where: {
          accountId: sess.accountId,
          kind: "PUBLISH_ARTIFACT",
        },
        orderBy: { createdAt: "desc" },
        take: 160,
        select: {
          id: true,
          label: true,
          createdAt: true,
          meta: true,
        },
      }),
      prisma.cavSafeMultipartUpload.findMany({
        where: {
          accountId: sess.accountId,
          status: "CREATED",
        },
        orderBy: { updatedAt: "desc" },
        take: 18,
        select: {
          id: true,
          fileName: true,
          filePath: true,
          expectedBytes: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.cavSafeMultipartUpload.findMany({
        where: {
          accountId: sess.accountId,
          status: { in: ["ABORTED", "EXPIRED"] },
        },
        orderBy: { updatedAt: "desc" },
        take: 18,
        select: {
          id: true,
          status: true,
          fileName: true,
          filePath: true,
          updatedAt: true,
        },
      }),
      prisma.cavSafeOperationLog.findMany({
        where: {
          accountId: sess.accountId,
          kind: { in: ["MOVE_IN", "MOVE_OUT"] },
          createdAt: { gte: new Date(now - 20 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          kind: true,
          label: true,
          createdAt: true,
          meta: true,
        },
      }),
      (async () => {
        if (!(await ensureUsagePointTableAvailable())) return [];
        try {
          const rows = await prisma.$queryRaw<Array<{ bucketStart: unknown; usedBytes: unknown }>>`
            SELECT "bucketStart", "usedBytes"
            FROM "CavSafeUsagePoint"
            WHERE "accountId" = ${sess.accountId}
              AND "bucketStart" >= ${rangeStart}
            ORDER BY "bucketStart" ASC
            LIMIT 240
          `;
          cavSafeUsagePointTableAvailable = true;
          return rows;
        } catch (err) {
          if (isMissingUsagePointTableError(err)) {
            cavSafeUsagePointTableAvailable = false;
            return [];
          }
          throw err;
        }
      })(),
    ]);

    const usedBytes = toSafeNumber(usageAgg._sum.bytes ?? BigInt(0));
    const limitBig = cavsafeSecuredStorageLimitBytesForPlan(sess.cavsafePlanId);
    const limitBytes = toSafeNumber(limitBig);
    const freeBytes = Math.max(0, limitBytes - usedBytes);

    const trendPointsRaw = trendRows
      .map((row) => {
        const t = parseDateLike(row.bucketStart)?.getTime() || 0;
        if (!Number.isFinite(t) || t <= 0) return null;
        return {
          t,
          usedBytes: toSafeNumber(parseBigIntLike(row.usedBytes)),
        };
      })
      .filter((row): row is { t: number; usedBytes: number } => !!row)
      .sort((left, right) => left.t - right.t);

    const trendPointsWithNow = [...trendPointsRaw];
    const lastTrend = trendPointsWithNow.length ? trendPointsWithNow[trendPointsWithNow.length - 1] : null;
    if (!lastTrend || Math.abs(now - lastTrend.t) > 45 * 60 * 1000) {
      trendPointsWithNow.push({
        t: now,
        usedBytes,
      });
    }

    const growthBytesRange = trendPointsWithNow.length >= 2
      ? Math.max(
          -Number.MAX_SAFE_INTEGER,
          Math.min(
            Number.MAX_SAFE_INTEGER,
            trendPointsWithNow[trendPointsWithNow.length - 1].usedBytes - trendPointsWithNow[0].usedBytes,
          ),
        )
      : 0;

    const uploadIds = activeUploadRows.map((row) => row.id);
    const uploadPartRows = uploadIds.length
      ? await prisma.cavSafeMultipartPart.groupBy({
          by: ["uploadId"],
          where: {
            uploadId: { in: uploadIds },
          },
          _sum: {
            bytes: true,
          },
        })
      : [];
    const uploadPartBytesById = new Map(uploadPartRows.map((row) => [row.uploadId, Number(row._sum.bytes || 0)]));

    const activeUploads = activeUploadRows.map((row) => {
      const expectedBytes = row.expectedBytes ? toSafeNumber(row.expectedBytes) : 0;
      const uploadedBytes = Math.max(0, Number(uploadPartBytesById.get(row.id) || 0));
      const progress = expectedBytes > 0
        ? Math.max(0, Math.min(100, Math.round((uploadedBytes / expectedBytes) * 100)))
        : 0;

      return {
        id: row.id,
        kind: "file" as const,
        label: String(row.fileName || basename(row.filePath) || "Upload"),
        progress,
        status: uploadedBytes > 0 ? "UPLOADING" : "QUEUED",
      };
    });

    const activeMoves = moveRows.map((row) => {
      const meta = asMetaObject(row.meta);
      return {
        id: row.id,
        direction: row.kind === "MOVE_OUT" ? "OUT" : "IN",
        label: String(row.label || meta?.path || "Move operation"),
        status: "RECENT",
      };
    });

    const failedItems = failedUploadRows.map((row) => ({
      id: row.id,
      label: String(row.fileName || basename(row.filePath) || "Upload"),
      reasonCode: row.status === "EXPIRED" ? "UPLOAD_EXPIRED" : "UPLOAD_ABORTED",
      queueType: "upload",
    }));

    const activityEvents = activityRows.map((row) => {
      const subjectType = String(row.subjectType || "file").toLowerCase();
      const subjectId = String(row.subjectId || row.id);
      const meta = asMetaObject(row.meta);
      return {
        id: row.id,
        kind: row.kind,
        label: operationLabel(row.kind, row.label),
        createdAt: row.createdAt.toISOString(),
        subjectType,
        subjectId,
        metaSafe: sanitizeEventMeta({
          subjectType,
          subjectId,
          label: row.label,
          meta,
        }),
      };
    });

    const publishEvents = publishRows
      .map((row) => {
        const meta = asMetaObject(row.meta);
        const artifactId = String(meta?.artifactId || "").trim();
        const visibilityHint = String(meta?.visibility || "").trim().toUpperCase();
        return {
          artifactId,
          createdAt: row.createdAt,
          visibilityHint,
          fallbackTitle: String(row.label || "").trim(),
        };
      })
      .filter((row) => row.artifactId);

    const publishArtifactIds = Array.from(new Set(publishEvents.map((row) => row.artifactId))).slice(0, 120);
    const publishedArtifactRows = publishArtifactIds.length
      ? await prisma.publicArtifact.findMany({
          where: {
            id: { in: publishArtifactIds },
            userId: sess.sub,
          },
          select: {
            id: true,
            displayTitle: true,
            visibility: true,
            publishedAt: true,
            sourcePath: true,
          },
        })
      : [];
    const artifactById = new Map(publishedArtifactRows.map((row) => [row.id, row]));
    const seenRecentArtifacts = new Set<string>();
    const recentArtifacts: Array<{ artifactId: string; title: string; visibility: string; publishedAt: string | null; sourcePath?: string | null }> = [];

    for (const event of publishEvents) {
      if (seenRecentArtifacts.has(event.artifactId)) continue;
      seenRecentArtifacts.add(event.artifactId);
      const artifact = artifactById.get(event.artifactId);
      if (!artifact) continue;
      recentArtifacts.push({
        artifactId: artifact.id,
        title: String(artifact.displayTitle || basename(String(artifact.sourcePath || "")) || event.fallbackTitle || "Artifact"),
        visibility: String(artifact.visibility || event.visibilityHint || "PRIVATE"),
        publishedAt: artifact.publishedAt ? artifact.publishedAt.toISOString() : null,
        sourcePath: artifact.sourcePath ? normalizePath(artifact.sourcePath) : null,
      });
      if (recentArtifacts.length >= 3) break;
    }

    let securedStoragePremiumPlus: {
      growthBytesRange: number;
      trendPoints: Array<{ t: number; usedBytes: number }>;
      breakdown: Array<{ kind: string; bytes: number }>;
      topFolders: Array<{ folderId: string; name: string; bytes: number; path: string }>;
    } | null = null;

    let premiumPlusPayload: {
      locked: boolean;
      audit?: {
        pulse24h: Array<{ kind: string; count: number }>;
        pulse7d: Array<{ kind: string; count: number }>;
        recent: Array<{ id: string; kind: string; label: string; createdAt: string }>;
      };
      integrity?: { lockedCount: number; missingSha256Count: number };
      timeLocks?: { lockedCount: number; expiredCount: number; unlockingSoon: Array<{ fileId: string; name: string; unlockAt: string }> };
      snapshots?: { lastSnapshot?: { snapshotId: string; createdAt: string; sha256Prefix: string }; totalCount: number };
      mounts?: { count: number };
    } = { locked: true };

    let privateEvidenceCount: number | undefined;
    let privateEvidenceRecent: Array<{ artifactId: string; title: string; publishedAt: string | null }> | undefined;

    if (plus) {
      const [
        breakdownRows,
        topFolderRows,
        auditPulse24Rows,
        auditPulse7Rows,
        auditRecentRows,
        integrityLockedCount,
        integrityMissingShaRows,
        timeLockLockedCount,
        timeLockExpiredCount,
        unlockingSoonRows,
        lastSnapshot,
        snapshotTotalCount,
        mountCount,
      ] = await Promise.all([
        prisma.$queryRaw<Array<{ kind: string; bytes: unknown }>>`
          SELECT
            CASE
              WHEN "mimeType" ILIKE 'image/%'
                OR "name" ~* '\\.(png|jpe?g|gif|webp|avif|svg|bmp|heic|heif|tiff?)$'
                THEN 'images'
              WHEN "mimeType" ILIKE 'video/%'
                OR "name" ~* '\\.(mp4|mov|m4v|webm|ogv|ogg|avi|mkv|wmv|flv|3gp)$'
                THEN 'videos'
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
                THEN 'documents'
              WHEN "name" ~* '\\.(ts|tsx|js|jsx|mjs|cjs|json|yaml|yml|xml|html?|css|scss|sass|less|py|go|rs|java|c|cc|cpp|hpp|h|sh|bash|zsh|sql)$'
                OR "mimeType" ILIKE 'text/%'
                OR "mimeType" IN ('application/json', 'application/xml', 'application/javascript', 'text/javascript', 'application/typescript', 'text/typescript')
                THEN 'code'
              ELSE 'other'
            END AS "kind",
            COALESCE(SUM("bytes"), 0) AS "bytes"
          FROM "CavSafeFile"
          WHERE "accountId" = ${sess.accountId}
            AND "deletedAt" IS NULL
          GROUP BY 1
        `,
        prisma.$queryRaw<Array<{ folderId: string; name: string; path: string; bytes: unknown }>>`
          SELECT
            f."folderId" AS "folderId",
            d."name" AS "name",
            d."path" AS "path",
            COALESCE(SUM(f."bytes"), 0) AS "bytes"
          FROM "CavSafeFile" f
          INNER JOIN "CavSafeFolder" d
            ON d."id" = f."folderId"
           AND d."accountId" = ${sess.accountId}
           AND d."deletedAt" IS NULL
          WHERE f."accountId" = ${sess.accountId}
            AND f."deletedAt" IS NULL
            AND d."path" <> '/'
          GROUP BY f."folderId", d."name", d."path"
          ORDER BY SUM(f."bytes") DESC
          LIMIT 3
        `,
        prisma.cavSafeOperationLog.groupBy({
          by: ["kind"],
          where: {
            accountId: sess.accountId,
            kind: { in: AUDIT_KINDS },
            createdAt: { gte: pulse24hStart },
          },
          _count: { _all: true },
        }),
        prisma.cavSafeOperationLog.groupBy({
          by: ["kind"],
          where: {
            accountId: sess.accountId,
            kind: { in: AUDIT_KINDS },
            createdAt: { gte: pulse7dStart },
          },
          _count: { _all: true },
        }),
        prisma.cavSafeOperationLog.findMany({
          where: {
            accountId: sess.accountId,
            kind: { in: AUDIT_KINDS },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            kind: true,
            label: true,
            createdAt: true,
          },
        }),
        prisma.cavSafeFile.count({
          where: {
            accountId: sess.accountId,
            deletedAt: null,
            immutableAt: { not: null },
          },
        }),
        prisma.$queryRaw<Array<{ count: unknown }>>`
          SELECT COUNT(*) AS "count"
          FROM "CavSafeFile"
          WHERE "accountId" = ${sess.accountId}
            AND "deletedAt" IS NULL
            AND ("sha256" IS NULL OR "sha256" !~ '^[a-f0-9]{64}$')
        `,
        prisma.cavSafeFile.count({
          where: {
            accountId: sess.accountId,
            deletedAt: null,
            unlockAt: { gt: new Date(now) },
          },
        }),
        prisma.cavSafeFile.count({
          where: {
            accountId: sess.accountId,
            deletedAt: null,
            expireAt: { lt: new Date(now) },
          },
        }),
        prisma.cavSafeFile.findMany({
          where: {
            accountId: sess.accountId,
            deletedAt: null,
            unlockAt: { gt: new Date(now) },
          },
          orderBy: { unlockAt: "asc" },
          take: 3,
          select: {
            id: true,
            name: true,
            unlockAt: true,
          },
        }),
        prisma.cavSafeSnapshot.findFirst({
          where: {
            accountId: sess.accountId,
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            sha256: true,
          },
        }),
        prisma.cavSafeSnapshot.count({
          where: {
            accountId: sess.accountId,
          },
        }),
        prisma.cavSafeProjectMount.count({
          where: {
            accountId: sess.accountId,
          },
        }),
      ]);

      const breakdownMap = new Map(breakdownRows.map((row) => [String(row.kind || "other").toLowerCase(), toSafeNumber(parseBigIntLike(row.bytes))]));
      const breakdown = ["images", "videos", "documents", "archives", "code", "other"].map((kind) => ({
        kind,
        bytes: Math.max(0, Number(breakdownMap.get(kind) || 0)),
      }));

      const topFolders = topFolderRows.map((row) => ({
        folderId: String(row.folderId || ""),
        name: String(row.name || basename(String(row.path || "")) || "Folder"),
        bytes: toSafeNumber(parseBigIntLike(row.bytes)),
        path: normalizePath(row.path || "/"),
      })).filter((row) => row.folderId);

      securedStoragePremiumPlus = {
        growthBytesRange,
        trendPoints: downsampleTrend(trendPointsWithNow),
        breakdown,
        topFolders,
      };

      const privateArtifacts = publishEvents
        .map((event) => artifactById.get(event.artifactId))
        .filter((row): row is NonNullable<typeof row> => !!row && row.visibility === "PRIVATE");
      const uniquePrivate = new Map<string, NonNullable<typeof privateArtifacts[number]>>();
      for (const row of privateArtifacts) {
        if (!uniquePrivate.has(row.id)) uniquePrivate.set(row.id, row);
      }
      privateEvidenceCount = uniquePrivate.size;
      privateEvidenceRecent = Array.from(uniquePrivate.values()).slice(0, 2).map((row) => ({
        artifactId: row.id,
        title: String(row.displayTitle || basename(String(row.sourcePath || "")) || "Artifact"),
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      }));

      premiumPlusPayload = {
        locked: false,
        audit: {
          pulse24h: auditPulse24Rows.map((row) => ({
            kind: row.kind,
            count: row._count._all,
          })),
          pulse7d: auditPulse7Rows.map((row) => ({
            kind: row.kind,
            count: row._count._all,
          })),
          recent: auditRecentRows.map((row) => ({
            id: row.id,
            kind: row.kind,
            label: operationLabel(row.kind, row.label),
            createdAt: row.createdAt.toISOString(),
          })),
        },
        integrity: {
          lockedCount: integrityLockedCount,
          missingSha256Count: toSafeNumber(parseBigIntLike(integrityMissingShaRows[0]?.count)),
        },
        timeLocks: {
          lockedCount: timeLockLockedCount,
          expiredCount: timeLockExpiredCount,
          unlockingSoon: unlockingSoonRows.map((row) => ({
            fileId: row.id,
            name: row.name,
            unlockAt: row.unlockAt ? row.unlockAt.toISOString() : "",
          })).filter((row) => !!row.unlockAt),
        },
        snapshots: {
          lastSnapshot: lastSnapshot
            ? {
                snapshotId: lastSnapshot.id,
                createdAt: lastSnapshot.createdAt.toISOString(),
                sha256Prefix: String(lastSnapshot.sha256 || "").slice(0, 12),
              }
            : undefined,
          totalCount: snapshotTotalCount,
        },
        mounts: {
          count: mountCount,
        },
      };
    }

    return jsonNoStore({
      ok: true,
      tier: plus ? "PREMIUM_PLUS" : "PREMIUM",
      securedStorage: {
        usedBytes,
        limitBytes,
        freeBytes,
        growthBytesRange,
        ...(securedStoragePremiumPlus || {}),
      },
      activity: {
        events: activityEvents,
      },
      publishEvidence: {
        recentArtifacts,
        ...(typeof privateEvidenceCount === "number" ? { privateEvidenceCount } : {}),
        ...(privateEvidenceRecent ? { privateEvidenceRecent } : {}),
      },
      queue: {
        activeUploads,
        activeMoves,
        failedItems,
      },
      premiumPlus: premiumPlusPayload,
    }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to load CavSafe dashboard.");
  }
}
