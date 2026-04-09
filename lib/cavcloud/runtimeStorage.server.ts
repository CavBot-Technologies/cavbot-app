import "server-only";

import type pg from "pg";

import {
  findAccountById,
  getAuthPool,
  isPgUniqueViolation,
  newDbId,
  pgUniqueViolationMentions,
  withAuthTransaction,
} from "@/lib/authDb";
import {
  cavcloudPerFileMaxBytesForPlan,
  cavcloudStorageLimitBytesForPlan,
  resolveCavCloudEffectivePlan,
} from "@/lib/cavcloud/plan";
import type { CavCloudListingPreferences } from "@/lib/cavcloud/settings.server";
import type {
  CavCloudActivityItem,
  CavCloudFileItem,
  CavCloudFolderChildrenPayload,
  CavCloudFolderItem,
  CavCloudStoragePoint,
  CavCloudTreePayload,
} from "@/lib/cavcloud/storage.server";

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
};

type RawFolderRow = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt?: Date | string | null;
};

type RawFileRow = {
  id: string;
  folderId: string;
  name: string;
  path: string;
  relPath: string | null;
  r2Key: string;
  bytes: bigint | number | string | null;
  mimeType: string;
  sha256: string;
  previewSnippet: string | null;
  previewSnippetUpdatedAt: Date | string | null;
  status: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RawTreeTrashRow = {
  id: string;
  deletedAt: Date | string;
  purgeAfter: Date | string;
  fileId: string | null;
  fileName: string | null;
  filePath: string | null;
  fileBytes: bigint | number | string | null;
  folderId: string | null;
  folderName: string | null;
  folderPath: string | null;
};

type RawActivityRow = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetPath: string | null;
  metaJson: unknown;
  createdAt: Date | string;
};

type RawUsagePointRow = {
  bucketStart: Date | string;
  usedBytes: bigint | number | string | null;
};

const ROOT_PATH = "/";
const OPTIONAL_RELATION_CODES = new Set(["42P01", "42703"]);
const PAID_SUBSCRIPTION_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

function cavErr(code: string, status: number, message: string) {
  return Object.assign(new Error(message), {
    code,
    status,
  });
}

function normalizePath(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return ROOT_PATH;
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const normalized = withSlash.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function normalizePathNoTrailingSlash(raw: string): string {
  const normalized = normalizePath(raw);
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function safeNodeName(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) throw cavErr("NAME_REQUIRED", 400, "name is required");
  if (input === "." || input === "..") throw cavErr("NAME_INVALID", 400, "name is invalid");
  if (/[/\\]/.test(input)) throw cavErr("NAME_INVALID", 400, "name cannot contain slashes");
  if (/[\u0000-\u001f\u007f]/.test(input)) {
    throw cavErr("NAME_INVALID", 400, "name contains control characters");
  }
  const cleaned = input.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) throw cavErr("NAME_INVALID", 400, "name is invalid");
  return cleaned.length > 220 ? cleaned.slice(0, 220) : cleaned;
}

function joinPath(parentPath: string, name: string): string {
  const parent = normalizePathNoTrailingSlash(parentPath);
  if (parent === ROOT_PATH) return normalizePath(`/${name}`);
  return normalizePath(`${parent}/${name}`);
}

function buildBreadcrumbPaths(path: string): string[] {
  const normalized = normalizePathNoTrailingSlash(path);
  if (normalized === ROOT_PATH) return [ROOT_PATH];

  const parts = normalized.split("/").filter(Boolean);
  const out = [ROOT_PATH];
  let cursor = "";
  for (const part of parts) {
    cursor = `${cursor}/${part}`;
    out.push(cursor);
  }
  return out;
}

function parentPathFromAbsolutePath(path: string): string {
  const normalized = normalizePathNoTrailingSlash(path);
  if (normalized === ROOT_PATH) return ROOT_PATH;
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return ROOT_PATH;
  return normalized.slice(0, slash) || ROOT_PATH;
}

