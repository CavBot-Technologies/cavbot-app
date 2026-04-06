import "server-only";

import crypto from "crypto";
import { PassThrough, Readable, Transform } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { pipeline } from "stream/promises";

import { Prisma } from "@prisma/client";

import { getCavCloudPlanContext } from "@/lib/cavcloud/plan.server";
import { type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { buildZipBuffer } from "@/lib/cavcloud/zip.server";
import { preferredMimeType } from "@/lib/fileMime";
import {
  isTextLikeFile,
  normalizePreviewSnippetText,
  previewSnippetFromBytes,
  PREVIEW_SNIPPET_MAX_CHARS,
  PREVIEW_SNIPPET_RANGE_BYTES,
} from "@/lib/filePreview";
import {
  abortCavcloudMultipartUpload,
  completeCavcloudMultipartUpload,
  createCavcloudMultipartUpload,
  deleteCavcloudObject,
  getCavcloudObjectStream,
  headCavcloudObject,
  putCavcloudObject,
  putCavcloudObjectStream,
  uploadCavcloudMultipartPart,
} from "@/lib/cavcloud/r2.server";
import {
  getCavCloudSettings,
  rememberCavCloudLastFolder,
  type CavCloudListingPreferences,
} from "@/lib/cavcloud/settings.server";
import { notifyCavCloudBulkDeletePurge } from "@/lib/cavcloud/notifications.server";
import {
  CAVCLOUD_ACTIVITY_OPERATION_KINDS,
  operationKindToLegacyActivityAction,
} from "@/lib/cavcloud/historyLayers.server";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const TRASH_RETENTION_DAYS = 30;
const DEFAULT_MULTIPART_TTL_HOURS = 24;

const MIN_MULTIPART_PART_BYTES = 5 * 1024 * 1024;
const DEFAULT_MULTIPART_PART_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_PART_BYTES = 64 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10_000;
const FOLDER_UPLOAD_MANIFEST_MIN_BATCH = 1;
const FOLDER_UPLOAD_MANIFEST_MAX_BATCH = 500;
const FOLDER_UPLOAD_STATUS_FAILED_PAGE_SIZE = 100;
const FOLDER_UPLOAD_STATUS_FAILED_PAGE_SIZE_MAX = 500;
const PREVIEW_SNIPPET_BATCH_MAX = 100;
const PREVIEW_SNIPPET_CONCURRENCY = 6;
const STORAGE_POINT_DEBOUNCE_MS = 60 * 60 * 1000;
const STORAGE_POINT_MIN_DELTA_BYTES = BigInt(1024) * BigInt(1024);
const STORAGE_HISTORY_MAX_POINTS = 48;
const EXPIRED_TRASH_PURGE_MIN_INTERVAL_MS = 60 * 1000;
const QUOTA_SNAPSHOT_REFRESH_INTERVAL_MS = 90 * 1000;
const SERIALIZABLE_TX_RETRY_ATTEMPTS = 5;
const SERIALIZABLE_TX_BASE_DELAY_MS = 35;
const QUOTA_WRITE_RETRY_ATTEMPTS = 5;
const QUOTA_WRITE_BASE_DELAY_MS = 40;
const INTERACTIVE_TX_MAX_WAIT_MS = 60 * 1000;
const INTERACTIVE_TX_TIMEOUT_MS = 60 * 1000;
const QUOTA_LOCK_NAMESPACE = "cavcloud_quota_v1";
const DEFAULT_MAX_ARCHIVE_SOURCE_BYTES = 512 * 1024 * 1024;
const OFFICIAL_SYNC_ROOT_PATH = "/Synced";
const OFFICIAL_SYNC_CAVCODE_PATH = "/Synced/CavCode";
const OFFICIAL_SYNC_CAVPAD_PATH = "/Synced/CavPad";
const OFFICIAL_SYNC_SYSTEM_PATHS = new Set<string>([
  OFFICIAL_SYNC_ROOT_PATH,
  OFFICIAL_SYNC_CAVCODE_PATH,
  OFFICIAL_SYNC_CAVPAD_PATH,
]);

const FEED_ACTIVITY_ACTIONS = [
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

type DbClient = Prisma.TransactionClient | typeof prisma;

type FolderUploadPrismaDelegates = {
  cavCloudFolderUploadSession: {
    findFirst: (...args: unknown[]) => Promise<unknown>;
    create: (...args: unknown[]) => Promise<unknown>;
    update: (...args: unknown[]) => Promise<unknown>;
  };
  cavCloudFolderUploadSessionFile: {
    count: (...args: unknown[]) => Promise<number>;
    findFirst: (...args: unknown[]) => Promise<unknown>;
    findMany: (...args: unknown[]) => Promise<unknown[]>;
    create: (...args: unknown[]) => Promise<unknown>;
    update: (...args: unknown[]) => Promise<unknown>;
  };
};

function folderUploadDb(tx: DbClient): DbClient & FolderUploadPrismaDelegates {
  return tx as DbClient & FolderUploadPrismaDelegates;
}

const prismaFolderUpload = folderUploadDb(prisma);
const INTERACTIVE_TX_OPTIONS = {
  maxWait: INTERACTIVE_TX_MAX_WAIT_MS,
  timeout: INTERACTIVE_TX_TIMEOUT_MS,
} as const;
const SERIALIZABLE_INTERACTIVE_TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  ...INTERACTIVE_TX_OPTIONS,
} as const;
type UuidString = `${string}-${string}-${string}-${string}-${string}`;

let cavCloudUsagePointTableAvailable: boolean | null = null;
let cavCloudQuotaTableAvailable: boolean | null = null;
let cavCloudOperationLogTableAvailable: boolean | null = null;
let cavCloudFilePathIndexTableAvailable: boolean | null = null;
const expiredTrashPurgeAtByAccount = new Map<string, number>();
const quotaRefreshedAtByAccount = new Map<string, number>();

export class CavCloudError extends Error {
  status: number;
  code: string;

  constructor(code: string, status = 400, message?: string) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

type BytesSnapshot = {
  usedBytes: bigint;
  limitBytes: bigint | null;
  remainingBytes: bigint | null;
  perFileMaxBytes: bigint;
  planId: PlanId;
};

export type CavCloudFolderItem = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  sharedUserCount: number;
  collaborationEnabled: boolean;
  createdAtISO: string;
  updatedAtISO: string;
};

export type CavCloudFileItem = {
  id: string;
  folderId: string;
  name: string;
  path: string;
  relPath: string;
  r2Key: string;
  bytes: number;
  bytesExact: string;
  mimeType: string;
  sha256: string;
  previewSnippet: string | null;
  previewSnippetUpdatedAtISO?: string | null;
  status: "UPLOADING" | "READY" | "FAILED";
  errorCode?: string | null;
  errorMessage?: string | null;
  sharedUserCount: number;
  collaborationEnabled: boolean;
  createdAtISO: string;
  updatedAtISO: string;
};

export type CavCloudFileVersionItem = {
  id: string;
  fileId: string;
  versionNumber: number;
  sha256: string;
  r2Key: string;
  bytes: number;
  bytesExact: string;
  createdByUserId: string;
  restoredFromVersionId: string | null;
  createdAtISO: string;
};

export type CavCloudActivityItem = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetPath: string | null;
  createdAtISO: string;
  metaJson: Record<string, unknown> | null;
};

export type CavCloudStoragePoint = {
  ts: number;
  usedBytes: number;
  usedBytesExact: string;
};

export type CavCloudTreePayload = {
  folder: CavCloudFolderItem;
  breadcrumbs: Array<{ id: string; name: string; path: string }>;
  folders: CavCloudFolderItem[];
  files: CavCloudFileItem[];
  trash: Array<{
    id: string;
    kind: "file" | "folder";
    targetId: string;
    name: string;
    path: string;
    bytes: number | null;
    deletedAtISO: string;
    purgeAfterISO: string;
  }>;
  usage: {
    usedBytes: number;
    usedBytesExact: string;
    limitBytes: number | null;
    limitBytesExact: string | null;
    remainingBytes: number | null;
    remainingBytesExact: string | null;
    planId: PlanId;
    perFileMaxBytes: number;
    perFileMaxBytesExact: string;
  };
  activity: CavCloudActivityItem[];
  storageHistory: CavCloudStoragePoint[];
};

export type CavCloudFolderChildrenPayload = {
  folder: CavCloudFolderItem;
  breadcrumbs: Array<{ id: string; name: string; path: string }>;
  folders: CavCloudFolderItem[];
  files: CavCloudFileItem[];
};

function nowPlusDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function toISO(d: Date): string {
  return new Date(d).toISOString();
}

function toSafeNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < BigInt(0)) return 0;
  return Number(value);
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

function parseDateLike(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function parseSqlBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "1" || v === "t" || v === "true" || v === "y" || v === "yes";
  }
  return false;
}

function isRetryableSerializableTxError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code || "").toUpperCase();
  if (code === "P2034") return true;

  const message = String(
    (err as { meta?: { message?: unknown }; message?: unknown })?.meta?.message
    || (err as { message?: unknown })?.message
    || ""
  ).toLowerCase();

  return message.includes("serialization failure")
    || message.includes("could not serialize access")
    || message.includes("write conflict")
    || message.includes("deadlock detected")
    || message.includes("expired transaction")
    || message.includes("transaction api error");
}

async function runSerializableTxWithRetry<T>(run: () => Promise<T>, attempts = SERIALIZABLE_TX_RETRY_ATTEMPTS): Promise<T> {
  let lastErr: unknown = null;
  const maxAttempts = Math.max(1, Math.trunc(attempts) || 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      lastErr = err;
      const canRetry = attempt < maxAttempts - 1 && isRetryableSerializableTxError(err);
      if (!canRetry) throw err;

      const backoffMs = SERIALIZABLE_TX_BASE_DELAY_MS * (2 ** attempt);
      const jitterMs = Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, backoffMs + jitterMs));
    }
  }

  throw lastErr instanceof Error ? lastErr : new CavCloudError("INTERNAL", 500);
}

async function runQuotaWriteWithRetry<T>(run: () => Promise<T>, attempts = QUOTA_WRITE_RETRY_ATTEMPTS): Promise<T> {
  let lastErr: unknown = null;
  const maxAttempts = Math.max(1, Math.trunc(attempts) || 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      lastErr = err;
      const canRetry = attempt < maxAttempts - 1 && isRetryableSerializableTxError(err);
      if (!canRetry) throw err;

      const backoffMs = QUOTA_WRITE_BASE_DELAY_MS * (2 ** attempt);
      const jitterMs = Math.floor(Math.random() * 40);
      await new Promise((resolve) => setTimeout(resolve, backoffMs + jitterMs));
    }
  }

  throw lastErr instanceof Error ? lastErr : new CavCloudError("INTERNAL", 500);
}

async function withQuotaLock<T>(
  tx: DbClient,
  accountId: string,
  run: (lockedTx: DbClient) => Promise<T>,
): Promise<T> {
  const executeWithLock = async (lockedTx: DbClient) => {
    await lockedTx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${QUOTA_LOCK_NAMESPACE}), hashtext(${accountId}))
    `;
    return run(lockedTx);
  };

  if (tx === prisma) {
    return prisma.$transaction((lockedTx) => executeWithLock(lockedTx), INTERACTIVE_TX_OPTIONS);
  }
  return executeWithLock(tx);
}

function usagePointBucketStart(at: Date): Date {
  const ms = at.getTime();
  return new Date(Math.floor(ms / STORAGE_POINT_DEBOUNCE_MS) * STORAGE_POINT_DEBOUNCE_MS);
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

function isMissingQuotaTableError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  return msg.includes("cavcloudquota") && (msg.includes("does not exist") || msg.includes("relation"));
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

function isMissingFilePathIndexTableError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  return msg.includes("cavcloudfilepathindex") && (msg.includes("does not exist") || msg.includes("relation"));
}

function normalizeActivityMeta(metaJson: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (!metaJson || typeof metaJson !== "object" || Array.isArray(metaJson)) return null;
  return metaJson as Record<string, unknown>;
}

async function usagePointTableExists(tx: DbClient = prisma): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ exists: unknown }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'CavCloudUsagePoint'
    ) AS "exists"
  `;
  return parseSqlBool(rows[0]?.exists);
}

async function ensureUsagePointTableAvailability(tx: DbClient = prisma): Promise<boolean> {
  if (cavCloudUsagePointTableAvailable != null) return cavCloudUsagePointTableAvailable;

  try {
    const exists = await usagePointTableExists(tx);
    cavCloudUsagePointTableAvailable = exists;
    return exists;
  } catch {
    // If we cannot verify table availability, fail-open for uploads by skipping trend writes.
    cavCloudUsagePointTableAvailable = false;
    return false;
  }
}

async function operationLogTableExists(tx: DbClient = prisma): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ exists: unknown }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'CavCloudOperationLog'
    ) AS "exists"
  `;
  return parseSqlBool(rows[0]?.exists);
}

async function ensureOperationLogTableAvailability(tx: DbClient = prisma): Promise<boolean> {
  if (cavCloudOperationLogTableAvailable != null) return cavCloudOperationLogTableAvailable;

  try {
    const exists = await operationLogTableExists(tx);
    cavCloudOperationLogTableAvailable = exists;
    return exists;
  } catch {
    cavCloudOperationLogTableAvailable = false;
    return false;
  }
}

async function filePathIndexTableExists(tx: DbClient = prisma): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ exists: unknown }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'CavCloudFilePathIndex'
    ) AS "exists"
  `;
  return parseSqlBool(rows[0]?.exists);
}

async function ensureFilePathIndexTableAvailability(tx: DbClient = prisma): Promise<boolean> {
  if (cavCloudFilePathIndexTableAvailable != null) return cavCloudFilePathIndexTableAvailable;

  try {
    const exists = await filePathIndexTableExists(tx);
    cavCloudFilePathIndexTableAvailable = exists;
    return exists;
  } catch {
    cavCloudFilePathIndexTableAvailable = false;
    return false;
  }
}

async function loadStorageHistory(accountId: string, limit = STORAGE_HISTORY_MAX_POINTS, tx: DbClient = prisma): Promise<CavCloudStoragePoint[]> {
  if (!accountId) return [];
  if (!(await ensureUsagePointTableAvailability(tx))) return [];

  try {
    const rows = await tx.$queryRaw<Array<{ bucketStart: unknown; usedBytes: unknown }>>`
      SELECT "bucketStart", "usedBytes"
      FROM "CavCloudUsagePoint"
      WHERE "accountId" = ${accountId}
      ORDER BY "bucketStart" DESC
      LIMIT ${Math.max(1, Math.min(limit, 240))}
    `;

    cavCloudUsagePointTableAvailable = true;

    return rows
      .map((row) => {
        const bucketStart = parseDateLike(row.bucketStart);
        const usedBytes = parseBigIntLike(row.usedBytes);
        if (!bucketStart || usedBytes == null) return null;
        return {
          ts: bucketStart.getTime(),
          usedBytes: toSafeNumber(usedBytes),
          usedBytesExact: usedBytes.toString(),
        };
      })
      .filter((row): row is CavCloudStoragePoint => !!row)
      .reverse();
  } catch (err) {
    if (isMissingUsagePointTableError(err)) {
      cavCloudUsagePointTableAvailable = false;
      return [];
    }
    throw err;
  }
}

async function recordStorageHistoryPoint(tx: DbClient, args: { accountId: string; usedBytes: bigint; at?: Date }) {
  if (!args.accountId) return;
  if (!(await ensureUsagePointTableAvailability(tx))) return;

  const now = args.at ?? new Date();
  const bucketStart = usagePointBucketStart(now);

  try {
    const latestRows = await tx.$queryRaw<Array<{ bucketStart: unknown; usedBytes: unknown }>>`
      SELECT "bucketStart", "usedBytes"
      FROM "CavCloudUsagePoint"
      WHERE "accountId" = ${args.accountId}
      ORDER BY "bucketStart" DESC
      LIMIT 1
    `;

    const latest = latestRows[0];
    if (latest) {
      const prevBucket = parseDateLike(latest.bucketStart);
      const prevUsed = parseBigIntLike(latest.usedBytes);
      if (prevBucket && prevUsed != null) {
        const ageMs = Math.max(0, now.getTime() - prevBucket.getTime());
        const delta = args.usedBytes >= prevUsed ? args.usedBytes - prevUsed : prevUsed - args.usedBytes;
        if (ageMs < STORAGE_POINT_DEBOUNCE_MS && delta < STORAGE_POINT_MIN_DELTA_BYTES) {
          cavCloudUsagePointTableAvailable = true;
          return;
        }
      }
    }

    await tx.$executeRaw`
      INSERT INTO "CavCloudUsagePoint" ("id", "accountId", "bucketStart", "usedBytes", "createdAt", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${args.accountId}, ${bucketStart}, ${args.usedBytes}, NOW(), NOW())
      ON CONFLICT ("accountId", "bucketStart")
      DO UPDATE SET
        "usedBytes" = EXCLUDED."usedBytes",
        "updatedAt" = NOW()
    `;
    cavCloudUsagePointTableAvailable = true;
  } catch (err) {
    if (isMissingUsagePointTableError(err)) {
      cavCloudUsagePointTableAvailable = false;
      return;
    }
    throw err;
  }
}