function isDirectChildPath(parentPath: string, candidatePath: string): boolean {
  const parent = normalizePathNoTrailingSlash(parentPath);
  const candidate = normalizePathNoTrailingSlash(candidatePath);
  if (candidate === parent) return false;
  return parentPathFromAbsolutePath(candidate) === parent;
}

function toISO(value: Date | string) {
  return new Date(value).toISOString();
}

function parseBigIntLike(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) return null;
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

function toSafeNumber(value: bigint) {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < BigInt(0)) return 0;
  return Number(value);
}

function normalizeFileStatus(value: unknown): "UPLOADING" | "READY" | "FAILED" {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "UPLOADING") return "UPLOADING";
  if (normalized === "FAILED") return "FAILED";
  return "READY";
}

function normalizeListingPrefs(
  prefs: CavCloudListingPreferences | null | undefined,
): CavCloudListingPreferences {
  return {
    defaultView: prefs?.defaultView === "list" ? "list" : "grid",
    defaultSort:
      prefs?.defaultSort === "modified" || prefs?.defaultSort === "size" || prefs?.defaultSort === "name"
        ? prefs.defaultSort
        : "name",
    foldersFirst: prefs?.foldersFirst !== false,
    showDotfiles: prefs?.showDotfiles === true,
    showExtensions: prefs?.showExtensions !== false,
  };
}

function isDotfileName(name: string): boolean {
  return String(name || "").trim().startsWith(".");
}

function fileListingStatusRank(value: unknown): number {
  const status = normalizeFileStatus(value);
  if (status === "READY") return 0;
  if (status === "UPLOADING") return 1;
  if (status === "FAILED") return 2;
  return 3;
}

function compareFolderRowsForListing(
  left: Pick<RawFolderRow, "name" | "path" | "updatedAt" | "createdAt">,
  right: Pick<RawFolderRow, "name" | "path" | "updatedAt" | "createdAt">,
  prefs: CavCloudListingPreferences,
) {
  if (prefs.defaultSort === "modified") {
    const modifiedDelta = new Date(String(right.updatedAt || right.createdAt || 0)).getTime()
      - new Date(String(left.updatedAt || left.createdAt || 0)).getTime();
    if (modifiedDelta !== 0) return modifiedDelta;
  }

  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;
  return left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
}

function compareFileRowsForListing(
  left: Pick<RawFileRow, "status" | "name" | "path" | "updatedAt" | "createdAt" | "bytes">,
  right: Pick<RawFileRow, "status" | "name" | "path" | "updatedAt" | "createdAt" | "bytes">,
  prefs: CavCloudListingPreferences,
) {
  const rank = fileListingStatusRank(left.status) - fileListingStatusRank(right.status);
  if (rank !== 0) return rank;

  if (prefs.defaultSort === "size") {
    const leftBytes = parseBigIntLike(left.bytes) ?? BigInt(0);
    const rightBytes = parseBigIntLike(right.bytes) ?? BigInt(0);
    if (leftBytes !== rightBytes) return leftBytes > rightBytes ? -1 : 1;
  }

  if (prefs.defaultSort === "modified" || prefs.defaultSort === "size") {
    const updatedDelta = new Date(String(right.updatedAt || right.createdAt || 0)).getTime()
      - new Date(String(left.updatedAt || left.createdAt || 0)).getTime();
    if (updatedDelta !== 0) return updatedDelta;
  }

  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;
  return left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
}

function optionalRelationMissing(err: unknown) {
  const code = String((err as { code?: unknown })?.code || "").toUpperCase();
  return OPTIONAL_RELATION_CODES.has(code);
}

function mapFolder(row: RawFolderRow): CavCloudFolderItem {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    parentId: row.parentId ?? null,
    sharedUserCount: 0,
    collaborationEnabled: false,
    createdAtISO: toISO(row.createdAt),
    updatedAtISO: toISO(row.updatedAt),
  };
}

function mapFile(row: RawFileRow): CavCloudFileItem {
  const bytes = parseBigIntLike(row.bytes) ?? BigInt(0);
  return {
    id: row.id,
    folderId: row.folderId,
    name: row.name,
    path: row.path,
    relPath: String(row.relPath || "").trim() || normalizePathNoTrailingSlash(row.path).replace(/^\/+/, ""),
    r2Key: row.r2Key,
    bytes: toSafeNumber(bytes),
    bytesExact: bytes.toString(),
    mimeType: row.mimeType,
    sha256: row.sha256,
    previewSnippet: row.previewSnippet,
    previewSnippetUpdatedAtISO: row.previewSnippetUpdatedAt ? toISO(row.previewSnippetUpdatedAt) : null,
    status: normalizeFileStatus(row.status),
    errorCode: null,
    errorMessage: null,
    sharedUserCount: 0,
    collaborationEnabled: false,
    createdAtISO: toISO(row.createdAt),
    updatedAtISO: toISO(row.updatedAt),
  };
}

async function queryFolderByPath(
  queryable: Queryable,
  accountId: string,
  path: string,
  opts: { includeDeleted?: boolean } = {},
) {
  const result = await queryable.query<RawFolderRow>(
    `SELECT "id", "name", "path", "parentId", "createdAt", "updatedAt", "deletedAt"
     FROM "CavCloudFolder"
     WHERE "accountId" = $1
       AND "path" = $2
       ${opts.includeDeleted ? "" : 'AND "deletedAt" IS NULL'}
     LIMIT 1`,
    [accountId, normalizePathNoTrailingSlash(path)],
  );
  return result.rows[0] || null;
}

async function queryFolderById(queryable: Queryable, accountId: string, folderId: string) {
  const result = await queryable.query<RawFolderRow>(
    `SELECT "id", "name", "path", "parentId", "createdAt", "updatedAt", "deletedAt"
     FROM "CavCloudFolder"
     WHERE "accountId" = $1
       AND "id" = $2
       AND "deletedAt" IS NULL
     LIMIT 1`,
    [accountId, folderId],
  );
  return result.rows[0] || null;
}