function parsePositiveInt(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

function parseNonNegativeInt(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

function envInt(name: string): number | null {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function normalizePath(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const normalized = withSlash.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function normalizePathNoTrailingSlash(raw: string): string {
  const n = normalizePath(raw);
  if (n.length > 1 && n.endsWith("/")) return n.slice(0, -1);
  return n;
}

function safeNodeName(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) throw new CavCloudError("NAME_REQUIRED", 400, "name is required");
  if (input === "." || input === "..") throw new CavCloudError("NAME_INVALID", 400, "name is invalid");
  if (/[/\\]/.test(input)) throw new CavCloudError("NAME_INVALID", 400, "name cannot contain slashes");
  if(/[\u0000-\u001f\u007f]/.test(input)) throw new CavCloudError("NAME_INVALID", 400, "name contains control characters");
  const cleaned = input.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) throw new CavCloudError("NAME_INVALID", 400, "name is invalid");
  if (cleaned.length > 220) return cleaned.slice(0, 220);
  return cleaned;
}

function safeFilenameForKey(raw: string): string {
  const name = safeNodeName(raw);
  return name.replace(/["'`]/g, "_").slice(0, 220) || "file";
}

function toRelPath(path: string): string {
  return normalizePathNoTrailingSlash(path).replace(/^\/+/, "");
}

function safeKeyScopeSegment(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "anonymous";
  const cleaned = input.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  return cleaned || "anonymous";
}

function folderAncestorPathsForFilePath(filePath: string): string[] {
  const normalized = normalizePathNoTrailingSlash(filePath);
  const slash = normalized.lastIndexOf("/");
  const folderPath = slash <= 0 ? "/" : normalized.slice(0, slash);
  return buildBreadcrumbPaths(folderPath);
}

function relativePathFromFolder(folderPath: string, filePath: string): string {
  const root = normalizePathNoTrailingSlash(folderPath);
  const full = normalizePathNoTrailingSlash(filePath);
  if (root === "/") return full.replace(/^\/+/, "");
  const prefix = `${root}/`;
  if (!full.startsWith(prefix)) return "";
  return full.slice(prefix.length).replace(/^\/+/, "");
}

function joinPath(parentPath: string, name: string): string {
  const p = normalizePathNoTrailingSlash(parentPath);
  if (p === "/") return normalizePath(`/${name}`);
  return normalizePath(`${p}/${name}`);
}

function archiveSourceMaxBytes(): bigint {
  return BigInt(envInt("CAVCLOUD_MAX_ARCHIVE_SOURCE_BYTES") ?? DEFAULT_MAX_ARCHIVE_SOURCE_BYTES);
}

function bigintToContentLengthOrUndefined(value: bigint): number | undefined {
  if (value < BigInt(0)) return undefined;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return undefined;
  return Number(value);
}

function fileNameParts(name: string): { stem: string; ext: string } {
  const safe = safeNodeName(name);
  const idx = safe.lastIndexOf(".");
  if (idx <= 0 || idx === safe.length - 1) {
    return { stem: safe, ext: "" };
  }
  return {
    stem: safe.slice(0, idx),
    ext: safe.slice(idx),
  };
}

function duplicateFileName(baseName: string, copyIndex = 1): string {
  const { stem, ext } = fileNameParts(baseName);
  if (copyIndex <= 1) return `${stem} (copy)${ext}`;
  return `${stem} (copy ${copyIndex})${ext}`;
}

function zippedOutputName(baseName: string): string {
  const { stem } = fileNameParts(baseName);
  return `${stem}.zip`;
}

async function resolveAvailableFileName(args: {
  tx: DbClient;
  accountId: string;
  folderPath: string;
  preferredName: string;
  ignoreFileId?: string;
}) {
  const folderPath = normalizePathNoTrailingSlash(args.folderPath);
  for (let i = 0; i < 1000; i += 1) {
    const candidateName = i === 0 ? safeNodeName(args.preferredName) : duplicateFileName(args.preferredName, i + 1);
    const candidatePath = joinPath(folderPath, candidateName);
    const conflict = await args.tx.cavCloudFile.findFirst({
      where: {
        accountId: args.accountId,
        path: candidatePath,
        deletedAt: null,
        ...(args.ignoreFileId ? { id: { not: args.ignoreFileId } } : {}),
      },
      select: { id: true },
    });
    const folderConflict = await args.tx.cavCloudFolder.findFirst({
      where: {
        accountId: args.accountId,
        path: candidatePath,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!conflict && !folderConflict) {
      return {
        name: candidateName,
        path: candidatePath,
      };
    }
  }
  throw new CavCloudError("PATH_CONFLICT", 409, "Could not find an available file name.");
}

function scopePaths(path: string): Prisma.StringFilter {
  const normalized = normalizePathNoTrailingSlash(path);
  if (normalized === "/") return { startsWith: "/" };
  return { startsWith: `${normalized}/` };
}

function syncedSourceKind(source?: string | null): "cavcode" | "cavpad" | null {
  const raw = String(source || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("cavcode")) return "cavcode";
  if (raw.includes("cavpad")) return "cavpad";
  return null;
}

function normalizeSyncedFolderPathForSource(folderPath: string, source?: string | null): string {
  const normalized = normalizePathNoTrailingSlash(folderPath);
  const sourceKind = syncedSourceKind(source);
  if (!sourceKind) return normalized;

  const root = sourceKind === "cavcode" ? OFFICIAL_SYNC_CAVCODE_PATH : OFFICIAL_SYNC_CAVPAD_PATH;
  if (normalized === root || normalized.startsWith(`${root}/`)) return normalized;

  const legacyPrefixes = sourceKind === "cavcode"
    ? ["/CavCode Sync", "/CavCode", OFFICIAL_SYNC_ROOT_PATH]
    : ["/CavPad", OFFICIAL_SYNC_ROOT_PATH];

  for (const legacyPrefix of legacyPrefixes) {
    if (normalized === legacyPrefix) return root;
    if (normalized.startsWith(`${legacyPrefix}/`)) {
      const suffix = normalized.slice(legacyPrefix.length).replace(/^\/+/, "");
      return suffix ? normalizePathNoTrailingSlash(`${root}/${suffix}`) : root;
    }
  }

  if (normalized === "/") return root;
  return normalizePathNoTrailingSlash(`${root}/${normalized.replace(/^\/+/, "")}`);
}

function isOfficialSyncedSystemPath(path: string): boolean {
  return OFFICIAL_SYNC_SYSTEM_PATHS.has(normalizePathNoTrailingSlash(path));
}

function isCavcodeSystemShadowPath(folderPath: string, source?: string | null): boolean {
  if (syncedSourceKind(source) !== "cavcode") return false;
  const normalized = normalizePathNoTrailingSlash(folderPath);
  if (normalized === OFFICIAL_SYNC_CAVCODE_PATH) return false;
  if (!normalized.startsWith(`${OFFICIAL_SYNC_CAVCODE_PATH}/`)) return false;

  const relative = normalized.slice(OFFICIAL_SYNC_CAVCODE_PATH.length).replace(/^\/+/, "");
  if (!relative) return false;
  const segments = relative.split("/").map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (!segments.length) return false;

  if (segments[0] === "system") return true;
  if ((segments[0] === "codebase" || segments[0] === "cavcode") && segments[1] === "system") return true;
  return false;
}

async function accountPlanSnapshot(accountId: string, tx: DbClient = prisma): Promise<{
  planId: PlanId;
  limitBytes: bigint | null;
  perFileMaxBytes: bigint;
}> {
  const plan = await getCavCloudPlanContext(accountId, tx);
  if (!plan.account) throw new CavCloudError("ACCOUNT_NOT_FOUND", 404, "account not found");

  return {
    planId: plan.planId,
    limitBytes: plan.limitBytesBigInt,
    perFileMaxBytes: plan.perFileMaxBytesBigInt,
  };
}

async function computeUsedBytes(accountId: string, tx: DbClient = prisma): Promise<bigint> {
  const agg = await tx.cavCloudFile.aggregate({
    where: {
      accountId,
      deletedAt: null,
    },
    _sum: {
      bytes: true,
    },
  });
  return agg._sum.bytes ?? BigInt(0);
}

async function refreshQuota(accountId: string, tx: DbClient = prisma): Promise<bigint> {
  let usedBytes = BigInt(0);

  if (cavCloudQuotaTableAvailable !== false) {
    try {
      await runQuotaWriteWithRetry(() => withQuotaLock(tx, accountId, async (lockedTx) => {
        usedBytes = await computeUsedBytes(accountId, lockedTx);

        const updated = await lockedTx.cavCloudQuota.updateMany({
          where: { accountId },
          data: { usedBytes },
        });

        if (updated.count > 0) return;

        try {
          await lockedTx.cavCloudQuota.create({
            data: {
              accountId,
              usedBytes,
            },
          });
        } catch (err) {
          if (isMissingQuotaTableError(err)) throw err;

          // Another request can win create under lock handoff; update the canonical row.
          const code = String((err as { code?: unknown })?.code || "").toUpperCase();
          if (code === "P2002") {
            await lockedTx.cavCloudQuota.updateMany({
              where: { accountId },
              data: { usedBytes },
            });
            return;
          }
          throw err;
        }
      }));
      cavCloudQuotaTableAvailable = true;
      quotaRefreshedAtByAccount.set(accountId, Date.now());
      return usedBytes;
    } catch (err) {
      if (isMissingQuotaTableError(err)) {
        // Fail-open: keep accounting accurate from CavCloudFile bytes even if quota table isn't present.
        cavCloudQuotaTableAvailable = false;
      } else {
        throw err;
      }
    }
  }

  usedBytes = await computeUsedBytes(accountId, tx);
  quotaRefreshedAtByAccount.set(accountId, Date.now());
  return usedBytes;
}

async function quotaSnapshotUsedBytes(accountId: string, tx: DbClient = prisma): Promise<bigint> {
  if (cavCloudQuotaTableAvailable === false) {
    const used = await computeUsedBytes(accountId, tx);
    quotaRefreshedAtByAccount.set(accountId, Date.now());
    return used;
  }

  try {
    const row = await tx.cavCloudQuota.findUnique({
      where: { accountId },
      select: { usedBytes: true },
    });

    cavCloudQuotaTableAvailable = true;

    if (row?.usedBytes == null) {
      return refreshQuota(accountId, tx);
    }

    const now = Date.now();
    const last = quotaRefreshedAtByAccount.get(accountId) || 0;
    if (last <= 0) {
      quotaRefreshedAtByAccount.set(accountId, now);
      return row.usedBytes;
    }
    if (now - last >= QUOTA_SNAPSHOT_REFRESH_INTERVAL_MS) {
      return refreshQuota(accountId, tx);
    }

    return row.usedBytes;
  } catch (err) {
    if (isMissingQuotaTableError(err)) {
      cavCloudQuotaTableAvailable = false;
      const used = await computeUsedBytes(accountId, tx);
      quotaRefreshedAtByAccount.set(accountId, Date.now());
      return used;
    }
    throw err;
  }
}

async function quotaSnapshot(accountId: string, tx: DbClient = prisma): Promise<BytesSnapshot> {
  const [plan, usedBytes] = await Promise.all([
    accountPlanSnapshot(accountId, tx),
    quotaSnapshotUsedBytes(accountId, tx),
  ]);

  const limitBytes = plan.limitBytes;
  const remainingBytes = limitBytes == null ? null : limitBytes - usedBytes;

  return {
    usedBytes,
    limitBytes,
    remainingBytes,
    perFileMaxBytes: plan.perFileMaxBytes,
    planId: plan.planId,
  };
}

function assertPerFileLimit(bytes: bigint, maxBytes: bigint) {
  if (bytes > maxBytes) {
    throw new CavCloudError("FILE_TOO_LARGE", 413, `file exceeds max size of ${maxBytes.toString()} bytes`);
  }
}

function assertQuotaLimit(usedBytes: bigint, incomingBytes: bigint, limitBytes: bigint | null) {
  if (limitBytes == null) return;
  if (incomingBytes <= BigInt(0)) return;
  if (usedBytes + incomingBytes > limitBytes) {
    throw new CavCloudError("QUOTA_EXCEEDED", 402, "storage quota exceeded");
  }
}

async function ensureRootFolder(accountId: string, tx: DbClient = prisma) {
  const existing = await tx.cavCloudFolder.findFirst({
    where: {
      accountId,
      path: "/",
    },
  });

  if (existing && !existing.deletedAt) {
    return existing;
  }

  // Avoid transaction-abort races from unique conflicts by using createMany+skipDuplicates.
  await tx.cavCloudFolder.createMany({
    data: [
      {
        accountId,
        name: "root",
        path: "/",
      },
    ],
    skipDuplicates: true,
  });

  const root = await tx.cavCloudFolder.findFirst({
    where: { accountId, path: "/" },
  });
  if (!root) throw new CavCloudError("ROOT_FOLDER_INIT_FAILED", 500, "failed to initialize root folder");

  if (root.deletedAt) {
    const restored = await tx.cavCloudFolder.update({
      where: { id: root.id },
      data: {
        deletedAt: null,
      },
    });
    await tx.cavCloudTrash.deleteMany({
      where: {
        accountId,
        folderId: restored.id,
      },
    });
    return restored;
  }

  return root;
}

async function ensureFolderPathForWrite(accountId: string, folderPath: string, tx: DbClient = prisma) {
  const normalized = normalizePathNoTrailingSlash(folderPath);
  const root = await ensureRootFolder(accountId, tx);
  if (normalized === "/") return root;

  const segments = normalized.split("/").filter(Boolean).map((segment) => safeNodeName(segment));
  let parent = root;
  let currentPath = "/";

  for (const segment of segments) {
    const nextPath = joinPath(currentPath, segment);
    const existing = await tx.cavCloudFolder.findFirst({
      where: {
        accountId,
        path: nextPath,
      },
    });

    if (existing) {
      if (existing.deletedAt) {
        await tx.cavCloudFolder.update({
          where: { id: existing.id },
          data: {
            deletedAt: null,
          },
        });
        await tx.cavCloudTrash.deleteMany({
          where: {
            accountId,
            folderId: existing.id,
          },
        });
      }
      parent = existing;
      currentPath = nextPath;
      continue;
    }

    const existingFile = await tx.cavCloudFile.findFirst({
      where: {
        accountId,
        path: nextPath,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingFile) {
      throw new CavCloudError("PATH_CONFLICT_FILE", 409, `A file already exists at ${nextPath}.`);
    }

    await tx.cavCloudFolder.createMany({
      data: [
        {
          accountId,
          parentId: parent.id,
          name: segment,
          path: nextPath,
        },
      ],
      skipDuplicates: true,
    });

    let resolved = await tx.cavCloudFolder.findFirst({
      where: {
        accountId,
        path: nextPath,
      },
    });
    if (!resolved) throw new CavCloudError("PATH_CONFLICT", 409, "path already exists");

    if (resolved.deletedAt) {
      resolved = await tx.cavCloudFolder.update({
        where: { id: resolved.id },
        data: {
          deletedAt: null,
        },
      });
      await tx.cavCloudTrash.deleteMany({
        where: {
          accountId,
          folderId: resolved.id,
        },
      });
    }
    parent = resolved;
    currentPath = nextPath;
  }

  return parent;
}

async function ensureOfficialSyncedFolders(accountId: string, tx: DbClient = prisma) {
  await ensureFolderPathForWrite(accountId, OFFICIAL_SYNC_CAVCODE_PATH, tx);
  await ensureFolderPathForWrite(accountId, OFFICIAL_SYNC_CAVPAD_PATH, tx);
}

async function resolveFolderForWrite(args: {
  accountId: string;
  folderId?: string | null;
  folderPath?: string | null;
  createIfMissingPath?: boolean;
  tx?: DbClient;
}) {
  const tx = args.tx ?? prisma;
  await ensureRootFolder(args.accountId, tx);

  if (args.folderId) {
    const folder = await tx.cavCloudFolder.findFirst({
      where: { id: args.folderId, accountId: args.accountId, deletedAt: null },
    });
    if (!folder) throw new CavCloudError("FOLDER_NOT_FOUND", 404, "folder not found");
    return folder;
  }

  const path = normalizePathNoTrailingSlash(String(args.folderPath || "/"));
  const folder = await tx.cavCloudFolder.findFirst({
    where: { accountId: args.accountId, path, deletedAt: null },
  });
  if (!folder) {
    if (args.createIfMissingPath) {
      return ensureFolderPathForWrite(args.accountId, path, tx);
    }
    throw new CavCloudError("FOLDER_NOT_FOUND", 404, "folder not found");
  }
  return folder;
}

async function assertPathAvailable(accountId: string, path: string, tx: DbClient = prisma, ignore?: { fileId?: string; folderId?: string }) {
  const wherePath = normalizePathNoTrailingSlash(path);

  const [folderHit, fileHit] = await Promise.all([
    tx.cavCloudFolder.findFirst({
      where: {
        accountId,
        path: wherePath,
        deletedAt: null,
        ...(ignore?.folderId ? { id: { not: ignore.folderId } } : {}),
      },
      select: { id: true },
    }),
    tx.cavCloudFile.findFirst({
      where: {
        accountId,
        path: wherePath,
        deletedAt: null,
        ...(ignore?.fileId ? { id: { not: ignore.fileId } } : {}),
      },
      select: { id: true },
    }),
  ]);

  if (folderHit || fileHit) throw new CavCloudError("PATH_CONFLICT", 409, "path already exists");
}

async function syncFilePathIndexForFile(tx: DbClient, accountId: string, fileId: string) {
  if (!fileId) return;
  if (!(await ensureFilePathIndexTableAvailability(tx))) return;

  try {
    const file = await tx.cavCloudFile.findFirst({
      where: {
        id: fileId,
        accountId,
      },
      select: {
        id: true,
        path: true,
        deletedAt: true,
      },
    });

    if (!file || file.deletedAt) {
      await tx.cavCloudFilePathIndex.deleteMany({
        where: {
          accountId,
          fileId,
        },
      });
      return;
    }

    const filePath = normalizePathNoTrailingSlash(file.path);
    const relPath = toRelPath(filePath);
    await tx.cavCloudFile.update({
      where: { id: file.id },
      data: { relPath },
    });

    const ancestorPaths = folderAncestorPathsForFilePath(filePath);
    const folders = await tx.cavCloudFolder.findMany({
      where: {
        accountId,
        deletedAt: null,
        path: { in: ancestorPaths },
      },
      select: {
        id: true,
        path: true,
      },
    });

    await tx.cavCloudFilePathIndex.deleteMany({
      where: {
        accountId,
        fileId,
      },
    });

    const now = new Date();
    const rows: Prisma.CavCloudFilePathIndexCreateManyInput[] = [];
    for (const folder of folders) {
      const normalizedRelPath = relativePathFromFolder(folder.path, filePath);
      if (!normalizedRelPath) continue;
      rows.push({
        id: crypto.randomUUID() as UuidString,
        accountId,
        fileId: file.id,
        folderId: folder.id,
        normalizedRelPath,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (!rows.length) return;

    await tx.cavCloudFilePathIndex.createMany({
      data: rows,
      skipDuplicates: true,
    });
  } catch (err) {
    if (isMissingFilePathIndexTableError(err)) {
      cavCloudFilePathIndexTableAvailable = false;
      return;
    }
    throw err;
  }
}

async function rebuildFilePathIndexForAccount(tx: DbClient, accountId: string) {
  if (!(await ensureFilePathIndexTableAvailability(tx))) return;

  try {
    const [folders, files] = await Promise.all([
      tx.cavCloudFolder.findMany({
        where: {
          accountId,
          deletedAt: null,
        },
        select: {
          id: true,
          path: true,
        },
      }),
      tx.cavCloudFile.findMany({
        where: {
          accountId,
          deletedAt: null,
        },
        select: {
          id: true,
          path: true,
        },
      }),
    ]);

    const folderIdByPath = new Map<string, string>();
    for (const folder of folders) {
      folderIdByPath.set(normalizePathNoTrailingSlash(folder.path), folder.id);
    }

    await tx.cavCloudFilePathIndex.deleteMany({
      where: {
        accountId,
      },
    });

    const now = new Date();
    const rows: Array<{
      id: string;
      accountId: string;
      fileId: string;
      folderId: string;
      normalizedRelPath: string;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    for (const file of files) {
      const filePath = normalizePathNoTrailingSlash(file.path);
      const ancestors = folderAncestorPathsForFilePath(filePath);
      for (const ancestorPath of ancestors) {
        const folderId = folderIdByPath.get(ancestorPath);
        if (!folderId) continue;
        const normalizedRelPath = relativePathFromFolder(ancestorPath, filePath);
        if (!normalizedRelPath) continue;
        rows.push({
          id: crypto.randomUUID(),
          accountId,
          fileId: file.id,
          folderId,
          normalizedRelPath,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      if (!chunk.length) continue;
      await tx.cavCloudFilePathIndex.createMany({
        data: chunk,
        skipDuplicates: true,
      });
    }

    await tx.$executeRaw`
      UPDATE "CavCloudFile"
      SET "relPath" = TRIM(LEADING '/' FROM "path")
      WHERE "accountId" = ${accountId}
        AND COALESCE("relPath", '') <> TRIM(LEADING '/' FROM "path")
    `;
  } catch (err) {
    if (isMissingFilePathIndexTableError(err)) {
      cavCloudFilePathIndexTableAvailable = false;
      return;
    }
    throw err;
  }
}

function inferOperationLogFromActivity(options: {
  action: string;
  targetType: string;
  targetId?: string | null;
  targetPath?: string | null;
  metaJson?: Prisma.InputJsonValue | undefined;
}): {
  kind:
    | "CREATE_FOLDER"
    | "UPLOAD_FILE"
    | "FILE_UPLOADED"
    | "MOVE_FILE"
    | "RENAME_FILE"
    | "FILE_RENAMED"
    | "FOLDER_MOVED"
    | "DELETE_FILE"
    | "FILE_DELETED"
    | "RESTORE_FILE"
    | "SHARE_CREATED"
    | "SHARE_REVOKED"
    | "DUPLICATE_FILE"
    | "ZIP_CREATED"
    | "PUBLISHED_ARTIFACT"
    | "ARTIFACT_PUBLISHED"
    | "UNPUBLISHED_ARTIFACT"
    | "COLLAB_GRANTED"
    | "COLLAB_REVOKED";
  subjectType: "file" | "folder" | "share" | "artifact";
  subjectId: string;
  label: string;
  meta?: Prisma.InputJsonValue;
} | null {
  const action = String(options.action || "").trim().toLowerCase();
  const targetTypeRaw = String(options.targetType || "").trim().toLowerCase();
  const targetId = String(options.targetId || "").trim() || "unknown";
  const targetPath = String(options.targetPath || "").trim();
  const label = (targetPath || targetId || action).slice(0, 220);
  const meta = options.metaJson;

  const subjectType = (() => {
    if (targetTypeRaw === "folder") return "folder" as const;
    if (targetTypeRaw === "share") return "share" as const;
    if (targetTypeRaw === "artifact") return "artifact" as const;
    return "file" as const;
  })();

  if (action === "folder.create") {
    return { kind: "CREATE_FOLDER", subjectType: "folder", subjectId: targetId, label, meta };
  }
  if (
    action === "file.upload.simple"
    || action === "file.upload.multipart.complete"
    || action === "file.metadata.create"
    || action === "file.sync.upsert"
    || action === "upload.files"
    || action === "upload.folder"
    || action === "upload.camera_roll"
    || action === "upload.preview"
  ) {
    return { kind: "FILE_UPLOADED", subjectType, subjectId: targetId, label, meta };
  }
  if (action === "file.update" || action === "folder.update") {
    if (subjectType === "folder") {
      return { kind: "FOLDER_MOVED", subjectType: "folder", subjectId: targetId, label, meta };
    }
    const metaObj = (meta && typeof meta === "object" && !Array.isArray(meta)) ? (meta as Record<string, unknown>) : null;
    const fromPath = String(metaObj?.fromPath || "").trim();
    const toPath = String(metaObj?.toPath || "").trim();
    let kind: "MOVE_FILE" | "RENAME_FILE" | "FILE_RENAMED" = "FILE_RENAMED";
    if (fromPath && toPath && fromPath !== toPath) {
      const fromDir = fromPath.slice(0, Math.max(1, fromPath.lastIndexOf("/")));
      const toDir = toPath.slice(0, Math.max(1, toPath.lastIndexOf("/")));
      kind = fromDir === toDir ? "FILE_RENAMED" : "MOVE_FILE";
    }
    return { kind, subjectType, subjectId: targetId, label, meta };
  }
  if (action === "file.delete" || action === "folder.delete" || action === "trash.permanent_delete") {
    if (subjectType === "file") {
      return { kind: "FILE_DELETED", subjectType, subjectId: targetId, label, meta };
    }
    return { kind: "DELETE_FILE", subjectType, subjectId: targetId, label, meta };
  }
  if (action === "trash.restore") {
    return { kind: "RESTORE_FILE", subjectType, subjectId: targetId, label, meta };
  }
  if (action === "share.create") {
    return { kind: "SHARE_CREATED", subjectType: "share", subjectId: targetId, label, meta };
  }
  if (action === "share.revoke" || action === "share.unshare") {
    return { kind: "SHARE_REVOKED", subjectType: "share", subjectId: targetId, label, meta };
  }
  if (action === "file.duplicate") {
    return { kind: "DUPLICATE_FILE", subjectType: "file", subjectId: targetId, label, meta };
  }
  if (action === "file.zip" || action === "folder.zip") {
    return { kind: "ZIP_CREATED", subjectType, subjectId: targetId, label, meta };
  }
  if (action === "artifact.publish") {
    return { kind: "ARTIFACT_PUBLISHED", subjectType: "artifact", subjectId: targetId, label, meta };
  }
  if (action === "artifact.unpublish") {
    return { kind: "UNPUBLISHED_ARTIFACT", subjectType: "artifact", subjectId: targetId, label, meta };
  }
  if (action === "access_granted" || action === "collab.grant") {
    return {
      kind: "COLLAB_GRANTED",
      subjectType: subjectType === "folder" ? "folder" : "file",
      subjectId: targetId,
      label,
      meta,
    };
  }
  if (action === "access_revoked" || action === "collab.revoke") {
    return {
      kind: "COLLAB_REVOKED",
      subjectType: subjectType === "folder" ? "folder" : "file",
      subjectId: targetId,
      label,
      meta,
    };
  }

  return null;
}

async function syncPathIndexFromActivity(tx: DbClient, options: {
  accountId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
}) {
  const action = String(options.action || "").trim().toLowerCase();
  const targetType = String(options.targetType || "").trim().toLowerCase();
  const targetId = String(options.targetId || "").trim();

  if (
    action === "folder.update"
    || action === "folder.delete"
    || action === "trash.permanent_delete"
    || (action === "trash.restore" && targetType === "folder")
  ) {
    await rebuildFilePathIndexForAccount(tx, options.accountId);
    return;
  }

  if (
    action === "file.upload.simple"
    || action === "file.upload.multipart.complete"
    || action === "file.metadata.create"
    || action === "file.sync.upsert"
    || action === "file.update"
    || action === "file.delete"
    || action === "file.duplicate"
    || action === "file.zip"
    || (action === "trash.restore" && targetType === "file")
  ) {
    if (targetId) {
      await syncFilePathIndexForFile(tx, options.accountId, targetId);
      return;
    }
    await rebuildFilePathIndexForAccount(tx, options.accountId);
  }
}

async function writeActivity(
  tx: DbClient,
  options: {
    accountId: string;
    operatorUserId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    targetPath?: string | null;
    metaJson?: Prisma.InputJsonValue | undefined;
  }
) {
  await tx.cavCloudActivity.create({
    data: {
      accountId: options.accountId,
      operatorUserId: options.operatorUserId || null,
      action: String(options.action || "").slice(0, 64),
      targetType: String(options.targetType || "").slice(0, 32),
      targetId: options.targetId || null,
      targetPath: options.targetPath || null,
      metaJson: options.metaJson,
    },
  });

  await syncPathIndexFromActivity(tx, {
    accountId: options.accountId,
    action: options.action,
    targetType: options.targetType,
    targetId: options.targetId || null,
  });

  const mapped = inferOperationLogFromActivity(options);
  if (!mapped) return;
  if (!(await ensureOperationLogTableAvailability(tx))) return;

  try {
    await tx.cavCloudOperationLog.create({
      data: {
        accountId: options.accountId,
        operatorUserId: options.operatorUserId || null,
        kind: mapped.kind,
        subjectType: mapped.subjectType,
        subjectId: mapped.subjectId,
        label: mapped.label,
        meta: mapped.meta,
      },
    });
    cavCloudOperationLogTableAvailable = true;
  } catch (err) {
    if (isMissingOperationLogTableError(err)) {
      cavCloudOperationLogTableAvailable = false;
      return;
    }
    throw err;
  }
}

async function loadRecentActivity(accountId: string, tx: DbClient = prisma, limit = 24): Promise<CavCloudActivityItem[]> {
  const safeLimit = Math.max(1, Math.min(limit, 120));

  if (await ensureOperationLogTableAvailability(tx)) {
    try {
      const rows = await tx.cavCloudOperationLog.findMany({
        where: {
          accountId,
          kind: {
            in: [...CAVCLOUD_ACTIVITY_OPERATION_KINDS],
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: safeLimit,
        select: {
          id: true,
          kind: true,
          subjectType: true,
          subjectId: true,
          label: true,
          createdAt: true,
          meta: true,
        },
      });

      return rows.map((row) => {
        const metaJson = normalizeActivityMeta(row.meta as Prisma.JsonValue | null | undefined);
        const targetPathFromMeta = String(
          metaJson?.targetPath
          || metaJson?.toPath
          || metaJson?.path
          || row.label
          || "",
        ).trim() || null;
        return {
          id: row.id,
          action: operationKindToLegacyActivityAction({
            kind: row.kind,
            subjectType: row.subjectType,
            meta: metaJson,
          }),
          targetType: row.subjectType,
          targetId: row.subjectId || null,
          targetPath: targetPathFromMeta,
          createdAtISO: toISO(row.createdAt),
          metaJson,
        };
      });
    } catch (err) {
      if (isMissingOperationLogTableError(err)) {
        cavCloudOperationLogTableAvailable = false;
      } else {
        throw err;
      }
    }
  }

  const rows = await tx.cavCloudActivity.findMany({
    where: {
      accountId,
      action: {
        in: [...FEED_ACTIVITY_ACTIONS],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: safeLimit,
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      targetPath: true,
      createdAt: true,
      metaJson: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetPath: row.targetPath,
    createdAtISO: toISO(row.createdAt),
    metaJson: normalizeActivityMeta(row.metaJson),
  }));
}

async function resolveCollabBadges(args: {
  accountId: string;
  fileIds: string[];
  folderIds: string[];
  tx?: DbClient;
}) {
  const tx = args.tx ?? prisma;
  const accountId = String(args.accountId || "").trim();
  if (!accountId) {
    return {
      fileById: new Map<string, { sharedUserCount: number; collaborationEnabled: boolean }>(),
      folderById: new Map<string, { sharedUserCount: number; collaborationEnabled: boolean }>(),
    };
  }

  const now = new Date();
  const [fileRows, folderRows] = await Promise.all([
    args.fileIds.length
      ? tx.cavCloudFileAccess.findMany({
          where: {
            accountId,
            fileId: { in: args.fileIds },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: {
            fileId: true,
            permission: true,
          },
        })
      : Promise.resolve([]),
    args.folderIds.length
      ? tx.cavCloudFolderAccess.findMany({
          where: {
            accountId,
            folderId: { in: args.folderIds },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: {
            folderId: true,
            role: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const fileById = new Map<string, { sharedUserCount: number; collaborationEnabled: boolean }>();
  for (const row of fileRows) {
    const current = fileById.get(row.fileId) || { sharedUserCount: 0, collaborationEnabled: false };
    current.sharedUserCount += 1;
    if (row.permission === "EDIT") current.collaborationEnabled = true;
    fileById.set(row.fileId, current);
  }

  const folderById = new Map<string, { sharedUserCount: number; collaborationEnabled: boolean }>();
  for (const row of folderRows) {
    const current = folderById.get(row.folderId) || { sharedUserCount: 0, collaborationEnabled: false };
    current.sharedUserCount += 1;
    if (row.role === "EDITOR") current.collaborationEnabled = true;
    folderById.set(row.folderId, current);
  }

  return { fileById, folderById };
}

function mapFolder(row: {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}, collab?: { sharedUserCount: number; collaborationEnabled: boolean }): CavCloudFolderItem {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    parentId: row.parentId,
    sharedUserCount: Math.max(0, Math.trunc(Number(collab?.sharedUserCount || 0))),
    collaborationEnabled: Boolean(collab?.collaborationEnabled),
    createdAtISO: toISO(row.createdAt),
    updatedAtISO: toISO(row.updatedAt),
  };
}

function normalizeFileStatus(value: unknown): "UPLOADING" | "READY" | "FAILED" {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "UPLOADING") return "UPLOADING";
  if (normalized === "FAILED") return "FAILED";
  return "READY";
}

function fileListingStatusRank(value: unknown): number {
  const status = normalizeFileStatus(value);
  if (status === "READY") return 0;
  if (status === "UPLOADING") return 1;
  if (status === "FAILED") return 2;
  return 3;
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

function compareFolderRowsForListing(
  left: { name: string; path: string; updatedAt?: Date | string | null; createdAt?: Date | string | null },
  right: { name: string; path: string; updatedAt?: Date | string | null; createdAt?: Date | string | null },
  prefs: CavCloudListingPreferences,
): number {
  if (prefs.defaultSort === "modified") {
    const leftUpdated = parseDateLike(left.updatedAt)?.getTime() || parseDateLike(left.createdAt)?.getTime() || 0;
    const rightUpdated = parseDateLike(right.updatedAt)?.getTime() || parseDateLike(right.createdAt)?.getTime() || 0;
    const modifiedDelta = rightUpdated - leftUpdated;
    if (modifiedDelta !== 0) return modifiedDelta;
  }
  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;
  return left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
}

function compareFileRowsForListing(
  left: {
    status?: string | null;
    name: string;
    path: string;
    updatedAt?: Date | string | null;
    createdAt?: Date | string | null;
    bytes?: bigint | number | null;
  },
  right: {
    status?: string | null;
    name: string;
    path: string;
    updatedAt?: Date | string | null;
    createdAt?: Date | string | null;
    bytes?: bigint | number | null;
  },
  prefs: CavCloudListingPreferences,
): number {
  const rank = fileListingStatusRank(left.status) - fileListingStatusRank(right.status);
  if (rank !== 0) return rank;

  if (prefs.defaultSort === "size") {
    const leftBytes = parseBigIntLike(left.bytes) ?? BigInt(0);
    const rightBytes = parseBigIntLike(right.bytes) ?? BigInt(0);
    if (leftBytes !== rightBytes) return leftBytes > rightBytes ? -1 : 1;
  }

  if (prefs.defaultSort === "modified" || prefs.defaultSort === "size") {
    const leftUpdated = parseDateLike(left.updatedAt)?.getTime() || parseDateLike(left.createdAt)?.getTime() || 0;
    const rightUpdated = parseDateLike(right.updatedAt)?.getTime() || parseDateLike(right.createdAt)?.getTime() || 0;
    const updatedDelta = rightUpdated - leftUpdated;
    if (updatedDelta !== 0) return updatedDelta;
  }

  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;
  return left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
}

function mapFile(row: {
  id: string;
  folderId: string;
  name: string;
  path: string;
  relPath?: string;
  r2Key: string;
  bytes: bigint;
  mimeType: string;
  sha256: string;
  previewSnippet?: string | null;
  previewSnippetUpdatedAt?: Date | null;
  status?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}, collab?: { sharedUserCount: number; collaborationEnabled: boolean }): CavCloudFileItem {
  return {
    id: row.id,
    folderId: row.folderId,
    name: row.name,
    path: row.path,
    relPath: String(row.relPath || "").trim() || toRelPath(row.path),
    r2Key: row.r2Key,
    bytes: toSafeNumber(row.bytes),
    bytesExact: row.bytes.toString(),
    mimeType: row.mimeType,
    sha256: row.sha256,
    previewSnippet: normalizePreviewSnippetText(row.previewSnippet || null, PREVIEW_SNIPPET_MAX_CHARS),
    previewSnippetUpdatedAtISO: row.previewSnippetUpdatedAt ? toISO(row.previewSnippetUpdatedAt) : null,
    status: normalizeFileStatus(row.status),
    errorCode: row.errorCode || null,
    errorMessage: row.errorMessage || null,
    sharedUserCount: Math.max(0, Math.trunc(Number(collab?.sharedUserCount || 0))),
    collaborationEnabled: Boolean(collab?.collaborationEnabled),
    createdAtISO: toISO(row.createdAt),
    updatedAtISO: toISO(row.updatedAt),
  };
}

async function purgeExpiredTrash(accountId: string, operatorUserId?: string) {
  const expired = await prisma.cavCloudTrash.findMany({
    where: {
      accountId,
      purgeAfter: {
        lte: new Date(),
      },
    },
    orderBy: { purgeAfter: "asc" },
    select: { id: true },
    take: 20,
  });

  let removedFiles = 0;
  let removedFolders = 0;
  for (const item of expired) {
    const result = await permanentlyDeleteTrashEntry({
      accountId,
      trashId: item.id,
      operatorUserId: operatorUserId || null,
      reason: "lifecycle_purge",
    });
    removedFiles += Number(result.removedFiles || 0);
    removedFolders += Number(result.removedFolders || 0);
  }

  const operatorId = String(operatorUserId || "").trim();
  if (operatorId && (removedFiles > 0 || removedFolders > 0)) {
    try {
      await notifyCavCloudBulkDeletePurge({
        accountId,
        userId: operatorId,
        removedFiles,
        removedFolders,
        reason: "lifecycle_purge",
        href: "/cavcloud",
      });
    } catch {
      // Non-blocking.
    }
  }
}

async function resolveTrashRetentionDaysForOperator(accountId: string, operatorUserId?: string | null): Promise<number> {
  const userId = String(operatorUserId || "").trim();
  if (!accountId || !userId) return TRASH_RETENTION_DAYS;
  try {
    const settings = await getCavCloudSettings({ accountId, userId });
    const days = Number(settings.trashRetentionDays);
    if (days === 7 || days === 14 || days === 30) return days;
  } catch {
    // fail-open to baseline retention
  }
  return TRASH_RETENTION_DAYS;
}

async function shouldAutoPurgeTrash(accountId: string, operatorUserId?: string | null): Promise<boolean> {
  const userId = String(operatorUserId || "").trim();
  if (!accountId || !userId) return true;
  try {
    const settings = await getCavCloudSettings({ accountId, userId });
    return settings.autoPurgeTrash !== false;
  } catch {
    return true;
  }
}

async function maybePurgeExpiredTrash(accountId: string, operatorUserId?: string) {
  if (!(await shouldAutoPurgeTrash(accountId, operatorUserId || null))) return;
  const now = Date.now();
  const last = expiredTrashPurgeAtByAccount.get(accountId) || 0;
  if (now - last < EXPIRED_TRASH_PURGE_MIN_INTERVAL_MS) return;
  expiredTrashPurgeAtByAccount.set(accountId, now);
  try {
    await purgeExpiredTrash(accountId, operatorUserId);
  } catch {
    // Fail-open so tree reads stay fast and resilient.
  }
}

function buildBreadcrumbPaths(path: string): string[] {
  const normalized = normalizePathNoTrailingSlash(path);
  if (normalized === "/") return ["/"];
  const parts = normalized.split("/").filter(Boolean);
  const out = ["/"];
  let cur = "";
  for (const part of parts) {
    cur = `${cur}/${part}`;
    out.push(cur);
  }
  return out;
}

function workspaceR2ObjectKey(
  accountId: string,
  fileId: string,
  filename: string,
  ownerUserId?: string | null,
  workspaceId?: string | null,
): string {
  const safe = safeFilenameForKey(filename);
  const owner = safeKeyScopeSegment(ownerUserId || accountId);
  const workspace = safeKeyScopeSegment(workspaceId || "");
  if (workspaceId && workspace) {
    return `w/${workspace}/${fileId}/${safe}`;
  }
  return `u/${owner}/${fileId}/${safe}`;
}

function workspaceR2VersionObjectKey(
  accountId: string,
  fileId: string,
  filename: string,
  ownerUserId?: string | null,
  workspaceId?: string | null,
): string {
  const base = workspaceR2ObjectKey(accountId, fileId, filename, ownerUserId, workspaceId);
  const stamp = Date.now().toString(36);
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  return `${base}.v${stamp}-${nonce}`;
}

function previewSnippetFromChunkParts(chunks: Buffer[], totalBytes: number, name: string, mimeType: string): string | null {
  if (!chunks.length || totalBytes <= 0) return null;
  const head = Buffer.concat(chunks, totalBytes);
  return previewSnippetFromBytes(head, {
    name,
    mimeType,
    maxChars: PREVIEW_SNIPPET_MAX_CHARS,
  });
}

function previewSnippetUpdateFromBytes(name: string, mimeType: string, bytes: Uint8Array | Buffer): {
  previewSnippet: string | null;
  previewSnippetUpdatedAt: Date;
} {
  return {
    previewSnippet: previewSnippetFromBytes(bytes, {
      name,
      mimeType,
      maxChars: PREVIEW_SNIPPET_MAX_CHARS,
    }),
    previewSnippetUpdatedAt: new Date(),
  };
}

async function readObjectPrefixBuffer(objectKey: string, maxBytes = PREVIEW_SNIPPET_RANGE_BYTES): Promise<Buffer | null> {
  const limit = Math.max(1, Math.trunc(Number(maxBytes) || PREVIEW_SNIPPET_RANGE_BYTES));
  const stream = await getCavcloudObjectStream({
    objectKey,
    range: `bytes=0-${limit - 1}`,
  });
  if (!stream) return null;

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = stream.body.getReader();

  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;
    const remaining = limit - total;
    const chunk = Buffer.from(value);
    if (chunk.length > remaining) {
      chunks.push(chunk.subarray(0, remaining));
      total += remaining;
      break;
    }
    chunks.push(chunk);
    total += chunk.length;
  }

  try {
    await reader.cancel();
  } catch {
    // no-op
  }

  if (!chunks.length || total <= 0) return null;
  return Buffer.concat(chunks, total);
}

async function computePreviewSnippetFromObject(objectKey: string, name: string, mimeType: string): Promise<string | null> {
  if (!isTextLikeFile(name, mimeType)) return null;
  const prefix = await readObjectPrefixBuffer(objectKey, PREVIEW_SNIPPET_RANGE_BYTES);
  if (!prefix) return null;
  return previewSnippetFromBytes(prefix, {
    name,
    mimeType,
    maxChars: PREVIEW_SNIPPET_MAX_CHARS,
  });
}

async function runWithConcurrency<T>(items: T[], concurrency: number, work: (item: T, index: number) => Promise<void>) {
  if (!items.length) return;
  const workerCount = Math.max(1, Math.min(Math.trunc(Number(concurrency) || 1), items.length));
  let index = 0;

  const worker = async () => {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await work(items[current], current);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

async function readObjectBuffer(objectKey: string, maxBytes?: bigint): Promise<Buffer> {
  const stream = await getCavcloudObjectStream({ objectKey });
  if (!stream) throw new CavCloudError("FILE_NOT_FOUND", 404, "source object missing");

  const chunks: Buffer[] = [];
  let total = BigInt(0);
  const reader = stream.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;
    const chunk = Buffer.from(value);
    total += BigInt(chunk.byteLength);
    if (maxBytes != null && total > maxBytes) {
      throw new CavCloudError("ZIP_SOURCE_TOO_LARGE", 413, "archive source exceeds configured size limit");
    }
    chunks.push(chunk);
  }

  const totalNumber = bigintToContentLengthOrUndefined(total);
  if (totalNumber == null) {
    return Buffer.concat(chunks);
  }
  return Buffer.concat(chunks, totalNumber);
}

async function copyObjectToKey(args: {
  sourceKey: string;
  destinationKey: string;
  contentType: string;
  contentLength: bigint;
}) {
  const source = await getCavcloudObjectStream({ objectKey: args.sourceKey });
  if (!source) throw new CavCloudError("FILE_NOT_FOUND", 404, "source object missing");

  const body = Readable.fromWeb(source.body as unknown as NodeReadableStream<Uint8Array>);
  await putCavcloudObjectStream({
    objectKey: args.destinationKey,
    body,
    contentType: args.contentType,
    contentLength: bigintToContentLengthOrUndefined(args.contentLength),
  });
}

function entryPathFromDescendantPath(folderPath: string, filePath: string, fallbackName: string): string {
  const root = normalizePathNoTrailingSlash(folderPath);
  const full = normalizePathNoTrailingSlash(filePath);
  if (root === "/") {
    const noLead = full.replace(/^\/+/, "");
    return noLead || fallbackName;
  }
  const prefix = `${root}/`;
  if (!full.startsWith(prefix)) return fallbackName;
  const rel = full.slice(prefix.length).replace(/^\/+/, "");
  return rel || fallbackName;
}

function parentPathFromAbsolutePath(path: string): string {
  const normalized = normalizePathNoTrailingSlash(path);
  if (normalized === "/") return "/";
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return "/";
  return normalized.slice(0, slash) || "/";
}

function isDirectChildPath(parentPath: string, candidatePath: string): boolean {
  const parent = normalizePathNoTrailingSlash(parentPath);
  const candidate = normalizePathNoTrailingSlash(candidatePath);
  if (candidate === parent) return false;
  return parentPathFromAbsolutePath(candidate) === parent;
}

async function loadFolderChildrenPayload(args: {
  accountId: string;
  folderWhere: Prisma.CavCloudFolderWhereInput;
  query?: string;
  listing?: CavCloudListingPreferences;
}): Promise<CavCloudFolderChildrenPayload> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  const listing = normalizeListingPrefs(args.listing);
  await ensureOfficialSyncedFolders(accountId);

  const folder = await prisma.cavCloudFolder.findFirst({
    where: args.folderWhere,
    select: {
      id: true,
      name: true,
      path: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!folder) throw new CavCloudError("FOLDER_NOT_FOUND", 404);

  const q = String(args.query || "").trim();
  const nameFilter = q ? { contains: q, mode: "insensitive" as const } : null;

  const [folderRows, fileRows, breadcrumbRows] = await Promise.all([
    prisma.cavCloudFolder.findMany({
      where: {
        accountId,
        deletedAt: null,
        path: scopePaths(folder.path),
        ...(nameFilter ? { name: nameFilter } : {}),
      },
      select: {
        id: true,
        name: true,
        path: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.cavCloudFile.findMany({
      where: {
        accountId,
        deletedAt: null,
        path: scopePaths(folder.path),
        ...(nameFilter ? { name: nameFilter } : {}),
      },
      select: {
        id: true,
        folderId: true,
        name: true,
        path: true,
        relPath: true,
        r2Key: true,
        bytes: true,
        mimeType: true,
        sha256: true,
        previewSnippet: true,
        previewSnippetUpdatedAt: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.cavCloudFolder.findMany({
      where: {
        accountId,
        path: { in: buildBreadcrumbPaths(folder.path) },
      },
      select: {
        id: true,
        name: true,
        path: true,
      },
    }),
  ]);

  const folders = folderRows
    .filter((row) => isDirectChildPath(folder.path, row.path))
    .filter((row) => listing.showDotfiles || !isDotfileName(row.name))
    .sort((left, right) => compareFolderRowsForListing(left, right, listing));

  const files = fileRows
    .filter((row) => isDirectChildPath(folder.path, row.path))
    .filter((row) => listing.showDotfiles || !isDotfileName(row.name))
    .sort((left, right) => compareFileRowsForListing(left, right, listing));

  const failedFileIds = files
    .filter((row) => normalizeFileStatus(row.status) === "FAILED")
    .map((row) => row.id);
  const failedMetaByFileId = new Map<string, { errorCode: string | null; errorMessage: string | null }>();
  if (failedFileIds.length) {
    const failedMetaRows = await prismaFolderUpload.cavCloudFolderUploadSessionFile.findMany({
      where: {
        accountId,
        fileId: { in: failedFileIds },
        status: "FAILED",
      },
      orderBy: { updatedAt: "desc" },
      select: {
        fileId: true,
        errorCode: true,
        errorMessage: true,
      },
    });
    for (const row of failedMetaRows) {
      if (!failedMetaByFileId.has(row.fileId)) {
        failedMetaByFileId.set(row.fileId, {
          errorCode: row.errorCode || null,
          errorMessage: row.errorMessage || null,
        });
      }
    }
  }

  const breadcrumbByPath = new Map(breadcrumbRows.map((row) => [row.path, row]));
  const breadcrumbs = buildBreadcrumbPaths(folder.path)
    .map((p) => breadcrumbByPath.get(p))
    .filter((v): v is { id: string; name: string; path: string } => !!v)
    .map((row) => ({ id: row.id, name: row.name, path: row.path }));
  const collabBadges = await resolveCollabBadges({
    accountId,
    fileIds: files.map((row) => row.id),
    folderIds: folders.map((row) => row.id),
  });

  return {
    folder: mapFolder(folder, collabBadges.folderById.get(folder.id)),
    breadcrumbs,
    folders: folders.map((row) => mapFolder(row, collabBadges.folderById.get(row.id))),
    files: files.map((row) => {
      const failure = failedMetaByFileId.get(row.id);
      return mapFile({
        ...row,
        errorCode: failure?.errorCode || null,
        errorMessage: failure?.errorMessage || null,
      }, collabBadges.fileById.get(row.id));
    }),
  };
}

export async function getRootFolder(args: { accountId: string }) {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  const root = await ensureRootFolder(accountId);
  await ensureOfficialSyncedFolders(accountId);
  return mapFolder(root);
}

async function resolveFolderIdWithRootAlias(accountId: string, folderId: string) {
  const normalizedFolderId = String(folderId || "").trim();
  if (!normalizedFolderId) throw new CavCloudError("FOLDER_ID_REQUIRED", 400);
  if (normalizedFolderId.toLowerCase() !== "root") return normalizedFolderId;
  const root = await ensureRootFolder(accountId);
  await ensureOfficialSyncedFolders(accountId);
  return String(root.id || "").trim();
}

export async function getFolderChildrenById(args: {
  accountId: string;
  folderId: string;
  listing?: CavCloudListingPreferences;
}) {
  const accountId = String(args.accountId || "").trim();
  const folderId = await resolveFolderIdWithRootAlias(accountId, args.folderId);
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  return loadFolderChildrenPayload({
    accountId,
    folderWhere: {
      id: folderId,
      accountId,
      deletedAt: null,
    },
    listing: args.listing,
  });
}

export async function searchFolderChildren(args: {
  accountId: string;
  folderId: string;
  query: string;
  listing?: CavCloudListingPreferences;
}) {
  const accountId = String(args.accountId || "").trim();
  const folderId = await resolveFolderIdWithRootAlias(accountId, args.folderId);
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  return loadFolderChildrenPayload({
    accountId,
    folderWhere: {
      id: folderId,
      accountId,
      deletedAt: null,
    },
    query: args.query,
    listing: args.listing,
  });
}

export async function getTreeLite(args: {
  accountId: string;
  folderPath?: string;
  listing?: CavCloudListingPreferences;
}): Promise<CavCloudFolderChildrenPayload> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  await ensureRootFolder(accountId);
  await ensureOfficialSyncedFolders(accountId);
  const path = normalizePathNoTrailingSlash(args.folderPath || "/");
  return loadFolderChildrenPayload({
    accountId,
    folderWhere: {
      accountId,
      path,
      deletedAt: null,
    },
    listing: args.listing,
  });
}

export async function getTree(args: {
  accountId: string;
  folderPath?: string;
  operatorUserId?: string | null;
  listing?: CavCloudListingPreferences;
}): Promise<CavCloudTreePayload> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  const listing = normalizeListingPrefs(args.listing);

  void maybePurgeExpiredTrash(accountId, args.operatorUserId || undefined);

  const path = normalizePathNoTrailingSlash(args.folderPath || "/");
  await ensureRootFolder(accountId);
  await ensureOfficialSyncedFolders(accountId);

  const folder = await prisma.cavCloudFolder.findFirst({
    where: {
      accountId,
      path,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      path: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!folder) throw new CavCloudError("FOLDER_NOT_FOUND", 404);
  if (args.operatorUserId) {
    void rememberCavCloudLastFolder({
      accountId,
      userId: args.operatorUserId,
      folderId: folder.id,
    });
  }

  const [folderRows, fileRows, breadcrumbRows, trashRows, usage, activity, storageHistory] = await Promise.all([
    prisma.cavCloudFolder.findMany({
      where: {
        accountId,
        deletedAt: null,
        path: scopePaths(folder.path),
      },
      select: {
        id: true,
        name: true,
        path: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.cavCloudFile.findMany({
      where: {
        accountId,
        deletedAt: null,
        path: scopePaths(folder.path),
      },
      select: {
        id: true,
        folderId: true,
        name: true,
        path: true,
        relPath: true,
        r2Key: true,
        bytes: true,
        mimeType: true,
        sha256: true,
        previewSnippet: true,
        previewSnippetUpdatedAt: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.cavCloudFolder.findMany({
      where: {
        accountId,
        path: { in: buildBreadcrumbPaths(folder.path) },
      },
      select: {
        id: true,
        name: true,
        path: true,
      },
    }),
    prisma.cavCloudTrash.findMany({
      where: { accountId },
      orderBy: { deletedAt: "desc" },
      take: 200,
      select: {
        id: true,
        deletedAt: true,
        purgeAfter: true,
        file: {
          select: {
            id: true,
            name: true,
            path: true,
            bytes: true,
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
    }),
    quotaSnapshot(accountId),
    loadRecentActivity(accountId),
    loadStorageHistory(accountId),
  ]);

  const folders = folderRows
    .filter((row) => isDirectChildPath(folder.path, row.path))
    .filter((row) => listing.showDotfiles || !isDotfileName(row.name))
    .sort((left, right) => compareFolderRowsForListing(left, right, listing));

  const files = fileRows
    .filter((row) => isDirectChildPath(folder.path, row.path))
    .filter((row) => listing.showDotfiles || !isDotfileName(row.name))
    .sort((left, right) => compareFileRowsForListing(left, right, listing));

  const failedFileIds = files
    .filter((row) => normalizeFileStatus(row.status) === "FAILED")
    .map((row) => row.id);
  const failedMetaByFileId = new Map<string, { errorCode: string | null; errorMessage: string | null }>();
  if (failedFileIds.length) {
    const failedMetaRows = await prismaFolderUpload.cavCloudFolderUploadSessionFile.findMany({
      where: {
        accountId,
        fileId: { in: failedFileIds },
        status: "FAILED",
      },
      orderBy: { updatedAt: "desc" },
      select: {
        fileId: true,
        errorCode: true,
        errorMessage: true,
      },
    });
    for (const row of failedMetaRows) {
      if (!failedMetaByFileId.has(row.fileId)) {
        failedMetaByFileId.set(row.fileId, {
          errorCode: row.errorCode || null,
          errorMessage: row.errorMessage || null,
        });
      }
    }
  }

  const breadcrumbByPath = new Map(breadcrumbRows.map((b) => [b.path, b]));
  const breadcrumbs = buildBreadcrumbPaths(folder.path)
    .map((p) => breadcrumbByPath.get(p))
    .filter((v): v is { id: string; name: string; path: string } => !!v)
    .map((b) => ({ id: b.id, name: b.name, path: b.path }));
  const collabBadges = await resolveCollabBadges({
    accountId,
    fileIds: files.map((row) => row.id),
    folderIds: folders.map((row) => row.id),
  });

  return {
    folder: mapFolder(folder, collabBadges.folderById.get(folder.id)),
    breadcrumbs,
    folders: folders.map((row) => mapFolder(row, collabBadges.folderById.get(row.id))),
    files: files.map((row) => {
      const failure = failedMetaByFileId.get(row.id);
      return mapFile({
        ...row,
        errorCode: failure?.errorCode || null,
        errorMessage: failure?.errorMessage || null,
      }, collabBadges.fileById.get(row.id));
    }),
    trash: trashRows
      .map((t) => {
        if (t.file) {
          return {
            id: t.id,
            kind: "file" as const,
            targetId: t.file.id,
            name: t.file.name,
            path: t.file.path,
            bytes: toSafeNumber(t.file.bytes),
            deletedAtISO: toISO(t.deletedAt),
            purgeAfterISO: toISO(t.purgeAfter),
          };
        }
        if (t.folder) {
          return {
            id: t.id,
            kind: "folder" as const,
            targetId: t.folder.id,
            name: t.folder.name,
            path: t.folder.path,
            bytes: null,
            deletedAtISO: toISO(t.deletedAt),
            purgeAfterISO: toISO(t.purgeAfter),
          };
        }
        return null;
      })
      .filter((v): v is NonNullable<typeof v> => !!v),
    usage: {
      usedBytes: toSafeNumber(usage.usedBytes),
      usedBytesExact: usage.usedBytes.toString(),
      limitBytes: usage.limitBytes == null ? null : toSafeNumber(usage.limitBytes),
      limitBytesExact: usage.limitBytes == null ? null : usage.limitBytes.toString(),
      remainingBytes: usage.remainingBytes == null ? null : toSafeNumber(usage.remainingBytes),
      remainingBytesExact: usage.remainingBytes == null ? null : usage.remainingBytes.toString(),
      planId: usage.planId,
      perFileMaxBytes: toSafeNumber(usage.perFileMaxBytes),
      perFileMaxBytesExact: usage.perFileMaxBytes.toString(),
    },
    activity,
    storageHistory,
  };
}

export async function listGalleryFiles(args: { accountId: string }): Promise<CavCloudFileItem[]> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);

  const files = await prisma.cavCloudFile.findMany({
    where: {
      accountId,
      deletedAt: null,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      folderId: true,
      name: true,
      path: true,
      relPath: true,
      r2Key: true,
      bytes: true,
      mimeType: true,
      sha256: true,
      previewSnippet: true,
      previewSnippetUpdatedAt: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return files.map((row) => mapFile({
    ...row,
    errorCode: null,
    errorMessage: null,
  }));
}

export async function getFileById(args: { accountId: string; fileId: string }) {
  const file = await prisma.cavCloudFile.findFirst({
    where: {
      id: args.fileId,
      accountId: args.accountId,
      deletedAt: null,
      status: "READY",
    },
    select: {
      id: true,
      folderId: true,
      name: true,
      path: true,
      r2Key: true,
      bytes: true,
      mimeType: true,
      sha256: true,
      previewSnippet: true,
      previewSnippetUpdatedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!file) throw new CavCloudError("FILE_NOT_FOUND", 404);
  return mapFile(file);
}

export async function getOrCreateFilePreviewSnippets(args: {
  accountId: string;
  fileIds: string[];
  maxBatch?: number;
  concurrency?: number;
  allowGenerate?: boolean;
}): Promise<Record<string, string | null>> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  const allowGenerate = args.allowGenerate !== false;

  const maxBatch = Math.max(1, Math.min(PREVIEW_SNIPPET_BATCH_MAX, Math.trunc(Number(args.maxBatch) || PREVIEW_SNIPPET_BATCH_MAX)));
  const concurrency = Math.max(1, Math.min(16, Math.trunc(Number(args.concurrency) || PREVIEW_SNIPPET_CONCURRENCY)));
  const requestedIds = Array.from(
    new Set(
      (Array.isArray(args.fileIds) ? args.fileIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, maxBatch);

  const out: Record<string, string | null> = {};
  for (const id of requestedIds) out[id] = null;
  if (!requestedIds.length) return out;

  const files = await prisma.cavCloudFile.findMany({
    where: {
      accountId,
      id: { in: requestedIds },
    },
    select: {
      id: true,
      name: true,
      mimeType: true,
      r2Key: true,
      previewSnippet: true,
      previewSnippetUpdatedAt: true,
    },
  });

  const byId = new Map(files.map((row) => [row.id, row]));
  await runWithConcurrency(requestedIds, concurrency, async (fileId) => {
    const file = byId.get(fileId);
    if (!file) return;

    const existing = normalizePreviewSnippetText(file.previewSnippet || null, PREVIEW_SNIPPET_MAX_CHARS);
    if (existing != null) {
      out[fileId] = existing;
      return;
    }

    const isTextLike = isTextLikeFile(file.name, file.mimeType);
    if (!isTextLike) {
      if (!allowGenerate) return;
      if (!file.previewSnippetUpdatedAt) {
        await prisma.cavCloudFile.updateMany({
          where: {
            id: file.id,
            accountId,
            previewSnippetUpdatedAt: null,
          },
          data: {
            previewSnippet: null,
            previewSnippetUpdatedAt: new Date(),
          },
        });
      }
      return;
    }

    if (file.previewSnippetUpdatedAt && file.previewSnippet == null) {
      return;
    }
    if (!allowGenerate) return;

    let snippet: string | null = null;
    try {
      snippet = await computePreviewSnippetFromObject(file.r2Key, file.name, file.mimeType);
    } catch {
      snippet = null;
    }

    await prisma.cavCloudFile.updateMany({
      where: {
        id: file.id,
        accountId,
      },
      data: {
        previewSnippet: snippet,
        previewSnippetUpdatedAt: new Date(),
      },
    });

    out[fileId] = normalizePreviewSnippetText(snippet, PREVIEW_SNIPPET_MAX_CHARS);
  });

  return out;
}

export async function getTrashFileForPreview(args: { accountId: string; trashId: string }) {
  const accountId = String(args.accountId || "").trim();
  const trashId = String(args.trashId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!trashId) throw new CavCloudError("TRASH_ID_REQUIRED", 400);

  const trash = await prisma.cavCloudTrash.findFirst({
    where: {
      id: trashId,
      accountId,
    },
    select: {
      id: true,
      file: {
        select: {
          id: true,
          name: true,
          path: true,
          r2Key: true,
          mimeType: true,
          bytes: true,
        },
      },
    },
  });

  if (!trash?.file) throw new CavCloudError("TRASH_FILE_NOT_FOUND", 404);

  return {
    trashId: trash.id,
    fileId: trash.file.id,
    name: trash.file.name,
    path: trash.file.path,
    r2Key: trash.file.r2Key,
    mimeType: trash.file.mimeType,
    bytes: toSafeNumber(trash.file.bytes),
  };
}

export async function createFolder(args: {
  accountId: string;
  operatorUserId?: string | null;
  parentId?: string | null;
  parentPath?: string | null;
  name: string;
}) {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);

  const name = safeNodeName(args.name);

  let created: {
    id: string;
    name: string;
    path: string;
    parentId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  try {
    created = await runSerializableTxWithRetry(() => prisma.$transaction(async (tx) => {
      const parent = await resolveFolderForWrite({
        accountId,
        folderId: args.parentId ?? null,
        folderPath: args.parentPath ?? null,
        tx,
      });

    const path = joinPath(parent.path, name);
    const existingFolder = await tx.cavCloudFolder.findFirst({
      where: {
        accountId,
        path,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        path: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (existingFolder) return existingFolder;

    const existingFile = await tx.cavCloudFile.findFirst({
      where: {
        accountId,
        path,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingFile) {
      throw new CavCloudError("PATH_CONFLICT_FILE", 409, `A file already exists at ${path}.`);
    }

    const createResult = await tx.cavCloudFolder.createMany({
      data: [
        {
          accountId,
          parentId: parent.id,
          name,
          path,
        },
      ],
      skipDuplicates: true,
    });

    let folder = await tx.cavCloudFolder.findFirst({
      where: {
        accountId,
        path,
      },
      select: {
        id: true,
        name: true,
        path: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
    if (!folder) {
      // Self-heal inconsistent rows where (accountId,parentId,name) exists at a stale path.
      const byParentAndName = await tx.cavCloudFolder.findFirst({
        where: {
          accountId,
          parentId: parent.id,
          name,
        },
        select: {
          id: true,
          name: true,
          path: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      });

      if (!byParentAndName) throw new CavCloudError("PATH_CONFLICT", 409, "path already exists");

      if (byParentAndName.path !== path) {
        const sourcePath = byParentAndName.path;
        const sourcePrefix = `${sourcePath}/`;

        const [destFolderConflicts, destFileConflicts] = await Promise.all([
          tx.cavCloudFolder.findMany({
            where: {
              accountId,
              OR: [{ path }, { path: scopePaths(path) }],
            },
            select: { id: true, path: true },
          }),
          tx.cavCloudFile.findMany({
            where: {
              accountId,
              OR: [{ path }, { path: scopePaths(path) }],
            },
            select: { id: true, path: true },
          }),
        ]);

        const hasConflict = [...destFolderConflicts, ...destFileConflicts].some((row) => (
          row.path !== sourcePath && !row.path.startsWith(sourcePrefix)
        ));
        if (hasConflict) throw new CavCloudError("PATH_CONFLICT", 409, "path already exists");

        const [descendantFolders, descendantFiles] = await Promise.all([
          tx.cavCloudFolder.findMany({
            where: {
              accountId,
              id: { not: byParentAndName.id },
              path: scopePaths(sourcePath),
            },
            select: {
              id: true,
              path: true,
            },
            orderBy: { path: "asc" },
          }),
          tx.cavCloudFile.findMany({
            where: {
              accountId,
              path: scopePaths(sourcePath),
            },
            select: {
              id: true,
              path: true,
            },
            orderBy: { path: "asc" },
          }),
        ]);

        folder = await tx.cavCloudFolder.update({
          where: { id: byParentAndName.id },
          data: {
            parentId: parent.id,
            name,
            path,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            path: true,
            parentId: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
          },
        });

        for (const child of descendantFolders) {
          const suffix = child.path.slice(sourcePath.length);
          await tx.cavCloudFolder.update({
            where: { id: child.id },
            data: { path: `${path}${suffix}` },
          });
        }

        for (const file of descendantFiles) {
          const suffix = file.path.slice(sourcePath.length);
          const nextFilePath = `${path}${suffix}`;
          await tx.cavCloudFile.update({
            where: { id: file.id },
            data: {
              path: nextFilePath,
              relPath: toRelPath(nextFilePath),
            },
          });
        }
      } else {
        folder = byParentAndName;
      }
    }

    // Keep the canonical path row active and aligned with requested parent/name.
    if (folder.deletedAt || folder.parentId !== parent.id || folder.name !== name) {
      folder = await tx.cavCloudFolder.update({
        where: { id: folder.id },
        data: {
          parentId: parent.id,
          name,
          path,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          path: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      });
      await tx.cavCloudTrash.deleteMany({
        where: {
          accountId,
          folderId: folder.id,
        },
      });
    }

    const createdNew = createResult.count > 0;

    if (createdNew) {
      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "folder.create",
        targetType: "folder",
        targetId: folder.id,
        targetPath: folder.path,
        metaJson: { parentId: parent.id },
      });
    }

      return {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        parentId: folder.parentId,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (err) {
    if (err instanceof CavCloudError) throw err;
    const code = String((err as { code?: unknown })?.code || "");
    if (code === "P2002") throw new CavCloudError("PATH_CONFLICT", 409, "path already exists");
    if (code === "P2034") throw new CavCloudError("TX_CONFLICT", 409, "Temporary folder write conflict. Please retry.");
    if (code === "P2028") throw new CavCloudError("TX_TIMEOUT", 503, "Folder create transaction timed out. Please retry.");
    throw err;
  }

  return mapFolder(created);
}

async function resolveFolderMovePlan(tx: DbClient, args: {
  accountId: string;
  folderId: string;
  nextName?: string;
  nextParentId?: string | null;
}) {
  const folder = await tx.cavCloudFolder.findFirst({
    where: {
      id: args.folderId,
      accountId: args.accountId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      path: true,
      parentId: true,
    },
  });

  if (!folder) throw new CavCloudError("FOLDER_NOT_FOUND", 404);
  if (folder.path === "/") throw new CavCloudError("ROOT_FOLDER_IMMUTABLE", 400);
  if (isOfficialSyncedSystemPath(folder.path)) {
    throw new CavCloudError("SYSTEM_FOLDER_IMMUTABLE", 400, "System synced folders are immutable.");
  }

  const nextName = args.nextName ? safeNodeName(args.nextName) : folder.name;
  const nextParentId = args.nextParentId === undefined ? folder.parentId : args.nextParentId;

  let parentPath = "/";
  let parentId: string | null = null;

  if (nextParentId) {
    const parent = await tx.cavCloudFolder.findFirst({
      where: {
        id: nextParentId,
        accountId: args.accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        path: true,
      },
    });
    if (!parent) throw new CavCloudError("PARENT_FOLDER_NOT_FOUND", 404);
    if (parent.id === folder.id) throw new CavCloudError("FOLDER_CYCLE", 409);
    if (parent.path === folder.path || parent.path.startsWith(`${folder.path}/`)) {
      throw new CavCloudError("FOLDER_CYCLE", 409);
    }
    parentPath = parent.path;
    parentId = parent.id;
  }

  const nextPath = joinPath(parentPath, nextName);

  return {
    folder,
    nextName,
    nextParentId: parentId,
    nextPath,
  };
}

export async function updateFolder(args: {
  accountId: string;
  operatorUserId?: string | null;
  folderId: string;
  name?: string;
  parentId?: string | null;
}) {
  const accountId = String(args.accountId || "").trim();
  const folderId = String(args.folderId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!folderId) throw new CavCloudError("FOLDER_ID_REQUIRED", 400);

  const updated = await prisma.$transaction(async (tx) => {
    const plan = await resolveFolderMovePlan(tx, {
      accountId,
      folderId,
      nextName: args.name,
      nextParentId: args.parentId,
    });

    if (plan.nextPath !== plan.folder.path) {
      await assertPathAvailable(accountId, plan.nextPath, tx, { folderId: plan.folder.id });

      // Prevent path collisions in descendants at destination prefix.
      const destFolderConflicts = await tx.cavCloudFolder.findMany({
        where: {
          accountId,
          deletedAt: null,
          OR: [{ path: plan.nextPath }, { path: scopePaths(plan.nextPath) }],
        },
        select: { path: true },
      });
      const destFileConflicts = await tx.cavCloudFile.findMany({
        where: {
          accountId,
          deletedAt: null,
          OR: [{ path: plan.nextPath }, { path: scopePaths(plan.nextPath) }],
        },
        select: { path: true },
      });

      const allowedPrefix = `${plan.folder.path}/`;
      const hasConflict = [...destFolderConflicts, ...destFileConflicts].some((row) => {
        const p = row.path;
        return p !== plan.folder.path && !p.startsWith(allowedPrefix);
      });
      if (hasConflict) throw new CavCloudError("PATH_CONFLICT", 409);
    }

    const descendantsFolders = await tx.cavCloudFolder.findMany({
      where: {
        accountId,
        deletedAt: null,
        path: scopePaths(plan.folder.path),
      },
      select: {
        id: true,
        path: true,
      },
      orderBy: { path: "asc" },
    });

    const descendantsFiles = await tx.cavCloudFile.findMany({
      where: {
        accountId,
        deletedAt: null,
        path: scopePaths(plan.folder.path),
      },
      select: {
        id: true,
        path: true,
      },
      orderBy: { path: "asc" },
    });

    const saved = await tx.cavCloudFolder.update({
      where: { id: plan.folder.id },
      data: {
        name: plan.nextName,
        parentId: plan.nextParentId,
        path: plan.nextPath,
      },
      select: {
        id: true,
        name: true,
        path: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (plan.nextPath !== plan.folder.path) {
      for (const child of descendantsFolders) {
        const suffix = child.path.slice(plan.folder.path.length);
        await tx.cavCloudFolder.update({
          where: { id: child.id },
          data: { path: `${plan.nextPath}${suffix}` },
        });
      }

      for (const file of descendantsFiles) {
        const suffix = file.path.slice(plan.folder.path.length);
        const nextFilePath = `${plan.nextPath}${suffix}`;
        await tx.cavCloudFile.update({
          where: { id: file.id },
          data: {
            path: nextFilePath,
            relPath: toRelPath(nextFilePath),
          },
        });
      }
    }

    await writeActivity(tx, {
      accountId,
      operatorUserId: args.operatorUserId,
      action: "folder.update",
      targetType: "folder",
      targetId: saved.id,
      targetPath: saved.path,
      metaJson: {
        fromPath: plan.folder.path,
        toPath: saved.path,
        fromParentId: plan.folder.parentId,
        toParentId: saved.parentId,
      },
    });

    return saved;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return mapFolder(updated);
}

export async function softDeleteFolder(args: {
  accountId: string;
  operatorUserId?: string | null;
  folderId: string;
}): Promise<{ removedFolders: number; removedFiles: number; targetPath: string }> {
  const accountId = String(args.accountId || "").trim();
  const folderId = String(args.folderId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!folderId) throw new CavCloudError("FOLDER_ID_REQUIRED", 400);
  const retentionDays = await resolveTrashRetentionDaysForOperator(accountId, args.operatorUserId);

  try {
    const deleted = await runSerializableTxWithRetry(() => prisma.$transaction(async (tx) => {
      const folder = await tx.cavCloudFolder.findFirst({
        where: {
          id: folderId,
          accountId,
          deletedAt: null,
        },
        select: {
          id: true,
          path: true,
          name: true,
        },
      });

      if (!folder) throw new CavCloudError("FOLDER_NOT_FOUND", 404);
      if (folder.path === "/") throw new CavCloudError("ROOT_FOLDER_IMMUTABLE", 400);
      if (isOfficialSyncedSystemPath(folder.path)) {
        throw new CavCloudError("SYSTEM_FOLDER_IMMUTABLE", 400, "System synced folders are immutable.");
      }

      const now = new Date();

      const folderScope: Prisma.CavCloudFolderWhereInput = {
        accountId,
        deletedAt: null,
        OR: [{ path: folder.path }, { path: scopePaths(folder.path) }],
      };

      const fileScope: Prisma.CavCloudFileWhereInput = {
        accountId,
        deletedAt: null,
        OR: [{ path: folder.path }, { path: scopePaths(folder.path) }],
      };

      const folderUpdate = await tx.cavCloudFolder.updateMany({
        where: folderScope,
        data: {
          deletedAt: now,
        },
      });

      const fileUpdate = await tx.cavCloudFile.updateMany({
        where: fileScope,
        data: {
          deletedAt: now,
        },
      });

      await tx.cavCloudTrash.create({
        data: {
          accountId,
          folderId: folder.id,
          deletedAt: now,
          purgeAfter: nowPlusDays(retentionDays),
        },
      });

      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });

      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "folder.delete",
        targetType: "folder",
        targetId: folder.id,
        targetPath: folder.path,
        metaJson: {
          softDeleted: true,
          usedBytes: usedBytes.toString(),
        },
      });
      return {
        removedFolders: Number(folderUpdate.count || 0),
        removedFiles: Number(fileUpdate.count || 0),
        targetPath: folder.path,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    return deleted;
  } catch (err) {
    if (isRetryableSerializableTxError(err)) {
      throw new CavCloudError("TX_CONFLICT", 409, "Temporary folder write conflict. Please retry.");
    }
    throw err;
  }
}

export async function createFileMetadata(args: {
  accountId: string;
  operatorUserId?: string | null;
  folderId?: string | null;
  folderPath?: string | null;
  name: string;
  mimeType?: string | null;
  bytes?: number | null;
  sha256?: string | null;
  r2Key?: string | null;
}) {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);

  const name = safeNodeName(args.name);
  const mimeType = preferredMimeType({
    providedMimeType: args.mimeType,
    fileName: name,
  }) || "application/octet-stream";
  const inputBytes = parsePositiveInt(args.bytes ?? 0) ?? 0;
  const bytes = BigInt(inputBytes);

  const sha256Raw = String(args.sha256 || "").trim().toLowerCase();
  const sha256 = /^[a-f0-9]{64}$/.test(sha256Raw) ? sha256Raw : bytes === BigInt(0) ? EMPTY_SHA256 : "";
  if (!sha256) throw new CavCloudError("SHA256_REQUIRED", 400, "sha256 must be a 64-char hex digest");

  const created = await prisma.$transaction(async (tx) => {
    const folder = await resolveFolderForWrite({
      accountId,
      folderId: args.folderId ?? null,
      folderPath: args.folderPath ?? null,
      tx,
    });

    const path = joinPath(folder.path, name);
    await assertPathAvailable(accountId, path, tx);

    const quota = await quotaSnapshot(accountId, tx);
    assertPerFileLimit(bytes, quota.perFileMaxBytes);
    assertQuotaLimit(quota.usedBytes, bytes, quota.limitBytes);

    const id = crypto.randomUUID();
    const r2Key = String(args.r2Key || "").trim() || workspaceR2ObjectKey(accountId, id, name, args.operatorUserId || null);

    const file = await tx.cavCloudFile.create({
      data: {
        id,
        accountId,
        folderId: folder.id,
        name,
        path,
        relPath: toRelPath(path),
        r2Key,
        bytes,
        mimeType,
        sha256,
      },
      select: {
        id: true,
        folderId: true,
        name: true,
        path: true,
        r2Key: true,
        bytes: true,
        mimeType: true,
        sha256: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const usedBytes = await refreshQuota(accountId, tx);
    await recordStorageHistoryPoint(tx, { accountId, usedBytes });
    await writeActivity(tx, {
      accountId,
      operatorUserId: args.operatorUserId,
      action: "file.metadata.create",
      targetType: "file",
      targetId: file.id,
      targetPath: file.path,
      metaJson: {
        bytes: file.bytes.toString(),
        mimeType,
        usedBytes: usedBytes.toString(),
      },
    });

    return file;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return mapFile(created);
}

export async function upsertTextFile(args: {
  accountId: string;
  operatorUserId?: string | null;
  folderPath?: string | null;
  name: string;
  mimeType?: string | null;
  content: string;
  source?: string | null;
}) {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);

  const source = String(args.source || "").trim() || null;
  const folderPath = normalizeSyncedFolderPathForSource(
    normalizePathNoTrailingSlash(String(args.folderPath || "/")),
    source,
  );
  if (isCavcodeSystemShadowPath(folderPath, source)) {
    throw new CavCloudError(
      "CAVCODE_SYSTEM_SYNC_BLOCKED",
      400,
      "The CavCode system folder is local-only and cannot sync to CavCloud.",
    );
  }
  const name = safeNodeName(args.name);
  const mimeType = String(args.mimeType || "").trim() || "text/plain; charset=utf-8";
  const content = String(args.content || "");
  const body = Buffer.from(content, "utf8");
  const previewUpdate = previewSnippetUpdateFromBytes(
    name,
    mimeType,
    body.subarray(0, PREVIEW_SNIPPET_RANGE_BYTES),
  );
  const bytes = BigInt(body.byteLength);
  const sha256 = crypto.createHash("sha256").update(body).digest("hex");

  let uploadedObjectKey = "";
  let createdNew = false;

  try {
    const saved = await prisma.$transaction(async (tx) => {
      await ensureOfficialSyncedFolders(accountId, tx);
      const folder = await ensureFolderPathForWrite(accountId, folderPath, tx);

      const path = joinPath(folder.path, name);
      const existing = await tx.cavCloudFile.findFirst({
        where: {
          accountId,
          path,
          deletedAt: null,
        },
        select: {
          id: true,
          folderId: true,
          name: true,
          path: true,
          r2Key: true,
          bytes: true,
        },
      });

      const quota = await quotaSnapshot(accountId, tx);
      assertPerFileLimit(bytes, quota.perFileMaxBytes);
      if (existing) {
        const delta = bytes - existing.bytes;
        if (delta > BigInt(0)) {
          assertQuotaLimit(quota.usedBytes, delta, quota.limitBytes);
        }
      } else {
        await assertPathAvailable(accountId, path, tx);
        assertQuotaLimit(quota.usedBytes, bytes, quota.limitBytes);
      }

      const fileId = existing?.id || crypto.randomUUID();
      const objectKey = existing?.r2Key || workspaceR2ObjectKey(accountId, fileId, name, args.operatorUserId || null);
      uploadedObjectKey = objectKey;
      createdNew = !existing;

      await putCavcloudObject({
        objectKey,
        body,
        contentType: mimeType,
        contentLength: body.byteLength,
      });

      const savedFile = existing
        ? await tx.cavCloudFile.update({
          where: { id: existing.id },
          data: {
            folderId: folder.id,
            name,
            path,
            relPath: toRelPath(path),
            r2Key: objectKey,
            bytes,
            mimeType,
            sha256,
            previewSnippet: previewUpdate.previewSnippet,
            previewSnippetUpdatedAt: previewUpdate.previewSnippetUpdatedAt,
          },
          select: {
            id: true,
            folderId: true,
            name: true,
            path: true,
            r2Key: true,
            bytes: true,
            mimeType: true,
            sha256: true,
            createdAt: true,
            updatedAt: true,
          },
        })
        : await tx.cavCloudFile.create({
          data: {
            id: fileId,
            accountId,
            folderId: folder.id,
            name,
            path,
            relPath: toRelPath(path),
            r2Key: objectKey,
            bytes,
            mimeType,
            sha256,
            previewSnippet: previewUpdate.previewSnippet,
            previewSnippetUpdatedAt: previewUpdate.previewSnippetUpdatedAt,
          },
          select: {
            id: true,
            folderId: true,
            name: true,
            path: true,
            r2Key: true,
            bytes: true,
            mimeType: true,
            sha256: true,
            createdAt: true,
            updatedAt: true,
          },
        });

      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });
      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "file.sync.upsert",
        targetType: "file",
        targetId: savedFile.id,
        targetPath: savedFile.path,
        metaJson: {
          source: source || "sync",
          created: !existing,
          bytes: savedFile.bytes.toString(),
          mimeType,
          usedBytes: usedBytes.toString(),
        },
      });

      return savedFile;
    }, SERIALIZABLE_INTERACTIVE_TX_OPTIONS);

    return mapFile(saved);
  } catch (err) {
    if (createdNew && uploadedObjectKey) {
      await deleteObjectKeysBestEffort([uploadedObjectKey]);
    }
    throw err;
  }
}

export async function replaceFileContent(args: {
  accountId: string;
  operatorUserId?: string | null;
  fileId: string;
  mimeType?: string | null;
  body: Uint8Array | Buffer;
  generateTextSnippets?: boolean;
  baseSha256?: string | null;
  restoredFromVersionId?: string | null;
}) {
  const accountId = String(args.accountId || "").trim();
  const operatorUserId = String(args.operatorUserId || "").trim();
  const fileId = String(args.fileId || "").trim();
  const baseSha256 = String(args.baseSha256 || "").trim().toLowerCase() || null;
  const restoredFromVersionId = String(args.restoredFromVersionId || "").trim() || null;
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!fileId) throw new CavCloudError("FILE_ID_REQUIRED", 400);
  if (!operatorUserId) throw new CavCloudError("OPERATOR_USER_REQUIRED", 400);
  if (baseSha256 && !/^[a-f0-9]{64}$/.test(baseSha256)) {
    throw new CavCloudError("BASE_SHA256_INVALID", 400, "baseSha256 must be a 64-char hex digest");
  }

  const body = Buffer.isBuffer(args.body) ? args.body : Buffer.from(args.body);
  const inputMimeType = String(args.mimeType || "").trim();
  const generateTextSnippets = args.generateTextSnippets !== false;
  const bytes = BigInt(body.byteLength);
  const sha256 = crypto.createHash("sha256").update(body).digest("hex");
  let uploadedKey: string | null = null;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const file = await tx.cavCloudFile.findFirst({
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
          bytes: true,
          sha256: true,
          mimeType: true,
        },
      });
      if (!file) throw new CavCloudError("FILE_NOT_FOUND", 404);

      const latestVersion = await tx.cavCloudFileVersion.findFirst({
        where: {
          accountId,
          fileId: file.id,
        },
        orderBy: {
          versionNumber: "desc",
        },
        select: {
          versionNumber: true,
        },
      });
      const latestVersionNumber = Number(latestVersion?.versionNumber || 0);

      if (baseSha256 && baseSha256 !== String(file.sha256 || "").toLowerCase()) {
        const conflict = new CavCloudError("FILE_EDIT_CONFLICT", 409, "File changed since your last read.");
        (conflict as CavCloudError & { latestSha256?: string; latestVersionNumber?: number }).latestSha256 = file.sha256;
        (conflict as CavCloudError & { latestSha256?: string; latestVersionNumber?: number }).latestVersionNumber =
          latestVersionNumber > 0 ? latestVersionNumber : 1;
        throw conflict;
      }

      const mimeType = preferredMimeType({
        providedMimeType: inputMimeType,
        fileName: file.name,
      }) || "application/octet-stream";

      const previewUpdate = generateTextSnippets
        ? previewSnippetUpdateFromBytes(
            file.name,
            mimeType,
            body.subarray(0, PREVIEW_SNIPPET_RANGE_BYTES),
          )
        : {
            previewSnippet: null,
            previewSnippetUpdatedAt: new Date(),
          };

      if (latestVersionNumber <= 0) {
        await tx.cavCloudFileVersion.create({
          data: {
            accountId,
            fileId: file.id,
            versionNumber: 1,
            sha256: file.sha256,
            r2Key: file.r2Key,
            bytes: file.bytes,
            createdByUserId: operatorUserId,
          },
        });
      }

      const unchanged = file.sha256 === sha256 && file.bytes === bytes && String(file.mimeType || "") === mimeType;
      const effectiveCurrentVersion = latestVersionNumber > 0 ? latestVersionNumber : 1;

      if (unchanged) {
        const current = await tx.cavCloudFile.findUnique({
          where: { id: file.id },
          select: {
            id: true,
            folderId: true,
            name: true,
            path: true,
            r2Key: true,
            bytes: true,
            mimeType: true,
            sha256: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        if (!current) throw new CavCloudError("FILE_NOT_FOUND", 404);
        return {
          savedFile: current,
          versionNumber: effectiveCurrentVersion,
          changed: false as const,
          sha256: current.sha256,
        };
      }

      const quota = await quotaSnapshot(accountId, tx);
      assertPerFileLimit(bytes, quota.perFileMaxBytes);
      const delta = bytes - file.bytes;
      if (delta > BigInt(0)) {
        assertQuotaLimit(quota.usedBytes, delta, quota.limitBytes);
      }

      const nextKey = workspaceR2VersionObjectKey(accountId, file.id, file.name, operatorUserId);
      uploadedKey = nextKey;

      await putCavcloudObject({
        objectKey: nextKey,
        body,
        contentType: mimeType,
        contentLength: body.byteLength,
      });

      const nextVersionNumber = effectiveCurrentVersion + 1;

      const savedFile = await tx.cavCloudFile.update({
        where: { id: file.id },
        data: {
          r2Key: nextKey,
          bytes,
          mimeType,
          sha256,
          previewSnippet: previewUpdate.previewSnippet,
          previewSnippetUpdatedAt: previewUpdate.previewSnippetUpdatedAt,
        },
        select: {
          id: true,
          folderId: true,
          name: true,
          path: true,
          r2Key: true,
          bytes: true,
          mimeType: true,
          sha256: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.cavCloudFileVersion.create({
        data: {
          accountId,
          fileId: file.id,
          versionNumber: nextVersionNumber,
          sha256,
          r2Key: nextKey,
          bytes,
          createdByUserId: operatorUserId,
          restoredFromVersionId,
        },
      });

      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });
      await writeActivity(tx, {
        accountId,
        operatorUserId,
        action: "file.update",
        targetType: "file",
        targetId: savedFile.id,
        targetPath: savedFile.path,
        metaJson: {
          edited: true,
          bytes: savedFile.bytes.toString(),
          mimeType,
          usedBytes: usedBytes.toString(),
          versionNumber: nextVersionNumber,
        },
      });

      return {
        savedFile,
        versionNumber: nextVersionNumber,
        changed: true as const,
        sha256,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      ...mapFile(updated.savedFile),
      versionNumber: updated.versionNumber,
      changed: updated.changed,
      sha256: updated.sha256,
    };
  } catch (err) {
    if (uploadedKey) {
      await deleteObjectKeysBestEffort([uploadedKey]);
    }
    throw err;
  }
}

function buildFileEditConflictError(args: { latestSha256: string; latestVersionNumber: number }): CavCloudError {
  const err = new CavCloudError("FILE_EDIT_CONFLICT", 409, "File changed since your last read.");
  (err as CavCloudError & { latestSha256?: string; latestVersionNumber?: number }).latestSha256 = args.latestSha256;
  (err as CavCloudError & { latestSha256?: string; latestVersionNumber?: number }).latestVersionNumber =
    args.latestVersionNumber;
  return err;
}

export async function listFileVersions(args: {
  accountId: string;
  fileId: string;
  limit?: number;
  offset?: number;
}): Promise<CavCloudFileVersionItem[]> {
  const accountId = String(args.accountId || "").trim();
  const fileId = String(args.fileId || "").trim();
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(args.limit || 50)) || 50));
  const offset = Math.max(0, Math.trunc(Number(args.offset || 0)) || 0);

  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!fileId) throw new CavCloudError("FILE_ID_REQUIRED", 400);

  const file = await prisma.cavCloudFile.findFirst({
    where: {
      id: fileId,
      accountId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!file?.id) throw new CavCloudError("FILE_NOT_FOUND", 404);

  const versions = await prisma.cavCloudFileVersion.findMany({
    where: {
      accountId,
      fileId,
    },
    orderBy: [
      { versionNumber: "desc" },
      { createdAt: "desc" },
    ],
    skip: offset,
    take: limit,
    select: {
      id: true,
      fileId: true,
      versionNumber: true,
      sha256: true,
      r2Key: true,
      bytes: true,
      createdByUserId: true,
      restoredFromVersionId: true,
      createdAt: true,
    },
  });

  return versions.map((version) => ({
    id: version.id,
    fileId: version.fileId,
    versionNumber: Number(version.versionNumber),
    sha256: version.sha256,
    r2Key: version.r2Key,
    bytes: toSafeNumber(version.bytes),
    bytesExact: version.bytes.toString(),
    createdByUserId: version.createdByUserId,
    restoredFromVersionId: version.restoredFromVersionId || null,
    createdAtISO: toISO(version.createdAt),
  }));
}

export async function restoreFileVersion(args: {
  accountId: string;
  operatorUserId?: string | null;
  fileId: string;
  versionId: string;
  baseSha256?: string | null;
}) {
  const accountId = String(args.accountId || "").trim();
  const operatorUserId = String(args.operatorUserId || "").trim();
  const fileId = String(args.fileId || "").trim();
  const versionId = String(args.versionId || "").trim();
  const baseSha256 = String(args.baseSha256 || "").trim().toLowerCase() || null;

  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!operatorUserId) throw new CavCloudError("OPERATOR_USER_REQUIRED", 400);
  if (!fileId) throw new CavCloudError("FILE_ID_REQUIRED", 400);
  if (!versionId) throw new CavCloudError("VERSION_ID_REQUIRED", 400);
  if (baseSha256 && !/^[a-f0-9]{64}$/.test(baseSha256)) {
    throw new CavCloudError("BASE_SHA256_INVALID", 400, "baseSha256 must be a 64-char hex digest");
  }

  const [fileRow, versionRow] = await Promise.all([
    prisma.cavCloudFile.findFirst({
      where: {
        id: fileId,
        accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        path: true,
        bytes: true,
        sha256: true,
        mimeType: true,
      },
    }),
    prisma.cavCloudFileVersion.findFirst({
      where: {
        id: versionId,
        accountId,
        fileId,
      },
      select: {
        id: true,
        fileId: true,
        r2Key: true,
        sha256: true,
        bytes: true,
      },
    }),
  ]);

  if (!fileRow) throw new CavCloudError("FILE_NOT_FOUND", 404);
  if (!versionRow) throw new CavCloudError("VERSION_NOT_FOUND", 404);

  const restoreKey = workspaceR2VersionObjectKey(accountId, fileRow.id, fileRow.name, operatorUserId);
  let copied = false;

  try {
    await copyObjectToKey({
      sourceKey: versionRow.r2Key,
      destinationKey: restoreKey,
      contentType: fileRow.mimeType,
      contentLength: versionRow.bytes,
    });
    copied = true;

    let previewSnippet: string | null = null;
    try {
      previewSnippet = await computePreviewSnippetFromObject(restoreKey, fileRow.name, fileRow.mimeType);
    } catch {
      previewSnippet = null;
    }
    const previewSnippetUpdatedAt = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const currentFile = await tx.cavCloudFile.findFirst({
        where: {
          id: fileId,
          accountId,
          deletedAt: null,
        },
        select: {
          id: true,
          folderId: true,
          name: true,
          path: true,
          r2Key: true,
          bytes: true,
          sha256: true,
          mimeType: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!currentFile) throw new CavCloudError("FILE_NOT_FOUND", 404);

      const targetVersion = await tx.cavCloudFileVersion.findFirst({
        where: {
          id: versionId,
          accountId,
          fileId: currentFile.id,
        },
        select: {
          id: true,
          sha256: true,
          bytes: true,
        },
      });
      if (!targetVersion) throw new CavCloudError("VERSION_NOT_FOUND", 404);

      const latestVersion = await tx.cavCloudFileVersion.findFirst({
        where: {
          accountId,
          fileId: currentFile.id,
        },
        orderBy: {
          versionNumber: "desc",
        },
        select: {
          versionNumber: true,
        },
      });

      const latestVersionNumber = Number(latestVersion?.versionNumber || 0);
      if (baseSha256 && baseSha256 !== String(currentFile.sha256 || "").toLowerCase()) {
        throw buildFileEditConflictError({
          latestSha256: currentFile.sha256,
          latestVersionNumber: latestVersionNumber > 0 ? latestVersionNumber : 1,
        });
      }

      let versionCursor = latestVersionNumber;
      if (versionCursor <= 0) {
        await tx.cavCloudFileVersion.create({
          data: {
            accountId,
            fileId: currentFile.id,
            versionNumber: 1,
            sha256: currentFile.sha256,
            r2Key: currentFile.r2Key,
            bytes: currentFile.bytes,
            createdByUserId: operatorUserId,
          },
        });
        versionCursor = 1;
      }

      const quota = await quotaSnapshot(accountId, tx);
      assertPerFileLimit(targetVersion.bytes, quota.perFileMaxBytes);
      const delta = targetVersion.bytes - currentFile.bytes;
      if (delta > BigInt(0)) {
        assertQuotaLimit(quota.usedBytes, delta, quota.limitBytes);
      }

      const nextVersionNumber = versionCursor + 1;

      const savedFile = await tx.cavCloudFile.update({
        where: { id: currentFile.id },
        data: {
          r2Key: restoreKey,
          bytes: targetVersion.bytes,
          sha256: targetVersion.sha256,
          previewSnippet,
          previewSnippetUpdatedAt,
        },
        select: {
          id: true,
          folderId: true,
          name: true,
          path: true,
          r2Key: true,
          bytes: true,
          mimeType: true,
          sha256: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.cavCloudFileVersion.create({
        data: {
          accountId,
          fileId: currentFile.id,
          versionNumber: nextVersionNumber,
          sha256: targetVersion.sha256,
          r2Key: restoreKey,
          bytes: targetVersion.bytes,
          createdByUserId: operatorUserId,
          restoredFromVersionId: targetVersion.id,
        },
      });

      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });
      await writeActivity(tx, {
        accountId,
        operatorUserId,
        action: "file.update",
        targetType: "file",
        targetId: savedFile.id,
        targetPath: savedFile.path,
        metaJson: {
          restoredFromVersionId: targetVersion.id,
          versionNumber: nextVersionNumber,
          usedBytes: usedBytes.toString(),
        },
      });

      return {
        savedFile,
        versionNumber: nextVersionNumber,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      ...mapFile(updated.savedFile),
      versionNumber: updated.versionNumber,
      restoredFromVersionId: versionId,
    };
  } catch (err) {
    if (copied) {
      await deleteObjectKeysBestEffort([restoreKey]);
    }
    throw err;
  }
}

export async function updateFile(args: {
  accountId: string;
  operatorUserId?: string | null;
  fileId: string;
  name?: string;
  folderId?: string | null;
  mimeType?: string | null;
}) {
  const accountId = String(args.accountId || "").trim();
  const fileId = String(args.fileId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!fileId) throw new CavCloudError("FILE_ID_REQUIRED", 400);

  const updated = await prisma.$transaction(async (tx) => {
    const file = await tx.cavCloudFile.findFirst({
      where: {
        id: fileId,
        accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        folderId: true,
        name: true,
        path: true,
      },
    });

    if (!file) throw new CavCloudError("FILE_NOT_FOUND", 404);

    let targetFolder = await tx.cavCloudFolder.findFirst({
      where: {
        id: file.folderId,
        accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        path: true,
      },
    });
    if (!targetFolder) throw new CavCloudError("FOLDER_NOT_FOUND", 404);

    if (args.folderId !== undefined) {
      const folderId = String(args.folderId || "").trim();
      if (!folderId) throw new CavCloudError("FOLDER_ID_REQUIRED", 400);
      const nextFolder = await tx.cavCloudFolder.findFirst({
        where: {
          id: folderId,
          accountId,
          deletedAt: null,
        },
        select: {
          id: true,
          path: true,
        },
      });
      if (!nextFolder) throw new CavCloudError("FOLDER_NOT_FOUND", 404);
      targetFolder = nextFolder;
    }

    const nextName = args.name ? safeNodeName(args.name) : file.name;
    const nextPath = joinPath(targetFolder.path, nextName);
    await assertPathAvailable(accountId, nextPath, tx, { fileId: file.id });

    const updatedFile = await tx.cavCloudFile.update({
      where: { id: file.id },
      data: {
        name: nextName,
        folderId: targetFolder.id,
        path: nextPath,
        relPath: toRelPath(nextPath),
        ...(args.mimeType ? { mimeType: String(args.mimeType || "").trim() || "application/octet-stream" } : {}),
      },
      select: {
        id: true,
        folderId: true,
        name: true,
        path: true,
        r2Key: true,
        bytes: true,
        mimeType: true,
        sha256: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await writeActivity(tx, {
      accountId,
      operatorUserId: args.operatorUserId,
      action: "file.update",
      targetType: "file",
      targetId: file.id,
      targetPath: updatedFile.path,
      metaJson: {
        fromPath: file.path,
        toPath: updatedFile.path,
      },
    });

    return updatedFile;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return mapFile(updated);
}

export async function duplicateFile(args: {
  accountId: string;
  operatorUserId?: string | null;
  fileId: string;
}) {
  const accountId = String(args.accountId || "").trim();
  const fileId = String(args.fileId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!fileId) throw new CavCloudError("FILE_ID_REQUIRED", 400);

  const plan = await prisma.$transaction(async (tx) => {
    const source = await tx.cavCloudFile.findFirst({
      where: {
        id: fileId,
        accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        folderId: true,
        name: true,
        path: true,
        r2Key: true,
        bytes: true,
        mimeType: true,
        sha256: true,
        previewSnippet: true,
        previewSnippetUpdatedAt: true,
      },
    });
    if (!source) throw new CavCloudError("FILE_NOT_FOUND", 404);

    const folder = await tx.cavCloudFolder.findFirst({
      where: {
        id: source.folderId,
        accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        path: true,
      },
    });
    if (!folder) throw new CavCloudError("FOLDER_NOT_FOUND", 404);

    const quota = await quotaSnapshot(accountId, tx);
    assertPerFileLimit(source.bytes, quota.perFileMaxBytes);
    assertQuotaLimit(quota.usedBytes, source.bytes, quota.limitBytes);

    const preferredName = duplicateFileName(source.name, 1);
    const next = await resolveAvailableFileName({
      tx,
      accountId,
      folderPath: folder.path,
      preferredName,
    });

    const duplicateId = crypto.randomUUID();
    const duplicateKey = workspaceR2ObjectKey(accountId, duplicateId, next.name, args.operatorUserId || null);

    return {
      source,
      folder,
      duplicateId,
      duplicateKey,
      duplicateName: next.name,
      duplicatePath: next.path,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await copyObjectToKey({
    sourceKey: plan.source.r2Key,
    destinationKey: plan.duplicateKey,
    contentType: plan.source.mimeType,
    contentLength: plan.source.bytes,
  });

  try {
    const created = await prisma.$transaction(async (tx) => {
      await assertPathAvailable(accountId, plan.duplicatePath, tx);
      const quota = await quotaSnapshot(accountId, tx);
      assertPerFileLimit(plan.source.bytes, quota.perFileMaxBytes);
      assertQuotaLimit(quota.usedBytes, plan.source.bytes, quota.limitBytes);

      const file = await tx.cavCloudFile.create({
        data: {
          id: plan.duplicateId,
          accountId,
          folderId: plan.folder.id,
          name: plan.duplicateName,
          path: plan.duplicatePath,
          relPath: toRelPath(plan.duplicatePath),
          r2Key: plan.duplicateKey,
          bytes: plan.source.bytes,
          mimeType: plan.source.mimeType,
          sha256: plan.source.sha256,
          previewSnippet: normalizePreviewSnippetText(plan.source.previewSnippet || null, PREVIEW_SNIPPET_MAX_CHARS),
          previewSnippetUpdatedAt: plan.source.previewSnippetUpdatedAt || new Date(),
        },
        select: {
          id: true,
          folderId: true,
          name: true,
          path: true,
          r2Key: true,
          bytes: true,
          mimeType: true,
          sha256: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });
      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "file.duplicate",
        targetType: "file",
        targetId: file.id,
        targetPath: file.path,
        metaJson: {
          sourceFileId: plan.source.id,
          sourcePath: plan.source.path,
          bytes: file.bytes.toString(),
          usedBytes: usedBytes.toString(),
        },
      });

      return file;
    }, SERIALIZABLE_INTERACTIVE_TX_OPTIONS);

    return mapFile(created);
  } catch (err) {
    await deleteObjectKeysBestEffort([plan.duplicateKey]);
    throw err;
  }
}

export async function zipFile(args: {
  accountId: string;
  operatorUserId?: string | null;
  fileId: string;
}) {
  const accountId = String(args.accountId || "").trim();
  const fileId = String(args.fileId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!fileId) throw new CavCloudError("FILE_ID_REQUIRED", 400);

  const source = await prisma.cavCloudFile.findFirst({
    where: {
      id: fileId,
      accountId,
      deletedAt: null,
    },
    select: {
      id: true,
      folderId: true,
      name: true,
      path: true,
      r2Key: true,
      bytes: true,
      updatedAt: true,
    },
  });
  if (!source) throw new CavCloudError("FILE_NOT_FOUND", 404);

  const folder = await prisma.cavCloudFolder.findFirst({
    where: {
      id: source.folderId,
      accountId,
      deletedAt: null,
    },
    select: {
      id: true,
      path: true,
    },
  });
  if (!folder) throw new CavCloudError("FOLDER_NOT_FOUND", 404);

  const sourceBuffer = await readObjectBuffer(source.r2Key, archiveSourceMaxBytes());
  const zippedBuffer = buildZipBuffer([
    {
      path: source.name,
      data: sourceBuffer,
      modifiedAt: source.updatedAt,
    },
  ]);
  const zippedBytes = BigInt(zippedBuffer.byteLength);
  const sha256 = crypto.createHash("sha256").update(zippedBuffer).digest("hex");

  const plan = await prisma.$transaction(async (tx) => {
    const quota = await quotaSnapshot(accountId, tx);
    assertPerFileLimit(zippedBytes, quota.perFileMaxBytes);
    assertQuotaLimit(quota.usedBytes, zippedBytes, quota.limitBytes);

    const next = await resolveAvailableFileName({
      tx,
      accountId,
      folderPath: folder.path,
      preferredName: zippedOutputName(source.name),
    });

    const zippedId = crypto.randomUUID();
    const zippedKey = workspaceR2ObjectKey(accountId, zippedId, next.name, args.operatorUserId || null);
    return {
      zippedId,
      zippedKey,
      zippedName: next.name,
      zippedPath: next.path,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await putCavcloudObject({
    objectKey: plan.zippedKey,
    body: zippedBuffer,
    contentType: "application/zip",
    contentLength: zippedBuffer.byteLength,
  });

  try {
    const created = await prisma.$transaction(async (tx) => {
      await assertPathAvailable(accountId, plan.zippedPath, tx);
      const quota = await quotaSnapshot(accountId, tx);
      assertPerFileLimit(zippedBytes, quota.perFileMaxBytes);
      assertQuotaLimit(quota.usedBytes, zippedBytes, quota.limitBytes);

      const file = await tx.cavCloudFile.create({
        data: {
          id: plan.zippedId,
          accountId,
          folderId: folder.id,
          name: plan.zippedName,
          path: plan.zippedPath,
          relPath: toRelPath(plan.zippedPath),
          r2Key: plan.zippedKey,
          bytes: zippedBytes,
          mimeType: "application/zip",
          sha256,
        },
        select: {
          id: true,
          folderId: true,
          name: true,
          path: true,
          r2Key: true,
          bytes: true,
          mimeType: true,
          sha256: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });
      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "file.zip",
        targetType: "file",
        targetId: file.id,
        targetPath: file.path,
        metaJson: {
          sourceFileId: source.id,
          sourcePath: source.path,
          bytes: file.bytes.toString(),
          usedBytes: usedBytes.toString(),
        },
      });

      return file;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return mapFile(created);
  } catch (err) {
    await deleteObjectKeysBestEffort([plan.zippedKey]);
    throw err;
  }
}

export async function zipFolder(args: {
  accountId: string;
  operatorUserId?: string | null;
  folderId: string;
}) {
  const accountId = String(args.accountId || "").trim();
  const folderId = String(args.folderId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!folderId) throw new CavCloudError("FOLDER_ID_REQUIRED", 400);

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
      parentId: true,
    },
  });
  if (!folder) throw new CavCloudError("FOLDER_NOT_FOUND", 404);

  const parent = folder.parentId
    ? await prisma.cavCloudFolder.findFirst({
      where: {
        id: folder.parentId,
        accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        path: true,
      },
    })
    : await ensureRootFolder(accountId);
  if (!parent) throw new CavCloudError("FOLDER_NOT_FOUND", 404);

  const files = await prisma.cavCloudFile.findMany({
    where: {
      accountId,
      deletedAt: null,
      path: scopePaths(folder.path),
    },
    orderBy: [{ path: "asc" }],
    select: {
      id: true,
      name: true,
      path: true,
      r2Key: true,
      bytes: true,
      updatedAt: true,
    },
  });

  const totalSourceBytes = files.reduce((sum, file) => sum + file.bytes, BigInt(0));
  const maxArchiveSource = archiveSourceMaxBytes();
  if (totalSourceBytes > maxArchiveSource) {
    throw new CavCloudError("ZIP_SOURCE_TOO_LARGE", 413, "folder archive exceeds configured size limit");
  }

  const zipEntries: Array<{ path: string; data: Buffer; modifiedAt?: Date }> = [];
  for (const file of files) {
    const relativePath = entryPathFromDescendantPath(folder.path, file.path, file.name);
    const fileBuffer = await readObjectBuffer(file.r2Key, maxArchiveSource);
    zipEntries.push({
      path: relativePath,
      data: fileBuffer,
      modifiedAt: file.updatedAt,
    });
  }

  const zippedBuffer = buildZipBuffer(zipEntries);
  const zippedBytes = BigInt(zippedBuffer.byteLength);
  const sha256 = crypto.createHash("sha256").update(zippedBuffer).digest("hex");
  const baseName = folder.path === "/" ? "cavcloud-root" : folder.name;

  const plan = await prisma.$transaction(async (tx) => {
    const quota = await quotaSnapshot(accountId, tx);
    assertPerFileLimit(zippedBytes, quota.perFileMaxBytes);
    assertQuotaLimit(quota.usedBytes, zippedBytes, quota.limitBytes);

    const next = await resolveAvailableFileName({
      tx,
      accountId,
      folderPath: parent.path,
      preferredName: zippedOutputName(baseName),
    });

    const zippedId = crypto.randomUUID();
    const zippedKey = workspaceR2ObjectKey(accountId, zippedId, next.name, args.operatorUserId || null);
    return {
      zippedId,
      zippedKey,
      zippedName: next.name,
      zippedPath: next.path,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await putCavcloudObject({
    objectKey: plan.zippedKey,
    body: zippedBuffer,
    contentType: "application/zip",
    contentLength: zippedBuffer.byteLength,
  });

  try {
    const created = await prisma.$transaction(async (tx) => {
      await assertPathAvailable(accountId, plan.zippedPath, tx);
      const quota = await quotaSnapshot(accountId, tx);
      assertPerFileLimit(zippedBytes, quota.perFileMaxBytes);
      assertQuotaLimit(quota.usedBytes, zippedBytes, quota.limitBytes);

      const file = await tx.cavCloudFile.create({
        data: {
          id: plan.zippedId,
          accountId,
          folderId: parent.id,
          name: plan.zippedName,
          path: plan.zippedPath,
          relPath: toRelPath(plan.zippedPath),
          r2Key: plan.zippedKey,
          bytes: zippedBytes,
          mimeType: "application/zip",
          sha256,
        },
        select: {
          id: true,
          folderId: true,
          name: true,
          path: true,
          r2Key: true,
          bytes: true,
          mimeType: true,
          sha256: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });
      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "folder.zip",
        targetType: "folder",
        targetId: folder.id,
        targetPath: folder.path,
        metaJson: {
          archiveFileId: file.id,
          archivePath: file.path,
          fileCount: files.length,
          sourceBytes: totalSourceBytes.toString(),
          archiveBytes: file.bytes.toString(),
          usedBytes: usedBytes.toString(),
        },
      });

      return file;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return mapFile(created);
  } catch (err) {
    await deleteObjectKeysBestEffort([plan.zippedKey]);
    throw err;
  }
}

export async function softDeleteFile(args: {
  accountId: string;
  operatorUserId?: string | null;
  fileId: string;
}) {
  const accountId = String(args.accountId || "").trim();
  const fileId = String(args.fileId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!fileId) throw new CavCloudError("FILE_ID_REQUIRED", 400);
  const retentionDays = await resolveTrashRetentionDaysForOperator(accountId, args.operatorUserId);

  try {
    await runSerializableTxWithRetry(() => prisma.$transaction(async (tx) => {
      const file = await tx.cavCloudFile.findFirst({
        where: {
          id: fileId,
          accountId,
          deletedAt: null,
        },
        select: {
          id: true,
          path: true,
        },
      });

      if (!file) throw new CavCloudError("FILE_NOT_FOUND", 404);

      const now = new Date();

      await tx.cavCloudFile.update({
        where: { id: file.id },
        data: {
          deletedAt: now,
        },
      });

      await tx.cavCloudTrash.create({
        data: {
          accountId,
          fileId: file.id,
          deletedAt: now,
          purgeAfter: nowPlusDays(retentionDays),
        },
      });

      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });

      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "file.delete",
        targetType: "file",
        targetId: file.id,
        targetPath: file.path,
        metaJson: {
          softDeleted: true,
          usedBytes: usedBytes.toString(),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (err) {
    if (isRetryableSerializableTxError(err)) {
      throw new CavCloudError("TX_CONFLICT", 409, "Temporary file write conflict. Please retry.");
    }
    throw err;
  }
}

export async function restoreTrashEntry(args: {
  accountId: string;
  operatorUserId?: string | null;
  trashId: string;
}) {
  const accountId = String(args.accountId || "").trim();
  const trashId = String(args.trashId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!trashId) throw new CavCloudError("TRASH_ID_REQUIRED", 400);

  const restored = await prisma.$transaction(async (tx) => {
    const trash = await tx.cavCloudTrash.findFirst({
      where: {
        id: trashId,
        accountId,
      },
      select: {
        id: true,
        fileId: true,
        folderId: true,
      },
    });

    if (!trash) throw new CavCloudError("TRASH_NOT_FOUND", 404);

    if (trash.fileId) {
      const file = await tx.cavCloudFile.findFirst({
        where: {
          id: trash.fileId,
          accountId,
        },
        select: {
          id: true,
          path: true,
          deletedAt: true,
        },
      });
      if (!file) {
        await tx.cavCloudTrash.delete({ where: { id: trash.id } });
        return { kind: "file" as const, restoredId: null };
      }

      if (file.deletedAt) {
        await assertPathAvailable(accountId, file.path, tx, { fileId: file.id });
        await tx.cavCloudFile.update({ where: { id: file.id }, data: { deletedAt: null } });
      }

      await tx.cavCloudTrash.delete({ where: { id: trash.id } });
      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });

      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "trash.restore",
        targetType: "file",
        targetId: file.id,
        targetPath: file.path,
        metaJson: { usedBytes: usedBytes.toString() },
      });

      return { kind: "file" as const, restoredId: file.id };
    }

    if (trash.folderId) {
      const folder = await tx.cavCloudFolder.findFirst({
        where: {
          id: trash.folderId,
          accountId,
        },
        select: {
          id: true,
          path: true,
          deletedAt: true,
        },
      });

      if (!folder) {
        await tx.cavCloudTrash.delete({ where: { id: trash.id } });
        return { kind: "folder" as const, restoredId: null };
      }

      if (folder.deletedAt) {
        await assertPathAvailable(accountId, folder.path, tx, { folderId: folder.id });

        await tx.cavCloudFolder.updateMany({
          where: {
            accountId,
            OR: [{ path: folder.path }, { path: scopePaths(folder.path) }],
          },
          data: {
            deletedAt: null,
          },
        });

        await tx.cavCloudFile.updateMany({
          where: {
            accountId,
            OR: [{ path: folder.path }, { path: scopePaths(folder.path) }],
          },
          data: {
            deletedAt: null,
          },
        });
      }

      await tx.cavCloudTrash.delete({ where: { id: trash.id } });
      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });

      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "trash.restore",
        targetType: "folder",
        targetId: folder.id,
        targetPath: folder.path,
        metaJson: { usedBytes: usedBytes.toString() },
      });

      return { kind: "folder" as const, restoredId: folder.id };
    }

    await tx.cavCloudTrash.delete({ where: { id: trash.id } });
    return { kind: "unknown" as const, restoredId: null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return restored;
}

async function deleteObjectKeysBestEffort(keys: string[]) {
  for (const key of keys) {
    try {
      await deleteCavcloudObject(key);
    } catch {
      // Keep deleting remaining keys, then rely on DB consistency on next retries.
    }
  }
}

async function deleteObjectKeysStrict(keys: string[]) {
  for (const key of keys) {
    try {
      await deleteCavcloudObject(key);
    } catch {
      throw new CavCloudError("R2_DELETE_FAILED", 502, "Failed to delete one or more objects from storage");
    }
  }
}

export async function permanentlyDeleteTrashEntry(args: {
  accountId: string;
  trashId: string;
  operatorUserId?: string | null;
  reason?: string;
}): Promise<{ ok: true; removedFiles: number; removedFolders: number; reason: string }> {
  const accountId = String(args.accountId || "").trim();
  const trashId = String(args.trashId || "").trim();
  const reason = String(args.reason || "manual").trim() || "manual";
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!trashId) throw new CavCloudError("TRASH_ID_REQUIRED", 400);

  const trash = await prisma.cavCloudTrash.findFirst({
    where: {
      id: trashId,
      accountId,
    },
    select: {
      id: true,
      fileId: true,
      folderId: true,
    },
  });
  if (!trash) throw new CavCloudError("TRASH_NOT_FOUND", 404);

  if (trash.fileId) {
    const file = await prisma.cavCloudFile.findFirst({
      where: {
        id: trash.fileId,
        accountId,
      },
      select: {
        id: true,
        path: true,
        r2Key: true,
      },
    });

    if (file?.r2Key) {
      await deleteObjectKeysStrict([file.r2Key]);
    }

    await prisma.$transaction(async (tx) => {
      await tx.cavCloudTrash.deleteMany({ where: { accountId, fileId: trash.fileId } });
      if (file) await tx.cavCloudFile.delete({ where: { id: file.id } });
      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });
      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "trash.permanent_delete",
        targetType: "file",
        targetId: file?.id || trash.fileId,
        targetPath: file?.path || null,
        metaJson: { reason, usedBytes: usedBytes.toString() },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { ok: true, removedFiles: 1, removedFolders: 0, reason };
  }

  if (trash.folderId) {
    const folder = await prisma.cavCloudFolder.findFirst({
      where: {
        id: trash.folderId,
        accountId,
      },
      select: {
        id: true,
        path: true,
      },
    });

    if (!folder) {
      await prisma.cavCloudTrash.delete({ where: { id: trash.id } });
      return { ok: true, removedFiles: 0, removedFolders: 0, reason };
    }
    if (isOfficialSyncedSystemPath(folder.path)) {
      throw new CavCloudError("SYSTEM_FOLDER_IMMUTABLE", 400, "System synced folders are immutable.");
    }

    const folderScope: Prisma.CavCloudFolderWhereInput = {
      accountId,
      OR: [{ path: folder.path }, { path: scopePaths(folder.path) }],
    };

    const fileScope: Prisma.CavCloudFileWhereInput = {
      accountId,
      OR: [{ path: folder.path }, { path: scopePaths(folder.path) }],
    };

    const [folderRows, fileRows] = await Promise.all([
      prisma.cavCloudFolder.findMany({ where: folderScope, select: { id: true, path: true } }),
      prisma.cavCloudFile.findMany({ where: fileScope, select: { id: true, path: true, r2Key: true } }),
    ]);

    await deleteObjectKeysStrict(fileRows.map((f) => f.r2Key));

    const folderIds = folderRows.map((r) => r.id);
    const fileIds = fileRows.map((r) => r.id);

    await prisma.$transaction(async (tx) => {
      await tx.cavCloudMultipartPart.deleteMany({
        where: {
          upload: {
            accountId,
            folderId: { in: folderIds },
          },
        },
      });

      await tx.cavCloudMultipartUpload.deleteMany({
        where: {
          accountId,
          folderId: { in: folderIds },
        },
      });

      await tx.cavCloudTrash.deleteMany({
        where: {
          accountId,
          OR: [
            { id: trash.id },
            { fileId: { in: fileIds } },
            { folderId: { in: folderIds } },
          ],
        },
      });

      if (fileIds.length) {
        await tx.cavCloudFile.deleteMany({ where: { id: { in: fileIds } } });
      }

      await tx.cavCloudFolder.deleteMany({
        where: {
          id: { in: folderIds },
        },
      });

      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });

      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "trash.permanent_delete",
        targetType: "folder",
        targetId: folder.id,
        targetPath: folder.path,
        metaJson: {
          reason,
          removedFiles: fileIds.length,
          removedFolders: folderIds.length,
          usedBytes: usedBytes.toString(),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { ok: true, removedFiles: fileIds.length, removedFolders: folderIds.length, reason };
  }

  await prisma.cavCloudTrash.delete({ where: { id: trash.id } });
  return { ok: true, removedFiles: 0, removedFolders: 0, reason };
}

export async function uploadSimpleFile(args: {
  accountId: string;
  operatorUserId: string;
  folderId?: string | null;
  folderPath?: string | null;
  fileName: string;
  mimeType?: string | null;
  body: ReadableStream<Uint8Array>;
  contentLength?: number | null;
  generateTextSnippets?: boolean;
}) {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  const generateTextSnippets = args.generateTextSnippets !== false;

  const fileName = safeNodeName(args.fileName);
  const mimeType = preferredMimeType({
    providedMimeType: args.mimeType,
    fileName,
  }) || "application/octet-stream";
  const contentLength = parsePositiveInt(args.contentLength ?? undefined);

  const folder = await resolveFolderForWrite({
    accountId,
    folderId: args.folderId ?? null,
    folderPath: args.folderPath ?? null,
    createIfMissingPath: !args.folderId && !!args.folderPath,
  });

  const path = joinPath(folder.path, fileName);
  await assertPathAvailable(accountId, path);

  const usage = await quotaSnapshot(accountId);
  if (contentLength != null) {
    const incoming = BigInt(contentLength);
    assertPerFileLimit(incoming, usage.perFileMaxBytes);
    assertQuotaLimit(usage.usedBytes, incoming, usage.limitBytes);
  }

  const fileId = crypto.randomUUID();
  const objectKey = workspaceR2ObjectKey(accountId, fileId, fileName, args.operatorUserId || null);

  const hash = crypto.createHash("sha256");
  let byteCount = BigInt(0);
  const previewChunks: Buffer[] = [];
  let previewChunkBytes = 0;

  const input = Readable.fromWeb(args.body as unknown as NodeReadableStream<Uint8Array>);
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      try {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteCount += BigInt(buf.length);

        assertPerFileLimit(byteCount, usage.perFileMaxBytes);
        assertQuotaLimit(usage.usedBytes, byteCount, usage.limitBytes);

        hash.update(buf);
        if (previewChunkBytes < PREVIEW_SNIPPET_RANGE_BYTES) {
          const remaining = PREVIEW_SNIPPET_RANGE_BYTES - previewChunkBytes;
          const head = buf.length > remaining ? buf.subarray(0, remaining) : buf;
          if (head.length) {
            previewChunks.push(head);
            previewChunkBytes += head.length;
          }
        }
        cb(null, buf);
      } catch (err) {
        cb(err as Error);
      }
    },
  });

  const pass = new PassThrough();

  try {
    await Promise.all([
      putCavcloudObjectStream({
        objectKey,
        body: pass,
        contentType: mimeType,
        contentLength: contentLength ?? undefined,
      }),
      pipeline(input, meter, pass),
    ]);
  } catch (err) {
    await deleteObjectKeysBestEffort([objectKey]);
    if (err instanceof CavCloudError) throw err;
    throw new CavCloudError("UPLOAD_FAILED", 500);
  }

  if (contentLength != null && byteCount !== BigInt(contentLength)) {
    await deleteObjectKeysBestEffort([objectKey]);
    throw new CavCloudError("CONTENT_LENGTH_MISMATCH", 400, "content-length does not match uploaded bytes");
  }

  const sha256 = hash.digest("hex");
  const previewSnippet = generateTextSnippets
    ? previewSnippetFromChunkParts(previewChunks, previewChunkBytes, fileName, mimeType)
    : null;
  const previewSnippetUpdatedAt = new Date();

  try {
    const created = await prisma.$transaction(async (tx) => {
      await assertPathAvailable(accountId, path, tx);
      const q = await quotaSnapshot(accountId, tx);
      assertPerFileLimit(byteCount, q.perFileMaxBytes);
      assertQuotaLimit(q.usedBytes, byteCount, q.limitBytes);

      const file = await tx.cavCloudFile.create({
        data: {
          id: fileId,
          accountId,
          folderId: folder.id,
          name: fileName,
          path,
          relPath: toRelPath(path),
          r2Key: objectKey,
          bytes: byteCount,
          mimeType,
          sha256,
          previewSnippet,
          previewSnippetUpdatedAt,
        },
        select: {
          id: true,
          folderId: true,
          name: true,
          path: true,
          r2Key: true,
          bytes: true,
          mimeType: true,
          sha256: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });
      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "file.upload.simple",
        targetType: "file",
        targetId: file.id,
        targetPath: file.path,
        metaJson: {
          bytes: file.bytes.toString(),
          mimeType,
          usedBytes: usedBytes.toString(),
        },
      });

      return file;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return mapFile(created);
  } catch (err) {
    await deleteObjectKeysBestEffort([objectKey]);
    if (err instanceof CavCloudError) throw err;
    const code = String((err as { code?: unknown })?.code || "");
    if (code === "P2002") throw new CavCloudError("PATH_CONFLICT", 409);
    throw err;
  }
}

export async function createMultipartSession(args: {
  accountId: string;
  operatorUserId: string;
  folderId?: string | null;
  folderPath?: string | null;
  fileName: string;
  mimeType?: string | null;
  expectedBytes?: number | null;
  partSizeBytes?: number | null;
}) {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);

  const fileName = safeNodeName(args.fileName);
  const mimeType = preferredMimeType({
    providedMimeType: args.mimeType,
    fileName,
  }) || "application/octet-stream";

  const requestedPartBytes = parsePositiveInt(args.partSizeBytes ?? null) ?? DEFAULT_MULTIPART_PART_BYTES;
  const partSizeBytes = Math.max(MIN_MULTIPART_PART_BYTES, Math.min(MAX_MULTIPART_PART_BYTES, requestedPartBytes));

  const expectedBytesN = parsePositiveInt(args.expectedBytes ?? null);
  const expectedBytes = expectedBytesN == null ? null : BigInt(expectedBytesN);

  const folder = await resolveFolderForWrite({
    accountId,
    folderId: args.folderId ?? null,
    folderPath: args.folderPath ?? null,
    createIfMissingPath: !args.folderId && !!args.folderPath,
  });

  const path = joinPath(folder.path, fileName);
  await assertPathAvailable(accountId, path);

  const usage = await quotaSnapshot(accountId);
  if (expectedBytes != null) {
    assertPerFileLimit(expectedBytes, usage.perFileMaxBytes);
    assertQuotaLimit(usage.usedBytes, expectedBytes, usage.limitBytes);

    const partsNeeded = Math.ceil(Number(expectedBytes) / partSizeBytes);
    if (partsNeeded > MAX_MULTIPART_PARTS) {
      throw new CavCloudError("MULTIPART_TOO_MANY_PARTS", 400);
    }
  }

  const objectFileId = crypto.randomUUID();
  const objectKey = workspaceR2ObjectKey(accountId, objectFileId, fileName, args.operatorUserId || null);

  const created = await createCavcloudMultipartUpload({
    objectKey,
    contentType: mimeType,
  });

  const session = await prisma.cavCloudMultipartUpload.create({
    data: {
      accountId,
      folderId: folder.id,
      fileName,
      filePath: path,
      mimeType,
      r2Key: objectKey,
      r2UploadId: created.uploadId,
      expectedBytes,
      partSizeBytes,
      status: "CREATED",
      createdByUserId: args.operatorUserId,
      expiresAt: new Date(Date.now() + DEFAULT_MULTIPART_TTL_HOURS * 60 * 60 * 1000),
    },
    select: {
      id: true,
      filePath: true,
      r2Key: true,
      partSizeBytes: true,
      expectedBytes: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  await prisma.cavCloudActivity.create({
    data: {
      accountId,
      operatorUserId: args.operatorUserId,
      action: "file.upload.multipart.create",
      targetType: "upload",
      targetId: session.id,
      targetPath: session.filePath,
      metaJson: {
        partSizeBytes,
        expectedBytes: session.expectedBytes?.toString() || null,
      },
    },
  });

  return {
    id: session.id,
    filePath: session.filePath,
    r2Key: session.r2Key,
    partSizeBytes: session.partSizeBytes,
    expectedBytes: session.expectedBytes ? toSafeNumber(session.expectedBytes) : null,
    expectedBytesExact: session.expectedBytes ? session.expectedBytes.toString() : null,
    expiresAtISO: toISO(session.expiresAt),
    createdAtISO: toISO(session.createdAt),
  };
}

export async function uploadMultipartSessionPart(args: {
  accountId: string;
  operatorUserId: string;
  uploadId: string;
  partNumber: number;
  body: Buffer;
}) {
  const accountId = String(args.accountId || "").trim();
  const uploadId = String(args.uploadId || "").trim();
  const partNumber = Number(args.partNumber);

  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!uploadId) throw new CavCloudError("UPLOAD_ID_REQUIRED", 400);
  if (!Number.isFinite(partNumber) || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_MULTIPART_PARTS) {
    throw new CavCloudError("PART_NUMBER_INVALID", 400);
  }

  const upload = await prisma.cavCloudMultipartUpload.findFirst({
    where: {
      id: uploadId,
      accountId,
      status: "CREATED",
    },
    select: {
      id: true,
      r2Key: true,
      r2UploadId: true,
      partSizeBytes: true,
      expiresAt: true,
    },
  });

  if (!upload) throw new CavCloudError("UPLOAD_NOT_FOUND", 404);
  if (new Date(upload.expiresAt).getTime() <= Date.now()) {
    throw new CavCloudError("UPLOAD_EXPIRED", 410);
  }

  if (args.body.length > upload.partSizeBytes) {
    throw new CavCloudError("PART_TOO_LARGE", 413);
  }

  const sha256 = crypto.createHash("sha256").update(args.body).digest("hex");

  const uploaded = await uploadCavcloudMultipartPart({
    objectKey: upload.r2Key,
    uploadId: upload.r2UploadId,
    partNumber,
    body: args.body,
    contentLength: args.body.length,
  });

  await prisma.cavCloudMultipartPart.upsert({
    where: {
      uploadId_partNumber: {
        uploadId,
        partNumber,
      },
    },
    create: {
      uploadId,
      partNumber,
      etag: uploaded.etag,
      bytes: args.body.length,
      sha256,
    },
    update: {
      etag: uploaded.etag,
      bytes: args.body.length,
      sha256,
    },
  });

  await prisma.cavCloudActivity.create({
    data: {
      accountId,
      operatorUserId: args.operatorUserId,
      action: "file.upload.multipart.part",
      targetType: "upload",
      targetId: upload.id,
      metaJson: {
        partNumber,
        bytes: args.body.length,
      },
    },
  });

  return {
    uploadId,
    partNumber,
    etag: uploaded.etag,
    sha256,
    bytes: args.body.length,
  };
}

export async function completeMultipartSession(args: {
  accountId: string;
  operatorUserId: string;
  uploadId: string;
  sha256: string;
  generateTextSnippets?: boolean;
}) {
  const accountId = String(args.accountId || "").trim();
  const uploadId = String(args.uploadId || "").trim();
  const sha256 = String(args.sha256 || "").trim().toLowerCase();
  const generateTextSnippets = args.generateTextSnippets !== false;

  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!uploadId) throw new CavCloudError("UPLOAD_ID_REQUIRED", 400);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new CavCloudError("SHA256_REQUIRED", 400);

  const upload = await prisma.cavCloudMultipartUpload.findFirst({
    where: {
      id: uploadId,
      accountId,
      status: "CREATED",
    },
    select: {
      id: true,
      folderId: true,
      fileName: true,
      filePath: true,
      mimeType: true,
      r2Key: true,
      r2UploadId: true,
      expiresAt: true,
    },
  });
  if (!upload) throw new CavCloudError("UPLOAD_NOT_FOUND", 404);
  if (new Date(upload.expiresAt).getTime() <= Date.now()) throw new CavCloudError("UPLOAD_EXPIRED", 410);

  const parts = await prisma.cavCloudMultipartPart.findMany({
    where: { uploadId: upload.id },
    orderBy: { partNumber: "asc" },
    select: {
      partNumber: true,
      etag: true,
      bytes: true,
    },
  });

  if (!parts.length) throw new CavCloudError("MULTIPART_NO_PARTS", 400);

  await completeCavcloudMultipartUpload({
    objectKey: upload.r2Key,
    uploadId: upload.r2UploadId,
    parts: parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
  });

  const head = await headCavcloudObject(upload.r2Key);
  if (!head) {
    throw new CavCloudError("UPLOAD_COMPLETE_MISSING_OBJECT", 500);
  }

  const bytes = BigInt(head.bytes);
  let previewSnippet: string | null = null;
  if (generateTextSnippets) {
    try {
      previewSnippet = await computePreviewSnippetFromObject(upload.r2Key, upload.fileName, upload.mimeType);
    } catch {
      previewSnippet = null;
    }
  }
  const previewSnippetUpdatedAt = new Date();

  try {
    const file = await prisma.$transaction(async (tx) => {
      await assertPathAvailable(accountId, upload.filePath, tx);
      const usage = await quotaSnapshot(accountId, tx);
      assertPerFileLimit(bytes, usage.perFileMaxBytes);
      assertQuotaLimit(usage.usedBytes, bytes, usage.limitBytes);

      const fileId = crypto.randomUUID();
      const file = await tx.cavCloudFile.create({
        data: {
          id: fileId,
          accountId,
          folderId: upload.folderId,
          name: upload.fileName,
          path: upload.filePath,
          relPath: toRelPath(upload.filePath),
          r2Key: upload.r2Key,
          bytes,
          mimeType: upload.mimeType,
          sha256,
          previewSnippet,
          previewSnippetUpdatedAt,
        },
        select: {
          id: true,
          folderId: true,
          name: true,
          path: true,
          r2Key: true,
          bytes: true,
          mimeType: true,
          sha256: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.cavCloudMultipartUpload.update({
        where: { id: upload.id },
        data: {
          status: "COMPLETED",
          completedFileId: file.id,
        },
      });

      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });
      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "file.upload.multipart.complete",
        targetType: "file",
        targetId: file.id,
        targetPath: file.path,
        metaJson: {
          bytes: file.bytes.toString(),
          partCount: parts.length,
          usedBytes: usedBytes.toString(),
        },
      });

      return file;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return mapFile(file);
  } catch (err) {
    await deleteObjectKeysBestEffort([upload.r2Key]);

    await prisma.cavCloudMultipartUpload.updateMany({
      where: { id: upload.id, status: "CREATED" },
      data: { status: "ABORTED" },
    });

    if (err instanceof CavCloudError) throw err;
    const code = String((err as { code?: unknown })?.code || "");
    if (code === "P2002") throw new CavCloudError("PATH_CONFLICT", 409);
    throw err;
  }
}

export async function abortMultipartSession(args: {
  accountId: string;
  operatorUserId: string;
  uploadId: string;
}) {
  const accountId = String(args.accountId || "").trim();
  const uploadId = String(args.uploadId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!uploadId) throw new CavCloudError("UPLOAD_ID_REQUIRED", 400);

  const upload = await prisma.cavCloudMultipartUpload.findFirst({
    where: {
      id: uploadId,
      accountId,
      status: "CREATED",
    },
    select: {
      id: true,
      r2Key: true,
      r2UploadId: true,
      filePath: true,
    },
  });
  if (!upload) throw new CavCloudError("UPLOAD_NOT_FOUND", 404);

  try {
    await abortCavcloudMultipartUpload({
      objectKey: upload.r2Key,
      uploadId: upload.r2UploadId,
    });
  } catch {
    // Continue and mark as aborted so UI can retry with a fresh session.
  }

  await prisma.$transaction(async (tx) => {
    await tx.cavCloudMultipartPart.deleteMany({ where: { uploadId: upload.id } });
    await tx.cavCloudMultipartUpload.update({
      where: { id: upload.id },
      data: { status: "ABORTED" },
    });
    await writeActivity(tx, {
      accountId,
      operatorUserId: args.operatorUserId,
      action: "file.upload.multipart.abort",
      targetType: "upload",
      targetId: upload.id,
      targetPath: upload.filePath,
    });
  });

  return { ok: true as const };
}

type FolderUploadManifestEntryInput = {
  relPath?: unknown;
  bytes?: unknown;
  mimeTypeGuess?: unknown;
  lastModified?: unknown;
};

type NormalizedFolderUploadManifestEntry = {
  relPath: string;
  fileName: string;
  subPathSegments: string[];
  parentFolderKey: string;
  bytes: bigint;
  mimeTypeGuess: string | null;
  lastModified: number | null;
};

type FolderUploadFolderNode = {
  key: string;
  parentKey: string;
  name: string;
  path: string;
  depth: number;
};

export type CavCloudFolderUploadFailedItem = {
  relPath: string;
  fileId: string;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  status: "FAILED";
  updatedAtISO: string;
};

export type CavCloudFolderUploadMissingItem = {
  relPath: string;
  fileId: string;
  status: "CREATED" | "UPLOADING";
  updatedAtISO: string;
};

export type CavCloudFolderUploadSessionStatusPayload = {
  sessionId: string;
  status: "CREATED" | "UPLOADING" | "COMPLETE" | "FAILED";
  parentFolderId: string;
  rootFolderId: string;
  requestedRootName: string;
  resolvedRootName: string;
  discoveredFilesCount: number;
  createdFilesCount: number;
  finalizedFilesCount: number;
  failedFilesCount: number;
  missingCount: number;
  manifestGapCount: number;
  failed: CavCloudFolderUploadFailedItem[];
  missing: CavCloudFolderUploadMissingItem[];
  failedPage: number;
  failedPageSize: number;
  failedTotal: number;
  createdAtISO: string;
  updatedAtISO: string;
};

function folderUploadLog(sessionId: string, event: string, meta?: Record<string, unknown>) {
  const payload = meta && typeof meta === "object" ? meta : {};
  console.info("[cavcloud-folder-upload]", sessionId, event, payload);
}

function normalizeFolderUploadRelativePath(raw: unknown): string | null {
  const input = String(raw || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").trim();
  if (!input) return null;
  const parts = input.split("/").filter(Boolean);
  if (!parts.length) return null;

  const normalized: string[] = [];
  for (const part of parts) {
    try {
      normalized.push(safeNodeName(part));
    } catch {
      return null;
    }
  }
  return normalized.length ? normalized.join("/") : null;
}

function folderUploadErrorCode(err: unknown): string {
  if (err instanceof CavCloudError) return err.code;
  const code = String((err as { code?: unknown })?.code || "").trim();
  return code || "UPLOAD_FAILED";
}

function folderUploadErrorMessage(err: unknown, fallback: string): string {
  const msg = String((err as { message?: unknown })?.message || "").trim();
  return msg || fallback;
}

function folderUploadRootCandidateName(baseName: string, index: number): string {
  if (index <= 1) return baseName;
  return safeNodeName(`${baseName}-${index}`);
}

function folderUploadJoinPathSegments(rootPath: string, segments: string[]): string {
  let current = normalizePathNoTrailingSlash(rootPath);
  for (const segment of segments) {
    current = joinPath(current, segment);
  }
  return current;
}

function parseFolderUploadManifestEntries(
  rawEntries: FolderUploadManifestEntryInput[],
  session: { requestedRootName: string; resolvedRootName: string },
): NormalizedFolderUploadManifestEntry[] {
  const parsedEntries: NormalizedFolderUploadManifestEntry[] = [];
  const seenRelPaths = new Set<string>();

  for (const entry of rawEntries) {
    const normalizedInputRelPath = normalizeFolderUploadRelativePath(entry?.relPath);
    if (!normalizedInputRelPath) {
      throw new CavCloudError("INVALID_REL_PATH", 400, "Manifest contains an invalid relative path.");
    }

    const parts = normalizedInputRelPath.split("/").filter(Boolean);
    let withinRoot = parts;
    if (parts[0] === session.requestedRootName || parts[0] === session.resolvedRootName) {
      withinRoot = parts.slice(1);
    }
    if (!withinRoot.length) {
      throw new CavCloudError("INVALID_REL_PATH", 400, "Manifest path is missing filename.");
    }

    const fileName = safeNodeName(withinRoot[withinRoot.length - 1] || "");
    const subPathSegments = withinRoot.slice(0, -1).map((segment) => safeNodeName(segment));
    const relPath = [session.resolvedRootName, ...subPathSegments, fileName].join("/");
    if (seenRelPaths.has(relPath)) {
      throw new CavCloudError("MANIFEST_DUPLICATE_REL_PATH", 409, `Duplicate relPath in manifest: ${relPath}`);
    }
    seenRelPaths.add(relPath);

    const bytes = BigInt(parseNonNegativeInt(entry?.bytes ?? 0) ?? 0);
    const mimeTypeGuess = preferredMimeType({
      providedMimeType: String(entry?.mimeTypeGuess || "").trim() || null,
      fileName,
    }) || null;
    const lastModified = parseNonNegativeInt(entry?.lastModified ?? null);
    const parentFolderKey = subPathSegments.join("/");

    parsedEntries.push({
      relPath,
      fileName,
      subPathSegments,
      parentFolderKey,
      bytes,
      mimeTypeGuess,
      lastModified,
    });
  }

  return parsedEntries;
}

function buildFolderUploadFolderNodesByDepth(
  parsedEntries: NormalizedFolderUploadManifestEntry[],
  rootFolderPath: string,
) {
  const nodeByKey = new Map<string, FolderUploadFolderNode>();
  let maxDepth = 0;

  for (const entry of parsedEntries) {
    for (let depth = 1; depth <= entry.subPathSegments.length; depth += 1) {
      const key = entry.subPathSegments.slice(0, depth).join("/");
      if (nodeByKey.has(key)) continue;

      const parentKey = depth <= 1 ? "" : entry.subPathSegments.slice(0, depth - 1).join("/");
      const name = entry.subPathSegments[depth - 1] || "";
      const path = folderUploadJoinPathSegments(rootFolderPath, entry.subPathSegments.slice(0, depth));
      nodeByKey.set(key, {
        key,
        parentKey,
        name,
        path,
        depth,
      });
      if (depth > maxDepth) maxDepth = depth;
    }
  }

  const nodesByDepth = new Map<number, FolderUploadFolderNode[]>();
  for (const node of nodeByKey.values()) {
    const list = nodesByDepth.get(node.depth) || [];
    list.push(node);
    nodesByDepth.set(node.depth, list);
  }
  for (const [depth, nodes] of nodesByDepth) {
    nodes.sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: "base" }));
    nodesByDepth.set(depth, nodes);
  }

  return {
    maxDepth,
    nodesByDepth,
  };
}

async function resolveFolderUploadSessionOrThrow(tx: DbClient, accountId: string, sessionId: string) {
  const db = folderUploadDb(tx);
  const session = await db.cavCloudFolderUploadSession.findFirst({
    where: {
      id: sessionId,
      accountId,
    },
    select: {
      id: true,
      accountId: true,
      parentFolderId: true,
      rootFolderId: true,
      createdByUserId: true,
      requestedRootName: true,
      resolvedRootName: true,
      status: true,
      discoveredFilesCount: true,
      createdFilesCount: true,
      finalizedFilesCount: true,
      failedFilesCount: true,
      createdAt: true,
      updatedAt: true,
      rootFolder: {
        select: {
          id: true,
          path: true,
        },
      },
    },
  });
  if (!session) throw new CavCloudError("UPLOAD_SESSION_NOT_FOUND", 404, "Folder upload session not found.");
  return session;
}

async function recomputeFolderUploadSessionCounts(
  tx: DbClient,
  accountId: string,
  sessionId: string,
  options?: { allowComplete?: boolean },
) {
  const db = folderUploadDb(tx);
  const session = await resolveFolderUploadSessionOrThrow(tx, accountId, sessionId);
  const [createdFilesCount, finalizedFilesCount, failedFilesCount] = await Promise.all([
    db.cavCloudFolderUploadSessionFile.count({
      where: {
        accountId,
        sessionId,
      },
    }),
    db.cavCloudFolderUploadSessionFile.count({
      where: {
        accountId,
        sessionId,
        status: "READY",
      },
    }),
    db.cavCloudFolderUploadSessionFile.count({
      where: {
        accountId,
        sessionId,
        status: "FAILED",
      },
    }),
  ]);

  const discoveredFilesCount = Math.max(0, Math.trunc(Number(session.discoveredFilesCount || 0)) || 0);
  let status: "CREATED" | "UPLOADING" | "COMPLETE" | "FAILED" = session.status as "CREATED" | "UPLOADING" | "COMPLETE" | "FAILED";
  if (failedFilesCount > 0) {
    status = "FAILED";
  } else if (options?.allowComplete && discoveredFilesCount > 0 && createdFilesCount === discoveredFilesCount && finalizedFilesCount === createdFilesCount) {
    status = "COMPLETE";
  } else if (discoveredFilesCount > 0 || createdFilesCount > 0) {
    status = "UPLOADING";
  } else {
    status = "CREATED";
  }

  const updated = await db.cavCloudFolderUploadSession.update({
    where: { id: sessionId },
    data: {
      status,
      createdFilesCount,
      finalizedFilesCount,
      failedFilesCount,
    },
    select: {
      id: true,
      accountId: true,
      parentFolderId: true,
      rootFolderId: true,
      requestedRootName: true,
      resolvedRootName: true,
      status: true,
      discoveredFilesCount: true,
      createdFilesCount: true,
      finalizedFilesCount: true,
      failedFilesCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updated;
}

async function markFolderUploadSessionFileFailed(args: {
  accountId: string;
  sessionId: string;
  fileId: string;
  errorCode: string;
  errorMessage: string;
}) {
  await runSerializableTxWithRetry(async () => {
    await prisma.$transaction(async (tx) => {
      const db = folderUploadDb(tx);
      const row = await db.cavCloudFolderUploadSessionFile.findFirst({
        where: {
          accountId: args.accountId,
          sessionId: args.sessionId,
          fileId: args.fileId,
        },
        select: {
          id: true,
          status: true,
        },
      });
      if (!row) return;
      if (row.status === "READY") return;

      await db.cavCloudFolderUploadSessionFile.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          errorCode: args.errorCode.slice(0, 64),
          errorMessage: args.errorMessage.slice(0, 2000),
          retryCount: { increment: 1 },
        },
      });
      await tx.cavCloudFile.updateMany({
        where: {
          id: args.fileId,
          accountId: args.accountId,
          deletedAt: null,
        },
        data: {
          status: "FAILED",
        },
      });
      await recomputeFolderUploadSessionCounts(db, args.accountId, args.sessionId, { allowComplete: false });
    }, SERIALIZABLE_INTERACTIVE_TX_OPTIONS);
  });
}

function mapFolderUploadFailedItem(row: {
  relPath: string;
  fileId: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  updatedAt: Date;
}): CavCloudFolderUploadFailedItem {
  return {
    relPath: row.relPath,
    fileId: row.fileId,
    status: "FAILED",
    errorCode: row.errorCode || null,
    errorMessage: row.errorMessage || null,
    retryCount: Math.max(0, Math.trunc(Number(row.retryCount || 0)) || 0),
    updatedAtISO: toISO(row.updatedAt),
  };
}

function mapFolderUploadMissingItem(row: {
  relPath: string;
  fileId: string;
  status: string;
  updatedAt: Date;
}): CavCloudFolderUploadMissingItem {
  return {
    relPath: row.relPath,
    fileId: row.fileId,
    status: "UPLOADING" === row.status ? "UPLOADING" : "CREATED",
    updatedAtISO: toISO(row.updatedAt),
  };
}

export async function createFolderUploadSession(args: {
  accountId: string;
  operatorUserId: string;
  parentFolderId?: string | null;
  parentFolderPath?: string | null;
  rootName: string;
  nameCollisionRule?: "autoRename" | "failAsk" | null;
}) {
  const accountId = String(args.accountId || "").trim();
  const operatorUserId = String(args.operatorUserId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!operatorUserId) throw new CavCloudError("OPERATOR_REQUIRED", 400);
  const nameCollisionRule = args.nameCollisionRule === "failAsk" ? "failAsk" : "autoRename";

  const requestedRootName = safeNodeName(args.rootName);

  const created = await runSerializableTxWithRetry(async () => prisma.$transaction(async (tx) => {
    const parentFolder = await resolveFolderForWrite({
      accountId,
      folderId: args.parentFolderId ?? null,
      folderPath: args.parentFolderPath ?? null,
      tx,
    });
    const db = folderUploadDb(tx);

    const startIndex = 1;
    const endIndex = nameCollisionRule === "failAsk" ? 1 : 1000;
    for (let idx = startIndex; idx <= endIndex; idx += 1) {
      const candidateName = folderUploadRootCandidateName(requestedRootName, idx);
      const candidatePath = joinPath(parentFolder.path, candidateName);

      const [folderConflict, fileConflict] = await Promise.all([
        tx.cavCloudFolder.findFirst({
          where: {
            accountId,
            path: candidatePath,
          },
          select: { id: true },
        }),
        tx.cavCloudFile.findFirst({
          where: {
            accountId,
            path: candidatePath,
          },
          select: { id: true },
        }),
      ]);
      if (folderConflict || fileConflict) {
        if (nameCollisionRule === "failAsk") {
          throw new CavCloudError("PATH_CONFLICT", 409, `Path already exists: ${candidatePath}`);
        }
        continue;
      }

      let rootFolder: { id: string; name: string; path: string };
      try {
        rootFolder = await tx.cavCloudFolder.create({
          data: {
            accountId,
            parentId: parentFolder.id,
            name: candidateName,
            path: candidatePath,
          },
          select: {
            id: true,
            name: true,
            path: true,
          },
        });
      } catch (err) {
        const code = String((err as { code?: unknown })?.code || "");
        if (code === "P2002") {
          if (nameCollisionRule === "failAsk") {
            throw new CavCloudError("PATH_CONFLICT", 409, `Path already exists: ${candidatePath}`);
          }
          continue;
        }
        throw err;
      }

      const session = await db.cavCloudFolderUploadSession.create({
        data: {
          accountId,
          parentFolderId: parentFolder.id,
          rootFolderId: rootFolder.id,
          createdByUserId: operatorUserId,
          requestedRootName,
          resolvedRootName: rootFolder.name,
          status: "CREATED",
        },
        select: {
          id: true,
          parentFolderId: true,
          rootFolderId: true,
          requestedRootName: true,
          resolvedRootName: true,
          status: true,
          discoveredFilesCount: true,
          createdFilesCount: true,
          finalizedFilesCount: true,
          failedFilesCount: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        session,
        rootFolder,
      };
    }

    throw new CavCloudError("ROOT_NAME_UNAVAILABLE", 409, "Could not reserve an available upload root folder name.");
  }, SERIALIZABLE_INTERACTIVE_TX_OPTIONS));

  folderUploadLog(created.session.id, "session.created", {
    parentFolderId: created.session.parentFolderId,
    rootFolderId: created.session.rootFolderId,
    requestedRootName: created.session.requestedRootName,
    resolvedRootName: created.session.resolvedRootName,
  });

  return {
    sessionId: created.session.id,
    rootFolderId: created.session.rootFolderId,
    requestedRootName: created.session.requestedRootName,
    resolvedRootName: created.session.resolvedRootName,
    status: created.session.status,
    discoveredFilesCount: created.session.discoveredFilesCount,
    createdFilesCount: created.session.createdFilesCount,
    finalizedFilesCount: created.session.finalizedFilesCount,
    failedFilesCount: created.session.failedFilesCount,
    createdAtISO: toISO(created.session.createdAt),
    updatedAtISO: toISO(created.session.updatedAt),
  };
}

export async function ingestFolderUploadManifest(args: {
  accountId: string;
  sessionId: string;
  entries: FolderUploadManifestEntryInput[];
}) {
  const accountId = String(args.accountId || "").trim();
  const sessionId = String(args.sessionId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!sessionId) throw new CavCloudError("UPLOAD_SESSION_ID_REQUIRED", 400);

  const rawEntries = Array.isArray(args.entries) ? args.entries : [];
  const batchSize = rawEntries.length;
  if (batchSize < FOLDER_UPLOAD_MANIFEST_MIN_BATCH) {
    throw new CavCloudError("MANIFEST_EMPTY", 400, "Manifest entries are required.");
  }
  if (batchSize > FOLDER_UPLOAD_MANIFEST_MAX_BATCH) {
    throw new CavCloudError(
      "MANIFEST_BATCH_TOO_LARGE",
      400,
      `Manifest batch too large. Send at most ${FOLDER_UPLOAD_MANIFEST_MAX_BATCH} entries per request.`,
    );
  }

  const sessionSnapshot = await resolveFolderUploadSessionOrThrow(prisma, accountId, sessionId);
  if (sessionSnapshot.status === "COMPLETE") {
    throw new CavCloudError("UPLOAD_SESSION_COMPLETE", 409, "Upload session is already complete.");
  }

  // Parse and normalize up-front so transaction time is spent on writes, not per-entry CPU work.
  const parsedEntries = parseFolderUploadManifestEntries(rawEntries, {
    requestedRootName: sessionSnapshot.requestedRootName,
    resolvedRootName: sessionSnapshot.resolvedRootName,
  });
  const folderPlan = buildFolderUploadFolderNodesByDepth(parsedEntries, sessionSnapshot.rootFolder.path);

  const result = await runSerializableTxWithRetry(async () => prisma.$transaction(async (tx) => {
    const db = folderUploadDb(tx);
    const session = await resolveFolderUploadSessionOrThrow(db, accountId, sessionId);
    if (session.status === "COMPLETE") {
      throw new CavCloudError("UPLOAD_SESSION_COMPLETE", 409, "Upload session is already complete.");
    }

    const existingRows = await db.cavCloudFolderUploadSessionFile.findMany({
      where: {
        accountId,
        sessionId,
        relPath: {
          in: parsedEntries.map((entry) => entry.relPath),
        },
      },
      select: { relPath: true },
      take: parsedEntries.length,
    });
    if (existingRows.length) {
      throw new CavCloudError("MANIFEST_REL_PATH_EXISTS", 409, `Manifest path already exists in this session: ${existingRows[0]?.relPath || "unknown"}`);
    }

    const rootFolderPath = normalizePathNoTrailingSlash(session.rootFolder.path);
    const folderIdByKey = new Map<string, string>();
    folderIdByKey.set("", session.rootFolder.id);

    for (let depth = 1; depth <= folderPlan.maxDepth; depth += 1) {
      const nodesAtDepth = folderPlan.nodesByDepth.get(depth) || [];
      if (!nodesAtDepth.length) continue;

      const parentIds = new Set<string>();
      const names = new Set<string>();
      for (const node of nodesAtDepth) {
        const parentId = folderIdByKey.get(node.parentKey);
        if (!parentId) throw new CavCloudError("PATH_CONFLICT", 409, `Could not resolve folder path ${node.path}.`);
        parentIds.add(parentId);
        names.add(node.name);
      }

      const parentIdList = Array.from(parentIds);
      const nameList = Array.from(names);
      const whereChildren = {
        accountId,
        deletedAt: null,
        parentId: { in: parentIdList },
        name: { in: nameList },
      };

      const existingFolders = await tx.cavCloudFolder.findMany({
        where: whereChildren,
        select: {
          id: true,
          parentId: true,
          name: true,
          path: true,
        },
      });
      const folderByParentAndName = new Map<string, { id: string; path: string }>();
      for (const folder of existingFolders) {
        folderByParentAndName.set(`${folder.parentId || ""}::${folder.name}`, {
          id: folder.id,
          path: normalizePathNoTrailingSlash(folder.path),
        });
      }

      const missingNodes: FolderUploadFolderNode[] = [];
      for (const node of nodesAtDepth) {
        const parentId = folderIdByKey.get(node.parentKey);
        if (!parentId) throw new CavCloudError("PATH_CONFLICT", 409, `Could not resolve folder path ${node.path}.`);
        const existing = folderByParentAndName.get(`${parentId}::${node.name}`);
        if (existing) {
          if (existing.path !== normalizePathNoTrailingSlash(node.path)) {
            throw new CavCloudError("PATH_CONFLICT", 409, `Could not resolve folder path ${node.path}.`);
          }
          folderIdByKey.set(node.key, existing.id);
          continue;
        }
        missingNodes.push(node);
      }
      if (!missingNodes.length) continue;

      const missingPaths = missingNodes.map((node) => normalizePathNoTrailingSlash(node.path));
      const fileConflict = await tx.cavCloudFile.findFirst({
        where: {
          accountId,
          deletedAt: null,
          path: {
            in: missingPaths,
          },
        },
        select: { path: true },
      });
      if (fileConflict?.path) {
        throw new CavCloudError("PATH_CONFLICT", 409, `Path already exists: ${fileConflict.path}`);
      }

      await tx.cavCloudFolder.createMany({
        data: missingNodes.map((node) => {
          const parentId = folderIdByKey.get(node.parentKey);
          if (!parentId) throw new CavCloudError("PATH_CONFLICT", 409, `Could not resolve folder path ${node.path}.`);
          return {
            accountId,
            parentId,
            name: node.name,
            path: normalizePathNoTrailingSlash(node.path),
          };
        }),
        skipDuplicates: true,
      });

      const resolvedFolders = await tx.cavCloudFolder.findMany({
        where: whereChildren,
        select: {
          id: true,
          parentId: true,
          name: true,
          path: true,
        },
      });
      const resolvedByParentAndName = new Map<string, { id: string; path: string }>();
      for (const folder of resolvedFolders) {
        resolvedByParentAndName.set(`${folder.parentId || ""}::${folder.name}`, {
          id: folder.id,
          path: normalizePathNoTrailingSlash(folder.path),
        });
      }
      for (const node of missingNodes) {
        const parentId = folderIdByKey.get(node.parentKey);
        if (!parentId) throw new CavCloudError("PATH_CONFLICT", 409, `Could not resolve folder path ${node.path}.`);
        const resolved = resolvedByParentAndName.get(`${parentId}::${node.name}`);
        if (!resolved || resolved.path !== normalizePathNoTrailingSlash(node.path)) {
          throw new CavCloudError("PATH_CONFLICT", 409, `Could not resolve folder path ${node.path}.`);
        }
        folderIdByKey.set(node.key, resolved.id);
      }
    }

    const filePlans = parsedEntries.map((entry) => {
      const parentId = folderIdByKey.get(entry.parentFolderKey);
      if (!parentId) throw new CavCloudError("PATH_CONFLICT", 409, `Could not resolve folder for ${entry.relPath}.`);
      const parentPath = entry.parentFolderKey
        ? folderUploadJoinPathSegments(rootFolderPath, entry.subPathSegments)
        : rootFolderPath;
      const filePath = joinPath(parentPath, entry.fileName);
      const fileId = crypto.randomUUID();
      const mimeType = preferredMimeType({
        providedMimeType: entry.mimeTypeGuess,
        fileName: entry.fileName,
      }) || "application/octet-stream";
      const r2Key = workspaceR2ObjectKey(accountId, fileId, entry.fileName, session.createdByUserId || null);

      return {
        entry,
        parentId,
        filePath,
        fileId,
        mimeType,
        r2Key,
      };
    });

    const filePaths = filePlans.map((plan) => normalizePathNoTrailingSlash(plan.filePath));
    const [folderPathConflicts, filePathConflicts] = await Promise.all([
      tx.cavCloudFolder.findMany({
        where: {
          accountId,
          deletedAt: null,
          path: {
            in: filePaths,
          },
        },
        select: { path: true },
        take: 1,
      }),
      tx.cavCloudFile.findMany({
        where: {
          accountId,
          deletedAt: null,
          path: {
            in: filePaths,
          },
        },
        select: { path: true },
        take: 1,
      }),
    ]);
    const pathConflict = String(folderPathConflicts[0]?.path || filePathConflicts[0]?.path || "").trim();
    if (pathConflict) throw new CavCloudError("PATH_CONFLICT", 409, `Path already exists: ${pathConflict}`);

    try {
      const created = await tx.cavCloudFile.createMany({
        data: filePlans.map((plan) => ({
          id: plan.fileId,
          accountId,
          folderId: plan.parentId,
          name: plan.entry.fileName,
          path: normalizePathNoTrailingSlash(plan.filePath),
          relPath: toRelPath(plan.filePath),
          r2Key: plan.r2Key,
          bytes: BigInt(0),
          mimeType: plan.mimeType,
          sha256: EMPTY_SHA256,
          status: "UPLOADING",
        })),
      });
      if (created.count !== filePlans.length) {
        throw new CavCloudError(
          "MANIFEST_CREATE_MISMATCH",
          500,
          `Manifest file creation mismatch: expected ${filePlans.length}, created ${created.count}.`,
        );
      }
    } catch (err) {
      const code = String((err as { code?: unknown })?.code || "");
      if (code === "P2002") {
        const conflict = await tx.cavCloudFile.findFirst({
          where: {
            accountId,
            deletedAt: null,
            path: {
              in: filePaths,
            },
          },
          select: { path: true },
        });
        if (conflict?.path) throw new CavCloudError("PATH_CONFLICT", 409, `Path already exists: ${conflict.path}`);
        throw new CavCloudError("PATH_CONFLICT", 409, "Path already exists.");
      }
      throw err;
    }

    try {
      const created = await db.cavCloudFolderUploadSessionFile.createMany({
        data: filePlans.map((plan) => ({
          sessionId,
          accountId,
          folderId: plan.parentId,
          fileId: plan.fileId,
          relPath: plan.entry.relPath,
          status: "CREATED",
          bytes: plan.entry.bytes,
          mimeTypeGuess: plan.entry.mimeTypeGuess,
        })),
      });
      if (created.count !== filePlans.length) {
        throw new CavCloudError(
          "MANIFEST_CREATE_MISMATCH",
          500,
          `Manifest session-file creation mismatch: expected ${filePlans.length}, created ${created.count}.`,
        );
      }
    } catch (err) {
      const code = String((err as { code?: unknown })?.code || "");
      if (code === "P2002") {
        throw new CavCloudError("MANIFEST_REL_PATH_EXISTS", 409, "Manifest path already exists in this session.");
      }
      throw err;
    }

    if (await ensureFilePathIndexTableAvailability(tx)) {
      const now = new Date();
      const indexRows: Prisma.CavCloudFilePathIndexCreateManyInput[] = [];
      for (const plan of filePlans) {
        const fullSegments = [...plan.entry.subPathSegments, plan.entry.fileName];
        for (let depth = 0; depth <= plan.entry.subPathSegments.length; depth += 1) {
          const ancestorKey = depth <= 0 ? "" : plan.entry.subPathSegments.slice(0, depth).join("/");
          const folderId = folderIdByKey.get(ancestorKey);
          if (!folderId) continue;
          const normalizedRelPath = fullSegments.slice(depth).join("/");
          if (!normalizedRelPath) continue;
          indexRows.push({
            id: crypto.randomUUID(),
            accountId,
            fileId: plan.fileId,
            folderId,
            normalizedRelPath,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      const chunkSize = 500;
      for (let i = 0; i < indexRows.length; i += chunkSize) {
        await tx.cavCloudFilePathIndex.createMany({
          data: indexRows.slice(i, i + chunkSize),
          skipDuplicates: true,
        });
      }
    }

    await db.cavCloudFolderUploadSession.update({
      where: { id: sessionId },
      data: {
        discoveredFilesCount: {
          increment: parsedEntries.length,
        },
        status: "UPLOADING",
      },
    });

    const counts = await recomputeFolderUploadSessionCounts(db, accountId, sessionId, { allowComplete: false });

    return {
      createdFiles: filePlans.map((plan) => ({
        relPath: plan.entry.relPath,
        fileId: plan.fileId,
        r2Key: plan.r2Key,
      })),
      discoveredFilesCount: counts.discoveredFilesCount,
      createdFilesCount: counts.createdFilesCount,
      finalizedFilesCount: counts.finalizedFilesCount,
      failedFilesCount: counts.failedFilesCount,
      status: counts.status as "CREATED" | "UPLOADING" | "COMPLETE" | "FAILED",
    };
  }, SERIALIZABLE_INTERACTIVE_TX_OPTIONS));

  folderUploadLog(sessionId, "manifest.ingested", {
    manifestSentCount: batchSize,
    serverCreatedFileRowsCount: result.createdFiles.length,
    discoveredFilesCount: result.discoveredFilesCount,
    createdFilesCount: result.createdFilesCount,
  });

  return result;
}

export async function uploadFolderUploadSessionFile(args: {
  accountId: string;
  operatorUserId: string;
  sessionId: string;
  fileId: string;
  body: ReadableStream<Uint8Array>;
  mimeType?: string | null;
  contentLength?: number | null;
  generateTextSnippets?: boolean;
}) {
  const accountId = String(args.accountId || "").trim();
  const operatorUserId = String(args.operatorUserId || "").trim();
  const sessionId = String(args.sessionId || "").trim();
  const fileId = String(args.fileId || "").trim();
  const generateTextSnippets = args.generateTextSnippets !== false;
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!operatorUserId) throw new CavCloudError("OPERATOR_REQUIRED", 400);
  if (!sessionId) throw new CavCloudError("UPLOAD_SESSION_ID_REQUIRED", 400);
  if (!fileId) throw new CavCloudError("FILE_ID_REQUIRED", 400);

  const sessionFile = await prismaFolderUpload.cavCloudFolderUploadSessionFile.findFirst({
    where: {
      accountId,
      sessionId,
      fileId,
    },
    select: {
      id: true,
      relPath: true,
      status: true,
      mimeTypeGuess: true,
      file: {
        select: {
          id: true,
          folderId: true,
          name: true,
          path: true,
          r2Key: true,
          bytes: true,
          mimeType: true,
          sha256: true,
          previewSnippet: true,
          previewSnippetUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      session: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });
  if (!sessionFile?.file) throw new CavCloudError("UPLOAD_FILE_NOT_FOUND", 404, "Upload session file was not found.");
  if (sessionFile.session.status === "COMPLETE") {
    throw new CavCloudError("UPLOAD_SESSION_COMPLETE", 409, "Upload session is already complete.");
  }
  if (sessionFile.status === "READY") {
    const counts = await prisma.$transaction(
      async (tx) => recomputeFolderUploadSessionCounts(tx, accountId, sessionId, { allowComplete: false }),
      INTERACTIVE_TX_OPTIONS,
    );
    folderUploadLog(sessionId, "file.upload.skipped_already_ready", {
      fileId,
      relPath: sessionFile.relPath,
    });
    return {
      file: mapFile(sessionFile.file),
      alreadyReady: true,
      discoveredFilesCount: counts.discoveredFilesCount,
      createdFilesCount: counts.createdFilesCount,
      finalizedFilesCount: counts.finalizedFilesCount,
      failedFilesCount: counts.failedFilesCount,
      status: counts.status as "CREATED" | "UPLOADING" | "COMPLETE" | "FAILED",
    };
  }

  await prisma.$transaction([
    prismaFolderUpload.cavCloudFolderUploadSessionFile.update({
      where: { id: sessionFile.id },
      data: {
        status: "UPLOADING",
        errorCode: null,
        errorMessage: null,
      },
    }),
    prisma.cavCloudFile.updateMany({
      where: {
        id: sessionFile.file.id,
        accountId,
        deletedAt: null,
      },
      data: {
        status: "UPLOADING",
      },
    }),
  ]);

  const preferredType = preferredMimeType({
    providedMimeType: args.mimeType || sessionFile.mimeTypeGuess || sessionFile.file.mimeType,
    fileName: sessionFile.file.name,
  }) || "application/octet-stream";
  const contentLength = parsePositiveInt(args.contentLength ?? null);
  const previousBytes = sessionFile.file.bytes;

  const usage = await quotaSnapshot(accountId);
  if (contentLength != null) {
    const incoming = BigInt(contentLength);
    assertPerFileLimit(incoming, usage.perFileMaxBytes);
    const delta = incoming - previousBytes;
    if (delta > BigInt(0)) {
      assertQuotaLimit(usage.usedBytes, delta, usage.limitBytes);
    }
  }

  const hash = crypto.createHash("sha256");
  let uploadedBytes = BigInt(0);
  const previewChunks: Buffer[] = [];
  let previewChunkBytes = 0;

  const input = Readable.fromWeb(args.body as unknown as NodeReadableStream<Uint8Array>);
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      try {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        uploadedBytes += BigInt(buf.length);

        assertPerFileLimit(uploadedBytes, usage.perFileMaxBytes);
        const delta = uploadedBytes - previousBytes;
        if (delta > BigInt(0)) {
          assertQuotaLimit(usage.usedBytes, delta, usage.limitBytes);
        }

        hash.update(buf);
        if (previewChunkBytes < PREVIEW_SNIPPET_RANGE_BYTES) {
          const remaining = PREVIEW_SNIPPET_RANGE_BYTES - previewChunkBytes;
          const head = buf.length > remaining ? buf.subarray(0, remaining) : buf;
          if (head.length) {
            previewChunks.push(head);
            previewChunkBytes += head.length;
          }
        }
        cb(null, buf);
      } catch (err) {
        cb(err as Error);
      }
    },
  });
  const pass = new PassThrough();

  try {
    await Promise.all([
      putCavcloudObjectStream({
        objectKey: sessionFile.file.r2Key,
        body: pass,
        contentType: preferredType,
        contentLength: contentLength ?? undefined,
      }),
      pipeline(input, meter, pass),
    ]);
  } catch (err) {
    await deleteObjectKeysBestEffort([sessionFile.file.r2Key]);
    const errorCode = folderUploadErrorCode(err);
    const errorMessage = folderUploadErrorMessage(err, "Failed to upload file bytes.");
    await markFolderUploadSessionFileFailed({
      accountId,
      sessionId,
      fileId,
      errorCode,
      errorMessage,
    });
    folderUploadLog(sessionId, "file.upload.failed", {
      fileId,
      relPath: sessionFile.relPath,
      errorCode,
      errorMessage,
    });
    if (err instanceof CavCloudError) throw err;
    throw new CavCloudError(errorCode, 500, errorMessage);
  }

  if (contentLength != null && uploadedBytes !== BigInt(contentLength)) {
    await deleteObjectKeysBestEffort([sessionFile.file.r2Key]);
    const mismatchError = new CavCloudError("CONTENT_LENGTH_MISMATCH", 400, "content-length does not match uploaded bytes");
    await markFolderUploadSessionFileFailed({
      accountId,
      sessionId,
      fileId,
      errorCode: mismatchError.code,
      errorMessage: mismatchError.message,
    });
    folderUploadLog(sessionId, "file.upload.failed", {
      fileId,
      relPath: sessionFile.relPath,
      errorCode: mismatchError.code,
      errorMessage: mismatchError.message,
    });
    throw mismatchError;
  }

  const sha256 = hash.digest("hex");
  const previewSnippet = generateTextSnippets
    ? previewSnippetFromChunkParts(
        previewChunks,
        previewChunkBytes,
        sessionFile.file.name,
        preferredType,
      )
    : null;
  const previewSnippetUpdatedAt = new Date();

  let savedFile: {
    id: string;
    folderId: string;
    name: string;
    path: string;
    r2Key: string;
    bytes: bigint;
    mimeType: string;
    sha256: string;
    previewSnippet?: string | null;
    previewSnippetUpdatedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };

  try {
    savedFile = await runSerializableTxWithRetry(async () => prisma.$transaction(async (tx) => {
      const db = folderUploadDb(tx);
      const latest = await tx.cavCloudFile.findFirst({
        where: {
          id: fileId,
          accountId,
          deletedAt: null,
        },
        select: {
          id: true,
          folderId: true,
          name: true,
          path: true,
          r2Key: true,
          bytes: true,
          mimeType: true,
          sha256: true,
          previewSnippet: true,
          previewSnippetUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!latest) throw new CavCloudError("FILE_NOT_FOUND", 404);

      const q = await quotaSnapshot(accountId, tx);
      assertPerFileLimit(uploadedBytes, q.perFileMaxBytes);
      const delta = uploadedBytes - latest.bytes;
      if (delta > BigInt(0)) {
        assertQuotaLimit(q.usedBytes, delta, q.limitBytes);
      }

      const updated = await tx.cavCloudFile.update({
        where: { id: latest.id },
        data: {
          bytes: uploadedBytes,
          mimeType: preferredType,
          sha256,
          status: "READY",
          previewSnippet,
          previewSnippetUpdatedAt,
        },
        select: {
          id: true,
          folderId: true,
          name: true,
          path: true,
          r2Key: true,
          bytes: true,
          mimeType: true,
          sha256: true,
          previewSnippet: true,
          previewSnippetUpdatedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await db.cavCloudFolderUploadSessionFile.update({
        where: { id: sessionFile.id },
        data: {
          status: "READY",
          bytes: uploadedBytes,
          mimeTypeGuess: preferredType,
          errorCode: null,
          errorMessage: null,
        },
      });

      return updated;
    }, SERIALIZABLE_INTERACTIVE_TX_OPTIONS));
  } catch (err) {
    await deleteObjectKeysBestEffort([sessionFile.file.r2Key]);
    const errorCode = folderUploadErrorCode(err);
    const errorMessage = folderUploadErrorMessage(err, "Failed to finalize uploaded file.");
    await markFolderUploadSessionFileFailed({
      accountId,
      sessionId,
      fileId,
      errorCode,
      errorMessage,
    });
    folderUploadLog(sessionId, "file.upload.failed", {
      fileId,
      relPath: sessionFile.relPath,
      errorCode,
      errorMessage,
    });
    if (err instanceof CavCloudError) throw err;
    throw new CavCloudError(errorCode, 500, errorMessage);
  }

  let usedBytes: bigint | null = null;
  try {
    usedBytes = await refreshQuota(accountId);
  } catch (err) {
    folderUploadLog(sessionId, "quota.refresh.failed", {
      fileId,
      relPath: sessionFile.relPath,
      errorCode: folderUploadErrorCode(err),
      errorMessage: folderUploadErrorMessage(err, "Failed to refresh storage quota."),
    });
  }

  if (usedBytes != null) {
    try {
      await prisma.$transaction(async (tx) => {
        await recordStorageHistoryPoint(tx, { accountId, usedBytes });
      }, INTERACTIVE_TX_OPTIONS);
    } catch (err) {
      folderUploadLog(sessionId, "storage.history.failed", {
        fileId,
        relPath: sessionFile.relPath,
        errorCode: folderUploadErrorCode(err),
        errorMessage: folderUploadErrorMessage(err, "Failed to write storage history."),
      });
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await writeActivity(tx, {
        accountId,
        operatorUserId,
        action: "file.upload.simple",
        targetType: "file",
        targetId: savedFile.id,
        targetPath: savedFile.path,
        metaJson: {
          bytes: savedFile.bytes.toString(),
          mimeType: preferredType,
          usedBytes: usedBytes == null ? null : usedBytes.toString(),
          sessionId,
          relPath: sessionFile.relPath,
        },
      });
    }, INTERACTIVE_TX_OPTIONS);
  } catch (err) {
    folderUploadLog(sessionId, "activity.write.failed", {
      fileId,
      relPath: sessionFile.relPath,
      errorCode: folderUploadErrorCode(err),
      errorMessage: folderUploadErrorMessage(err, "Failed to write upload activity."),
    });
  }

  const counts = await prisma.$transaction(
    async (tx) => recomputeFolderUploadSessionCounts(folderUploadDb(tx), accountId, sessionId, { allowComplete: false }),
    INTERACTIVE_TX_OPTIONS,
  );

  folderUploadLog(sessionId, "file.upload.ready", {
    fileId,
    relPath: sessionFile.relPath,
    uploadedBytes: uploadedBytes.toString(),
  });

  return {
    file: mapFile(savedFile),
    alreadyReady: false,
    discoveredFilesCount: counts.discoveredFilesCount,
    createdFilesCount: counts.createdFilesCount,
    finalizedFilesCount: counts.finalizedFilesCount,
    failedFilesCount: counts.failedFilesCount,
    status: counts.status as "CREATED" | "UPLOADING" | "COMPLETE" | "FAILED",
  };
}

export async function getFolderUploadSessionStatus(args: {
  accountId: string;
  sessionId: string;
  failedPage?: number | null;
  failedPageSize?: number | null;
}): Promise<CavCloudFolderUploadSessionStatusPayload> {
  const accountId = String(args.accountId || "").trim();
  const sessionId = String(args.sessionId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!sessionId) throw new CavCloudError("UPLOAD_SESSION_ID_REQUIRED", 400);

  const failedPage = Math.max(1, parsePositiveInt(args.failedPage ?? null) ?? 1);
  const failedPageSize = Math.max(
    1,
    Math.min(
      FOLDER_UPLOAD_STATUS_FAILED_PAGE_SIZE_MAX,
      parsePositiveInt(args.failedPageSize ?? null) ?? FOLDER_UPLOAD_STATUS_FAILED_PAGE_SIZE,
    ),
  );
  const failedSkip = (failedPage - 1) * failedPageSize;

  const status = await prisma.$transaction(async (tx) => {
    const db = folderUploadDb(tx);
    const session = await recomputeFolderUploadSessionCounts(db, accountId, sessionId, { allowComplete: false });
    const [failedRows, failedTotal, missingRows] = await Promise.all([
      db.cavCloudFolderUploadSessionFile.findMany({
        where: {
          accountId,
          sessionId,
          status: "FAILED",
        },
        orderBy: {
          updatedAt: "desc",
        },
        skip: failedSkip,
        take: failedPageSize,
        select: {
          relPath: true,
          fileId: true,
          status: true,
          errorCode: true,
          errorMessage: true,
          retryCount: true,
          updatedAt: true,
        },
      }),
      db.cavCloudFolderUploadSessionFile.count({
        where: {
          accountId,
          sessionId,
          status: "FAILED",
        },
      }),
      db.cavCloudFolderUploadSessionFile.findMany({
        where: {
          accountId,
          sessionId,
          status: {
            in: ["CREATED", "UPLOADING"],
          },
        },
        orderBy: {
          relPath: "asc",
        },
        take: 500,
        select: {
          relPath: true,
          fileId: true,
          status: true,
          updatedAt: true,
        },
      }),
    ]);

    const discovered = Math.max(0, Math.trunc(Number(session.discoveredFilesCount || 0)) || 0);
    const created = Math.max(0, Math.trunc(Number(session.createdFilesCount || 0)) || 0);
    const finalized = Math.max(0, Math.trunc(Number(session.finalizedFilesCount || 0)) || 0);
    const failed = Math.max(0, Math.trunc(Number(session.failedFilesCount || 0)) || 0);
    const manifestGapCount = Math.max(0, discovered - created);
    const inflightMissingCount = Math.max(0, created - finalized - failed);
    const missingCount = manifestGapCount + inflightMissingCount;

    return {
      sessionId: session.id,
      status: session.status as "CREATED" | "UPLOADING" | "COMPLETE" | "FAILED",
      parentFolderId: session.parentFolderId,
      rootFolderId: session.rootFolderId,
      requestedRootName: session.requestedRootName,
      resolvedRootName: session.resolvedRootName,
      discoveredFilesCount: discovered,
      createdFilesCount: created,
      finalizedFilesCount: finalized,
      failedFilesCount: failed,
      missingCount,
      manifestGapCount,
      failed: failedRows.map(mapFolderUploadFailedItem),
      missing: missingRows.map(mapFolderUploadMissingItem),
      failedPage,
      failedPageSize,
      failedTotal,
      createdAtISO: toISO(session.createdAt),
      updatedAtISO: toISO(session.updatedAt),
    } as CavCloudFolderUploadSessionStatusPayload;
  }, INTERACTIVE_TX_OPTIONS);

  folderUploadLog(sessionId, "session.status", {
    discoveredFilesCount: status.discoveredFilesCount,
    createdFilesCount: status.createdFilesCount,
    finalizedFilesCount: status.finalizedFilesCount,
    failedFilesCount: status.failedFilesCount,
    missingCount: status.missingCount,
  });

  return status;
}

export async function finalizeFolderUploadSession(args: {
  accountId: string;
  sessionId: string;
}) {
  const accountId = String(args.accountId || "").trim();
  const sessionId = String(args.sessionId || "").trim();
  if (!accountId) throw new CavCloudError("ACCOUNT_REQUIRED", 400);
  if (!sessionId) throw new CavCloudError("UPLOAD_SESSION_ID_REQUIRED", 400);

  const result = await runSerializableTxWithRetry(async () => prisma.$transaction(async (tx) => {
    const db = folderUploadDb(tx);
    const counts = await recomputeFolderUploadSessionCounts(db, accountId, sessionId, { allowComplete: false });
    const [failedRows, missingRows] = await Promise.all([
      db.cavCloudFolderUploadSessionFile.findMany({
        where: {
          accountId,
          sessionId,
          status: "FAILED",
        },
        orderBy: {
          relPath: "asc",
        },
        select: {
          relPath: true,
          fileId: true,
          status: true,
          errorCode: true,
          errorMessage: true,
          retryCount: true,
          updatedAt: true,
        },
      }),
      db.cavCloudFolderUploadSessionFile.findMany({
        where: {
          accountId,
          sessionId,
          status: {
            in: ["CREATED", "UPLOADING"],
          },
        },
        orderBy: {
          relPath: "asc",
        },
        select: {
          relPath: true,
          fileId: true,
          status: true,
          updatedAt: true,
        },
      }),
    ]);

    const discovered = Math.max(0, Math.trunc(Number(counts.discoveredFilesCount || 0)) || 0);
    const created = Math.max(0, Math.trunc(Number(counts.createdFilesCount || 0)) || 0);
    const finalized = Math.max(0, Math.trunc(Number(counts.finalizedFilesCount || 0)) || 0);
    const failed = Math.max(0, Math.trunc(Number(counts.failedFilesCount || 0)) || 0);
    const manifestGapCount = Math.max(0, discovered - created);
    const missingCount = manifestGapCount + missingRows.length;

    const complete = discovered > 0
      && discovered === created
      && created === finalized
      && failed === 0
      && manifestGapCount === 0
      && missingRows.length === 0;

    const status = await db.cavCloudFolderUploadSession.update({
      where: { id: sessionId },
      data: {
        status: complete ? "COMPLETE" : "FAILED",
      },
      select: {
        id: true,
        status: true,
        discoveredFilesCount: true,
        createdFilesCount: true,
        finalizedFilesCount: true,
        failedFilesCount: true,
        updatedAt: true,
      },
    });

    return {
      ok: complete,
      sessionId: status.id,
      status: status.status as "COMPLETE" | "FAILED",
      discoveredFilesCount: discovered,
      createdFilesCount: created,
      finalizedFilesCount: finalized,
      failedFilesCount: failed,
      missingCount,
      manifestGapCount,
      failed: failedRows.map(mapFolderUploadFailedItem),
      missing: missingRows.map(mapFolderUploadMissingItem),
      updatedAtISO: toISO(status.updatedAt),
    };
  }, SERIALIZABLE_INTERACTIVE_TX_OPTIONS));

  folderUploadLog(sessionId, "session.finalize", {
    ok: result.ok,
    status: result.status,
    discoveredFilesCount: result.discoveredFilesCount,
    createdFilesCount: result.createdFilesCount,
    finalizedFilesCount: result.finalizedFilesCount,
    failedFilesCount: result.failedFilesCount,
    missingCount: result.missingCount,
    manifestGapCount: result.manifestGapCount,
  });

  return result;
}

export async function verifyFolderUploadSession(args: {
  accountId: string;
  sessionId: string;
}) {
  const status = await getFolderUploadSessionStatus({
    accountId: args.accountId,
    sessionId: args.sessionId,
    failedPage: 1,
    failedPageSize: FOLDER_UPLOAD_STATUS_FAILED_PAGE_SIZE_MAX,
  });

  const discoveredEqualsCreated = status.discoveredFilesCount === status.createdFilesCount;
  const createdEqualsFinalized = status.createdFilesCount === status.finalizedFilesCount;
  const noFailures = status.failedFilesCount === 0;
  const noMissing = status.missingCount === 0;
  const ok = discoveredEqualsCreated && createdEqualsFinalized && noFailures && noMissing;

  return {
    ok,
    sessionId: status.sessionId,
    status: status.status,
    discoveredFilesCount: status.discoveredFilesCount,
    createdFilesCount: status.createdFilesCount,
    finalizedFilesCount: status.finalizedFilesCount,
    failedFilesCount: status.failedFilesCount,
    missingCount: status.missingCount,
    comparisons: {
      discoveredEqualsCreated,
      createdEqualsFinalized,
      noFailures,
      noMissing,
    },
    failed: status.failed,
    missing: status.missing,
    updatedAtISO: status.updatedAtISO,
  };
}