async function ensureRootFolderRaw(queryable: Queryable, accountId: string): Promise<RawFolderRow> {
  let root = await queryFolderByPath(queryable, accountId, ROOT_PATH, { includeDeleted: true });
  if (!root) {
    await queryable.query(
      `INSERT INTO "CavCloudFolder" ("id", "accountId", "name", "path", "createdAt", "updatedAt")
       VALUES ($1, $2, 'root', '/', NOW(), NOW())
       ON CONFLICT ("accountId", "path") DO NOTHING`,
      [newDbId(), accountId],
    );
    root = await queryFolderByPath(queryable, accountId, ROOT_PATH, { includeDeleted: true });
  }
  if (!root) throw cavErr("ROOT_FOLDER_INIT_FAILED", 500, "failed to initialize root folder");

  if (root.deletedAt) {
    await queryable.query(
      `UPDATE "CavCloudFolder"
       SET "deletedAt" = NULL,
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      [root.id],
    );
    await queryable.query(
      `DELETE FROM "CavCloudTrash"
       WHERE "accountId" = $1
         AND "folderId" = $2`,
      [accountId, root.id],
    );
    root = await queryFolderByPath(queryable, accountId, ROOT_PATH);
  }

  if (!root) throw cavErr("ROOT_FOLDER_INIT_FAILED", 500, "failed to initialize root folder");
  return root;
}

async function loadPlanUsageSnapshot(accountId: string) {
  const pool = getAuthPool();
  const account = await findAccountById(pool, accountId).catch(() => null);
  let subscription: { status?: string | null; tier?: string | null } | null = null;
  try {
    const result = await pool.query<{ status: string | null; tier: string | null }>(
      `SELECT "status", "tier"
       FROM "Subscription"
       WHERE "accountId" = $1
       ORDER BY
         CASE WHEN "status" = ANY($2::text[]) THEN 0 ELSE 1 END,
         "currentPeriodEnd" DESC NULLS LAST,
         "updatedAt" DESC,
         "createdAt" DESC
       LIMIT 1`,
      [accountId, PAID_SUBSCRIPTION_STATUSES],
    );
    subscription = result.rows[0] || null;
  } catch (err) {
    if (!optionalRelationMissing(err)) throw err;
  }

  const resolved = resolveCavCloudEffectivePlan({
    account: account
      ? {
          tier: account.tier,
          trialSeatActive: account.trialSeatActive,
          trialEndsAt: account.trialEndsAt,
        }
      : null,
    subscription,
  });

  return {
    planId: resolved.planId,
    limitBytes: cavcloudStorageLimitBytesForPlan(resolved.planId, { trialActive: resolved.trialActive }),
    perFileMaxBytes: cavcloudPerFileMaxBytesForPlan(resolved.planId),
  };
}

async function listBreadcrumbs(queryable: Queryable, accountId: string, path: string) {
  const result = await queryable.query<Pick<RawFolderRow, "id" | "name" | "path">>(
    `SELECT "id", "name", "path"
     FROM "CavCloudFolder"
     WHERE "accountId" = $1
       AND "deletedAt" IS NULL
       AND "path" = ANY($2::text[])`,
    [accountId, buildBreadcrumbPaths(path)],
  );
  const byPath = new Map(result.rows.map((row) => [row.path, row]));
  return buildBreadcrumbPaths(path)
    .map((item) => byPath.get(item))
    .filter((item): item is Pick<RawFolderRow, "id" | "name" | "path"> => Boolean(item))
    .map((row) => ({ id: row.id, name: row.name, path: row.path }));
}

async function listChildFolders(
  queryable: Queryable,
  accountId: string,
  folder: RawFolderRow,
  listing: CavCloudListingPreferences,
  query?: string,
) {
  const trimmed = String(query || "").trim();
  const result = await queryable.query<RawFolderRow>(
    `SELECT "id", "name", "path", "parentId", "createdAt", "updatedAt"
     FROM "CavCloudFolder"
     WHERE "accountId" = $1
       AND "deletedAt" IS NULL
       AND "parentId" ${folder.id ? "= $2" : "IS NULL"}
       ${trimmed ? 'AND "name" ILIKE $3' : ""}
     ORDER BY "name" ASC`,
    trimmed ? [accountId, folder.id, `%${trimmed}%`] : [accountId, folder.id],
  );

  return result.rows
    .filter((row) => isDirectChildPath(folder.path, row.path))
    .filter((row) => listing.showDotfiles || !isDotfileName(row.name))
    .sort((left, right) => compareFolderRowsForListing(left, right, listing))
    .map((row) => mapFolder(row));
}

async function listChildFiles(
  queryable: Queryable,
  accountId: string,
  folder: RawFolderRow,
  listing: CavCloudListingPreferences,
  query?: string,
) {
  const trimmed = String(query || "").trim();
  const result = await queryable.query<RawFileRow>(
    `SELECT "id", "folderId", "name", "path", "relPath", "r2Key", "bytes", "mimeType", "sha256",
            "previewSnippet", "previewSnippetUpdatedAt", "status", "createdAt", "updatedAt"
     FROM "CavCloudFile"
     WHERE "accountId" = $1
       AND "deletedAt" IS NULL
       AND "folderId" = $2
       ${trimmed ? 'AND "name" ILIKE $3' : ""}
     ORDER BY "name" ASC`,
    trimmed ? [accountId, folder.id, `%${trimmed}%`] : [accountId, folder.id],
  );

  return result.rows
    .filter((row) => listing.showDotfiles || !isDotfileName(row.name))
    .sort((left, right) => compareFileRowsForListing(left, right, listing))
    .map((row) => mapFile(row));
}

async function loadUsage(accountId: string) {
  const [usageResult, plan] = await Promise.all([
    getAuthPool().query<{ usedBytes: bigint | number | string | null }>(
      `SELECT COALESCE(SUM("bytes"), 0) AS "usedBytes"
       FROM "CavCloudFile"
       WHERE "accountId" = $1
         AND "deletedAt" IS NULL`,
      [accountId],
    ),
    loadPlanUsageSnapshot(accountId),
  ]);

  const usedBytes = parseBigIntLike(usageResult.rows[0]?.usedBytes) ?? BigInt(0);
  const limitBytes = plan.limitBytes == null ? null : BigInt(plan.limitBytes);
  const remainingBytes = limitBytes == null ? null : limitBytes - usedBytes;

  return {
    usedBytes: toSafeNumber(usedBytes),
    usedBytesExact: usedBytes.toString(),
    limitBytes: limitBytes == null ? null : toSafeNumber(limitBytes),
    limitBytesExact: limitBytes == null ? null : limitBytes.toString(),
    remainingBytes: remainingBytes == null ? null : toSafeNumber(remainingBytes),
    remainingBytesExact: remainingBytes == null ? null : remainingBytes.toString(),
    planId: plan.planId,
    perFileMaxBytes: plan.perFileMaxBytes,
    perFileMaxBytesExact: String(plan.perFileMaxBytes),
  };
}

async function loadTrash(accountId: string) {
  try {
    const result = await getAuthPool().query<RawTreeTrashRow>(
      `SELECT t."id",
              t."deletedAt",
              t."purgeAfter",
              f."id" AS "fileId",
              f."name" AS "fileName",
              f."path" AS "filePath",
              f."bytes" AS "fileBytes",
              d."id" AS "folderId",
              d."name" AS "folderName",
              d."path" AS "folderPath"
       FROM "CavCloudTrash" t
       LEFT JOIN "CavCloudFile" f ON f."id" = t."fileId"
       LEFT JOIN "CavCloudFolder" d ON d."id" = t."folderId"
       WHERE t."accountId" = $1
       ORDER BY t."deletedAt" DESC
       LIMIT 200`,
      [accountId],
    );

    return result.rows
      .map((row) => {
        if (row.fileId) {
          const bytes = parseBigIntLike(row.fileBytes);
          return {
            id: row.id,
            kind: "file" as const,
            targetId: row.fileId,
            name: row.fileName || "",
            path: row.filePath || "",
            bytes: bytes == null ? 0 : toSafeNumber(bytes),
            deletedAtISO: toISO(row.deletedAt),
            purgeAfterISO: toISO(row.purgeAfter),
          };
        }
        if (row.folderId) {
          return {
            id: row.id,
            kind: "folder" as const,
            targetId: row.folderId,
            name: row.folderName || "",
            path: row.folderPath || "",
            bytes: null,
            deletedAtISO: toISO(row.deletedAt),
            purgeAfterISO: toISO(row.purgeAfter),
          };
        }
        return null;
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  } catch (err) {
    if (optionalRelationMissing(err)) return [];
    throw err;
  }
}

async function loadActivity(accountId: string): Promise<CavCloudActivityItem[]> {
  try {
    const result = await getAuthPool().query<RawActivityRow>(
      `SELECT "id", "action", "targetType", "targetId", "targetPath", "metaJson", "createdAt"
       FROM "CavCloudActivity"
       WHERE "accountId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 24`,
      [accountId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId ?? null,
      targetPath: row.targetPath ?? null,
      createdAtISO: toISO(row.createdAt),
      metaJson: row.metaJson && typeof row.metaJson === "object" && !Array.isArray(row.metaJson)
        ? (row.metaJson as Record<string, unknown>)
        : null,
    }));
  } catch (err) {
    if (optionalRelationMissing(err)) return [];
    throw err;
  }
}

async function loadStorageHistory(accountId: string): Promise<CavCloudStoragePoint[]> {
  try {
    const result = await getAuthPool().query<RawUsagePointRow>(
      `SELECT "bucketStart", "usedBytes"
       FROM "CavCloudUsagePoint"
       WHERE "accountId" = $1
       ORDER BY "bucketStart" DESC
       LIMIT 48`,
      [accountId],
    );

    return result.rows
      .map((row) => {
        const usedBytes = parseBigIntLike(row.usedBytes);
        if (usedBytes == null) return null;
        return {
          ts: new Date(String(row.bucketStart)).getTime(),
          usedBytes: toSafeNumber(usedBytes),
          usedBytesExact: usedBytes.toString(),
        };
      })
      .filter((row): row is CavCloudStoragePoint => Boolean(row))
      .reverse();
  } catch (err) {
    if (optionalRelationMissing(err)) return [];
    throw err;
  }
}

export async function ensureCavCloudRootFolderRuntime(accountIdRaw: string): Promise<CavCloudFolderItem> {
  const accountId = String(accountIdRaw || "").trim();
  if (!accountId) throw cavErr("ACCOUNT_REQUIRED", 400, "account is required");
  return mapFolder(await ensureRootFolderRaw(getAuthPool(), accountId));
}

export async function findCavCloudFolderByIdRuntime(accountIdRaw: string, folderIdRaw: string) {
  const accountId = String(accountIdRaw || "").trim();
  const folderId = String(folderIdRaw || "").trim();
  if (!accountId || !folderId) return null;
  const row = await queryFolderById(getAuthPool(), accountId, folderId);
  return row ? mapFolder(row) : null;
}

export async function loadCavCloudTreeLiteRuntime(args: {
  accountId: string;
  folderPath?: string;
  listing?: CavCloudListingPreferences;
  query?: string;
}): Promise<CavCloudFolderChildrenPayload> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw cavErr("ACCOUNT_REQUIRED", 400, "account is required");

  const listing = normalizeListingPrefs(args.listing);
  const pool = getAuthPool();
  const path = normalizePathNoTrailingSlash(args.folderPath || ROOT_PATH);
  const folder = path === ROOT_PATH
    ? await ensureRootFolderRaw(pool, accountId)
    : await queryFolderByPath(pool, accountId, path);

  if (!folder) throw cavErr("FOLDER_NOT_FOUND", 404, "folder not found");

  const [breadcrumbs, folders, files] = await Promise.all([
    listBreadcrumbs(pool, accountId, folder.path),
    listChildFolders(pool, accountId, folder, listing, args.query),
    listChildFiles(pool, accountId, folder, listing, args.query),
  ]);

  return {
    folder: mapFolder(folder),
    breadcrumbs,
    folders,
    files,
  };
}

export async function loadCavCloudFolderChildrenByIdRuntime(args: {
  accountId: string;
  folderId: string;
  listing?: CavCloudListingPreferences;
  query?: string;
}): Promise<CavCloudFolderChildrenPayload> {
  const accountId = String(args.accountId || "").trim();
  const folderId = String(args.folderId || "").trim();
  if (!accountId) throw cavErr("ACCOUNT_REQUIRED", 400, "account is required");
  if (!folderId) throw cavErr("FOLDER_ID_REQUIRED", 400, "folder id is required");

  if (folderId.toLowerCase() === "root") {
    return loadCavCloudTreeLiteRuntime({
      accountId,
      folderPath: ROOT_PATH,
      listing: args.listing,
      query: args.query,
    });
  }

  const folder = await queryFolderById(getAuthPool(), accountId, folderId);
  if (!folder) throw cavErr("FOLDER_NOT_FOUND", 404, "folder not found");

  return loadCavCloudTreeLiteRuntime({
    accountId,
    folderPath: folder.path,
    listing: args.listing,
    query: args.query,
  });
}

export async function loadCavCloudTreeRuntime(args: {
  accountId: string;
  folderPath?: string;
  listing?: CavCloudListingPreferences;
}): Promise<CavCloudTreePayload> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw cavErr("ACCOUNT_REQUIRED", 400, "account is required");

  const lite = await loadCavCloudTreeLiteRuntime({
    accountId,
    folderPath: args.folderPath,
    listing: args.listing,
  });

  const [usage, trash, activity, storageHistory] = await Promise.all([
    loadUsage(accountId),
    loadTrash(accountId),
    loadActivity(accountId),
    loadStorageHistory(accountId),
  ]);

  return {
    ...lite,
    trash,
    usage,
    activity,
    storageHistory,
  };
}

export async function createCavCloudFolderRuntime(args: {
  accountId: string;
  operatorUserId?: string | null;
  parentId?: string | null;
  parentPath?: string | null;
  name: string;
}): Promise<CavCloudFolderItem> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw cavErr("ACCOUNT_REQUIRED", 400, "account is required");
  const name = safeNodeName(args.name);

  return withAuthTransaction(async (client) => {
    const parent = (() => {
      const rawParentId = String(args.parentId || "").trim();
      if (rawParentId) return queryFolderById(client, accountId, rawParentId);
      const path = normalizePathNoTrailingSlash(String(args.parentPath || ROOT_PATH));
      if (path === ROOT_PATH) return ensureRootFolderRaw(client, accountId);
      return queryFolderByPath(client, accountId, path);
    })();

    const resolvedParent = await parent;
    if (!resolvedParent) throw cavErr("FOLDER_NOT_FOUND", 404, "folder not found");

    const path = joinPath(resolvedParent.path, name);
    const existingFolder = await queryFolderByPath(client, accountId, path, { includeDeleted: true });
    if (existingFolder && !existingFolder.deletedAt) {
      return mapFolder(existingFolder);
    }

    const fileConflict = await client.query<{ id: string }>(
      `SELECT "id"
       FROM "CavCloudFile"
       WHERE "accountId" = $1
         AND "path" = $2
         AND "deletedAt" IS NULL
       LIMIT 1`,
      [accountId, path],
    );
    if (fileConflict.rows[0]?.id) {
      throw cavErr("PATH_CONFLICT_FILE", 409, `A file already exists at ${path}.`);
    }

    if (existingFolder?.deletedAt) {
      await client.query(
        `UPDATE "CavCloudFolder"
         SET "deletedAt" = NULL,
             "parentId" = $2,
             "name" = $3,
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        [existingFolder.id, resolvedParent.id, name],
      );
      await client.query(
        `DELETE FROM "CavCloudTrash"
         WHERE "accountId" = $1
           AND "folderId" = $2`,
        [accountId, existingFolder.id],
      );
      const restored = await queryFolderByPath(client, accountId, path);
      if (!restored) throw cavErr("PATH_CONFLICT", 409, "path already exists");
      return mapFolder(restored);
    }

    try {
      await client.query(
        `INSERT INTO "CavCloudFolder" ("id", "accountId", "parentId", "name", "path", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [newDbId(), accountId, resolvedParent.id, name, path],
      );
    } catch (err) {
      if (!isPgUniqueViolation(err)) throw err;
      if (pgUniqueViolationMentions(err, "path") || pgUniqueViolationMentions(err, "name")) {
        const winner = await queryFolderByPath(client, accountId, path);
        if (winner) return mapFolder(winner);
        throw cavErr("PATH_CONFLICT", 409, "path already exists");
      }
      throw err;
    }

    try {
      await client.query(
        `INSERT INTO "CavCloudActivity" ("id", "accountId", "operatorUserId", "action", "targetType", "targetId", "targetPath", "createdAt")
         SELECT $1, $2, $3, 'folder.create', 'folder', f."id", f."path", NOW()
         FROM "CavCloudFolder" f
         WHERE f."accountId" = $2
           AND f."path" = $4
           AND f."deletedAt" IS NULL
         LIMIT 1`,
        [newDbId(), accountId, String(args.operatorUserId || "").trim() || null, path],
      );
    } catch (err) {
      if (!optionalRelationMissing(err)) throw err;
    }

    const created = await queryFolderByPath(client, accountId, path);
    if (!created) throw cavErr("PATH_CONFLICT", 409, "path already exists");
    return mapFolder(created);
  });
}
