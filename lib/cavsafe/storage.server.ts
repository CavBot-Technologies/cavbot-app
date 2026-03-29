import "server-only";

import crypto from "crypto";
import { PassThrough, Readable, Transform } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { pipeline } from "stream/promises";

import { Prisma } from "@prisma/client";

import { resolvePlanIdFromTier, type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { cavsafeSecuredStorageLimitBytesForPlan } from "@/lib/cavsafe/policy.server";
import { resolveCavSafeRetentionPolicy } from "@/lib/cavsafe/settings.server";
import { inferCavsafeOperationKindFromActivity, writeCavSafeOperationLog } from "@/lib/cavsafe/operationLog.server";
import { buildZipBuffer } from "@/lib/cavsafe/zip.server";
import { preferredMimeType } from "@/lib/fileMime";
import {
  isTextLikeFile,
  normalizePreviewSnippetText,
  previewSnippetFromBytes,
  PREVIEW_SNIPPET_MAX_CHARS,
  PREVIEW_SNIPPET_RANGE_BYTES,
} from "@/lib/filePreview";
import {
  abortCavsafeMultipartUpload,
  completeCavsafeMultipartUpload,
  createCavsafeMultipartUpload,
  deleteCavsafeObject,
  getCavsafeObjectStream,
  headCavsafeObject,
  putCavsafeObject,
  putCavsafeObjectStream,
  uploadCavsafeMultipartPart,
} from "@/lib/cavsafe/r2.server";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const TRASH_RETENTION_DAYS = 30;
const DEFAULT_MULTIPART_TTL_HOURS = 24;

const MIN_MULTIPART_PART_BYTES = 5 * 1024 * 1024;
const DEFAULT_MULTIPART_PART_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_PART_BYTES = 64 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10_000;
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
const QUOTA_LOCK_NAMESPACE = "cavsafe_quota_v1";
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
] as const;

type DbClient = Prisma.TransactionClient | typeof prisma;

let cavSafeUsagePointTableAvailable: boolean | null = null;
let cavSafeQuotaTableAvailable: boolean | null = null;
const expiredTrashPurgeAtByAccount = new Map<string, number>();
const quotaRefreshedAtByAccount = new Map<string, number>();

export class CavSafeError extends Error {
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

export type CavSafeFolderItem = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  sharedUserCount: number;
  collaborationEnabled: boolean;
  createdAtISO: string;
  updatedAtISO: string;
};

export type CavSafeFileItem = {
  id: string;
  folderId: string;
  name: string;
  path: string;
  r2Key: string;
  bytes: number;
  bytesExact: string;
  mimeType: string;
  sha256: string;
  immutableAtISO?: string | null;
  unlockAtISO?: string | null;
  expireAtISO?: string | null;
  previewSnippet: string | null;
  previewSnippetUpdatedAtISO?: string | null;
  sharedUserCount: number;
  collaborationEnabled: boolean;
  createdAtISO: string;
  updatedAtISO: string;
};

export type CavSafeActivityItem = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetPath: string | null;
  createdAtISO: string;
  metaJson: Record<string, unknown> | null;
};

export type CavSafeStoragePoint = {
  ts: number;
  usedBytes: number;
  usedBytesExact: string;
};

export type CavSafeTreePayload = {
  folder: CavSafeFolderItem;
  breadcrumbs: Array<{ id: string; name: string; path: string }>;
  folders: CavSafeFolderItem[];
  files: CavSafeFileItem[];
  trash: Array<{
    id: string;
    kind: "file" | "folder";
    targetId: string;
    name: string;
    path: string;
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
  activity: CavSafeActivityItem[];
  storageHistory: CavSafeStoragePoint[];
};

export type CavSafeFolderChildrenPayload = {
  folder: CavSafeFolderItem;
  breadcrumbs: Array<{ id: string; name: string; path: string }>;
  folders: CavSafeFolderItem[];
  files: CavSafeFileItem[];
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

async function resolveOwnerOperatorUserId(accountId: string, operatorUserId?: string | null): Promise<string | null> {
  const preferred = String(operatorUserId || "").trim();
  if (preferred) return preferred;

  try {
    const owner = await prisma.membership.findFirst({
      where: {
        accountId,
        role: "OWNER",
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        userId: true,
      },
    });
    return String(owner?.userId || "").trim() || null;
  } catch {
    return null;
  }
}

async function resolveTrashRetentionPolicy(accountId: string, operatorUserId?: string | null): Promise<{
  trashRetentionDays: number;
  autoPurgeTrash: boolean;
}> {
  const resolvedUserId = await resolveOwnerOperatorUserId(accountId, operatorUserId);
  if (!resolvedUserId) {
    return {
      trashRetentionDays: TRASH_RETENTION_DAYS,
      autoPurgeTrash: true,
    };
  }

  try {
    const policy = await resolveCavSafeRetentionPolicy({
      accountId,
      userId: resolvedUserId,
    });
    const days = Number(policy.trashRetentionDays);
    return {
      trashRetentionDays: days === 7 || days === 14 || days === 30 ? days : TRASH_RETENTION_DAYS,
      autoPurgeTrash: policy.autoPurgeTrash !== false,
    };
  } catch {
    return {
      trashRetentionDays: TRASH_RETENTION_DAYS,
      autoPurgeTrash: true,
    };
  }
}

function isRetryableSerializableTxError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code || "").toUpperCase();
  if (code === "P2034") return true;

  const message = String(
    (err as { meta?: { message?: unknown }; message?: unknown })?.meta?.message
    || (err as { message?: unknown })?.message
    || "",
  ).toLowerCase();

  return message.includes("serialization failure")
    || message.includes("could not serialize access")
    || message.includes("write conflict")
    || message.includes("deadlock detected")
    || message.includes("expired transaction")
    || message.includes("transaction api error");
}

async function runSerializableTxWithRetry<T>(
  run: () => Promise<T>,
  attempts = SERIALIZABLE_TX_RETRY_ATTEMPTS,
): Promise<T> {
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

  throw lastErr instanceof Error ? lastErr : new CavSafeError("INTERNAL", 500);
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

  throw lastErr instanceof Error ? lastErr : new CavSafeError("INTERNAL", 500);
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
    return prisma.$transaction((lockedTx) => executeWithLock(lockedTx));
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
  return msg.includes("cavsafeusagepoint") && (msg.includes("does not exist") || msg.includes("relation"));
}

function isMissingQuotaTableError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  return msg.includes("cavsafequota") && (msg.includes("does not exist") || msg.includes("relation"));
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
        AND table_name = 'CavSafeUsagePoint'
    ) AS "exists"
  `;
  return parseSqlBool(rows[0]?.exists);
}

async function ensureUsagePointTableAvailability(tx: DbClient = prisma): Promise<boolean> {
  if (cavSafeUsagePointTableAvailable != null) return cavSafeUsagePointTableAvailable;

  try {
    const exists = await usagePointTableExists(tx);
    cavSafeUsagePointTableAvailable = exists;
    return exists;
  } catch {
    // If we cannot verify table availability, fail-open for uploads by skipping trend writes.
    cavSafeUsagePointTableAvailable = false;
    return false;
  }
}

async function loadStorageHistory(accountId: string, limit = STORAGE_HISTORY_MAX_POINTS, tx: DbClient = prisma): Promise<CavSafeStoragePoint[]> {
  if (!accountId) return [];
  if (!(await ensureUsagePointTableAvailability(tx))) return [];

  try {
    const rows = await tx.$queryRaw<Array<{ bucketStart: unknown; usedBytes: unknown }>>`
      SELECT "bucketStart", "usedBytes"
      FROM "CavSafeUsagePoint"
      WHERE "accountId" = ${accountId}
      ORDER BY "bucketStart" DESC
      LIMIT ${Math.max(1, Math.min(limit, 240))}
    `;

    cavSafeUsagePointTableAvailable = true;

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
      .filter((row): row is CavSafeStoragePoint => !!row)
      .reverse();
  } catch (err) {
    if (isMissingUsagePointTableError(err)) {
      cavSafeUsagePointTableAvailable = false;
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
      FROM "CavSafeUsagePoint"
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
          cavSafeUsagePointTableAvailable = true;
          return;
        }
      }
    }

    await tx.$executeRaw`
      INSERT INTO "CavSafeUsagePoint" ("id", "accountId", "bucketStart", "usedBytes", "createdAt", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${args.accountId}, ${bucketStart}, ${args.usedBytes}, NOW(), NOW())
      ON CONFLICT ("accountId", "bucketStart")
      DO UPDATE SET
        "usedBytes" = EXCLUDED."usedBytes",
        "updatedAt" = NOW()
    `;
    cavSafeUsagePointTableAvailable = true;
  } catch (err) {
    if (isMissingUsagePointTableError(err)) {
      cavSafeUsagePointTableAvailable = false;
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

function envInt(name: string): number | null {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function perFileLimitBytesForPlan(planId: PlanId): bigint {
  const free = envInt("CAVSAFE_MAX_FILE_BYTES_FREE") ?? envInt("CAVCLOUD_MAX_FILE_BYTES_FREE") ?? 64 * 1024 * 1024;
  const premium = envInt("CAVSAFE_MAX_FILE_BYTES_PREMIUM") ?? envInt("CAVCLOUD_MAX_FILE_BYTES_PREMIUM") ?? 1024 * 1024 * 1024;
  const premiumPlus = envInt("CAVSAFE_MAX_FILE_BYTES_PREMIUM_PLUS") ?? envInt("CAVCLOUD_MAX_FILE_BYTES_PREMIUM_PLUS") ?? 5 * 1024 * 1024 * 1024;

  if (planId === "premium_plus") return BigInt(premiumPlus);
  if (planId === "premium") return BigInt(premium);
  return BigInt(free);
}

function storageLimitBytesForPlan(planId: PlanId): bigint {
  return cavsafeSecuredStorageLimitBytesForPlan(planId);
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
  if (!input) throw new CavSafeError("NAME_REQUIRED", 400, "name is required");
  if (input === "." || input === "..") throw new CavSafeError("NAME_INVALID", 400, "name is invalid");
  if (/[/\\]/.test(input)) throw new CavSafeError("NAME_INVALID", 400, "name cannot contain slashes");
  if(/[\u0000-\u001f\u007f]/.test(input)) throw new CavSafeError("NAME_INVALID", 400, "name contains control characters");
  const cleaned = input.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) throw new CavSafeError("NAME_INVALID", 400, "name is invalid");
  if (cleaned.length > 220) return cleaned.slice(0, 220);
  return cleaned;
}

function safeFilenameForKey(raw: string): string {
  const name = safeNodeName(raw);
  return name.replace(/["'`]/g, "_").slice(0, 220) || "file";
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

function assertFileMutableIntegrity(file: { immutableAt?: Date | null }) {
  if (file.immutableAt) {
    throw new CavSafeError("IMMUTABLE_LOCKED", 403, "Integrity Lock is enabled for this file.");
  }
}

function assertFileTimeLockReadable(file: { unlockAt?: Date | null; expireAt?: Date | null }) {
  const now = Date.now();
  const unlockAt = file.unlockAt ? new Date(file.unlockAt).getTime() : 0;
  if (unlockAt && Number.isFinite(unlockAt) && now < unlockAt) {
    throw new CavSafeError("TIMELOCK_NOT_UNLOCKED", 403, "This file is time-locked until its unlock time.");
  }
  const expireAt = file.expireAt ? new Date(file.expireAt).getTime() : 0;
  if (expireAt && Number.isFinite(expireAt) && now >= expireAt) {
    throw new CavSafeError("TIMELOCK_EXPIRED", 403, "This file has expired and can no longer be opened.");
  }
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
    const conflict = await args.tx.cavSafeFile.findFirst({
      where: {
        accountId: args.accountId,
        path: candidatePath,
        deletedAt: null,
        ...(args.ignoreFileId ? { id: { not: args.ignoreFileId } } : {}),
      },
      select: { id: true },
    });
    const folderConflict = await args.tx.cavSafeFolder.findFirst({
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
  throw new CavSafeError("PATH_CONFLICT", 409, "Could not find an available file name.");
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
  const account = await tx.account.findUnique({
    where: { id: accountId },
    select: {
      tier: true,
      trialSeatActive: true,
      trialEndsAt: true,
    },
  });

  if (!account) throw new CavSafeError("ACCOUNT_NOT_FOUND", 404, "account not found");

  let planId = resolvePlanIdFromTier(account.tier);
  const trialEndsAtMs = account.trialEndsAt ? new Date(account.trialEndsAt).getTime() : 0;
  if (account.trialSeatActive && Number.isFinite(trialEndsAtMs) && trialEndsAtMs > Date.now()) {
    planId = "premium_plus";
  }

  const limitBytes = storageLimitBytesForPlan(planId);
  const perFileMaxBytes = perFileLimitBytesForPlan(planId);

  return {
    planId,
    limitBytes,
    perFileMaxBytes,
  };
}

async function computeUsedBytes(accountId: string, tx: DbClient = prisma): Promise<bigint> {
  const agg = await tx.cavSafeFile.aggregate({
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

  if (cavSafeQuotaTableAvailable !== false) {
    try {
      await runQuotaWriteWithRetry(() => withQuotaLock(tx, accountId, async (lockedTx) => {
        usedBytes = await computeUsedBytes(accountId, lockedTx);

        const updated = await lockedTx.cavSafeQuota.updateMany({
          where: { accountId },
          data: { usedBytes },
        });

        if (updated.count > 0) return;

        try {
          await lockedTx.cavSafeQuota.create({
            data: {
              accountId,
              usedBytes,
            },
          });
        } catch (err) {
          if (isMissingQuotaTableError(err)) throw err;

          // A concurrent writer can create first; update the authoritative row.
          const code = String((err as { code?: unknown })?.code || "").toUpperCase();
          if (code === "P2002") {
            await lockedTx.cavSafeQuota.updateMany({
              where: { accountId },
              data: { usedBytes },
            });
            return;
          }
          throw err;
        }
      }));
      cavSafeQuotaTableAvailable = true;
      quotaRefreshedAtByAccount.set(accountId, Date.now());
      return usedBytes;
    } catch (err) {
      if (isMissingQuotaTableError(err)) {
        // Fail-open: keep accounting accurate from CavSafeFile bytes even if quota table isn't present.
        cavSafeQuotaTableAvailable = false;
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
  if (cavSafeQuotaTableAvailable === false) {
    const used = await computeUsedBytes(accountId, tx);
    quotaRefreshedAtByAccount.set(accountId, Date.now());
    return used;
  }

  try {
    const row = await tx.cavSafeQuota.findUnique({
      where: { accountId },
      select: { usedBytes: true },
    });

    cavSafeQuotaTableAvailable = true;

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
      cavSafeQuotaTableAvailable = false;
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
    throw new CavSafeError("FILE_TOO_LARGE", 413, `file exceeds max size of ${maxBytes.toString()} bytes`);
  }
}

function assertQuotaLimit(usedBytes: bigint, incomingBytes: bigint, limitBytes: bigint | null) {
  if (limitBytes == null) return;
  if (incomingBytes <= BigInt(0)) return;
  if (usedBytes + incomingBytes > limitBytes) {
    throw new CavSafeError("QUOTA_EXCEEDED", 413, "storage quota exceeded");
  }
}

async function ensureRootFolder(accountId: string, tx: DbClient = prisma) {
  const existing = await tx.cavSafeFolder.findFirst({
    where: {
      accountId,
      path: "/",
    },
  });

  if (existing) {
    if (existing.deletedAt || existing.parentId !== null || existing.name !== "root") {
      const restored = await tx.cavSafeFolder.update({
        where: { id: existing.id },
        data: {
          parentId: null,
          name: "root",
          path: "/",
          deletedAt: null,
        },
      });
      await tx.cavSafeTrash.deleteMany({
        where: {
          accountId,
          folderId: restored.id,
        },
      });
      return restored;
    }
    return existing;
  }

  const now = new Date();
  await tx.$executeRaw`
    INSERT INTO "CavSafeFolder" ("id", "accountId", "parentId", "name", "path", "createdAt", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${accountId}, ${null}, ${"root"}, ${"/"}, ${now}, ${now})
    ON CONFLICT ("accountId", "path") DO NOTHING
  `;

  const retry = await tx.cavSafeFolder.findFirst({
    where: { accountId, path: "/" },
  });
  if (!retry) throw new CavSafeError("ROOT_FOLDER_INIT_FAILED", 500, "failed to initialize root folder");
  if (retry.deletedAt || retry.parentId !== null || retry.name !== "root") {
    const restored = await tx.cavSafeFolder.update({
      where: { id: retry.id },
      data: {
        parentId: null,
        name: "root",
        path: "/",
        deletedAt: null,
      },
    });
    await tx.cavSafeTrash.deleteMany({
      where: {
        accountId,
        folderId: restored.id,
      },
    });
    return restored;
  }
  return retry;
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
    const existing = await tx.cavSafeFolder.findFirst({
      where: {
        accountId,
        path: nextPath,
      },
    });

    if (existing) {
      if (existing.deletedAt || existing.parentId !== parent.id || existing.name !== segment) {
        parent = await tx.cavSafeFolder.update({
          where: { id: existing.id },
          data: {
            parentId: parent.id,
            name: segment,
            path: nextPath,
            deletedAt: null,
          },
        });
        await tx.cavSafeTrash.deleteMany({
          where: {
            accountId,
            folderId: parent.id,
          },
        });
      } else {
        parent = existing;
      }
      currentPath = nextPath;
      continue;
    }

    const now = new Date();
    await tx.$executeRaw`
      INSERT INTO "CavSafeFolder" ("id", "accountId", "parentId", "name", "path", "createdAt", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${accountId}, ${parent.id}, ${segment}, ${nextPath}, ${now}, ${now})
      ON CONFLICT ("accountId", "path") DO NOTHING
    `;

    const retry = await tx.cavSafeFolder.findFirst({
      where: {
        accountId,
        path: nextPath,
      },
    });
    if (!retry) throw new CavSafeError("FOLDER_CREATE_FAILED", 500, "failed to initialize folder path");
    if (retry.deletedAt || retry.parentId !== parent.id || retry.name !== segment) {
      parent = await tx.cavSafeFolder.update({
        where: { id: retry.id },
        data: {
          parentId: parent.id,
          name: segment,
          path: nextPath,
          deletedAt: null,
        },
      });
      await tx.cavSafeTrash.deleteMany({
        where: {
          accountId,
          folderId: parent.id,
        },
      });
    } else {
      parent = retry;
    }
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
  tx?: DbClient;
}) {
  const tx = args.tx ?? prisma;
  await ensureRootFolder(args.accountId, tx);

  if (args.folderId) {
    const folder = await tx.cavSafeFolder.findFirst({
      where: { id: args.folderId, accountId: args.accountId, deletedAt: null },
    });
    if (!folder) throw new CavSafeError("FOLDER_NOT_FOUND", 404, "folder not found");
    return folder;
  }

  const path = normalizePathNoTrailingSlash(String(args.folderPath || "/"));
  const folder = await tx.cavSafeFolder.findFirst({
    where: { accountId: args.accountId, path, deletedAt: null },
  });
  if (!folder) throw new CavSafeError("FOLDER_NOT_FOUND", 404, "folder not found");
  return folder;
}

async function assertPathAvailable(accountId: string, path: string, tx: DbClient = prisma, ignore?: { fileId?: string; folderId?: string }) {
  const wherePath = normalizePathNoTrailingSlash(path);

  const [folderHit, fileHit] = await Promise.all([
    tx.cavSafeFolder.findFirst({
      where: {
        accountId,
        path: wherePath,
        deletedAt: null,
        ...(ignore?.folderId ? { id: { not: ignore.folderId } } : {}),
      },
      select: { id: true },
    }),
    tx.cavSafeFile.findFirst({
      where: {
        accountId,
        path: wherePath,
        deletedAt: null,
        ...(ignore?.fileId ? { id: { not: ignore.fileId } } : {}),
      },
      select: { id: true },
    }),
  ]);

  if (folderHit || fileHit) throw new CavSafeError("PATH_CONFLICT", 409, "path already exists");
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
  await tx.cavSafeActivity.create({
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

  const operationKind = inferCavsafeOperationKindFromActivity({
    action: options.action,
    targetType: options.targetType,
    meta: (options.metaJson || null) as Record<string, unknown> | null,
  });
  if (!operationKind) return;

  const subjectTypeRaw = String(options.targetType || "").trim().toLowerCase();
  const subjectType = subjectTypeRaw === "folder"
    ? "folder"
    : subjectTypeRaw === "file"
      ? "file"
      : subjectTypeRaw === "share"
        ? "share"
        : "system";
  const subjectId = String(options.targetId || options.targetPath || "").trim();
  if (!subjectId) return;

  await writeCavSafeOperationLog({
    accountId: options.accountId,
    operatorUserId: options.operatorUserId || null,
    kind: operationKind,
    subjectType,
    subjectId,
    label: `${String(options.action || "").slice(0, 64)} ${subjectType}`,
    meta: options.metaJson,
  });
}

async function loadRecentActivity(accountId: string, tx: DbClient = prisma, limit = 24): Promise<CavSafeActivityItem[]> {
  const rows = await tx.cavSafeActivity.findMany({
    where: {
      accountId,
      action: {
        in: [...FEED_ACTIVITY_ACTIONS],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: Math.max(1, Math.min(limit, 120)),
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

function mapFolder(row: {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  sharedUserCount?: number | null;
  collaborationEnabled?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}): CavSafeFolderItem {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    parentId: row.parentId,
    sharedUserCount: Math.max(0, Math.trunc(Number(row.sharedUserCount || 0)) || 0),
    collaborationEnabled: Boolean(row.collaborationEnabled),
    createdAtISO: toISO(row.createdAt),
    updatedAtISO: toISO(row.updatedAt),
  };
}

function mapFile(row: {
  id: string;
  folderId: string;
  name: string;
  path: string;
  r2Key: string;
  bytes: bigint;
  mimeType: string;
  sha256: string;
  immutableAt?: Date | null;
  unlockAt?: Date | null;
  expireAt?: Date | null;
  previewSnippet?: string | null;
  previewSnippetUpdatedAt?: Date | null;
  sharedUserCount?: number | null;
  collaborationEnabled?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}): CavSafeFileItem {
  return {
    id: row.id,
    folderId: row.folderId,
    name: row.name,
    path: row.path,
    r2Key: row.r2Key,
    bytes: toSafeNumber(row.bytes),
    bytesExact: row.bytes.toString(),
    mimeType: row.mimeType,
    sha256: row.sha256,
    immutableAtISO: row.immutableAt ? toISO(row.immutableAt) : null,
    unlockAtISO: row.unlockAt ? toISO(row.unlockAt) : null,
    expireAtISO: row.expireAt ? toISO(row.expireAt) : null,
    previewSnippet: normalizePreviewSnippetText(row.previewSnippet || null, PREVIEW_SNIPPET_MAX_CHARS),
    previewSnippetUpdatedAtISO: row.previewSnippetUpdatedAt ? toISO(row.previewSnippetUpdatedAt) : null,
    sharedUserCount: Math.max(0, Math.trunc(Number(row.sharedUserCount || 0)) || 0),
    collaborationEnabled: Boolean(row.collaborationEnabled),
    createdAtISO: toISO(row.createdAt),
    updatedAtISO: toISO(row.updatedAt),
  };
}

async function loadCavSafeShareSignals(args: {
  accountId: string;
  folderIds: string[];
  fileIds: string[];
}): Promise<{
  folderById: Map<string, { sharedUserCount: number; collaborationEnabled: boolean }>;
  fileById: Map<string, { sharedUserCount: number; collaborationEnabled: boolean }>;
}> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) {
    return {
      folderById: new Map(),
      fileById: new Map(),
    };
  }
  const folderIds = Array.from(new Set((Array.isArray(args.folderIds) ? args.folderIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean)));
  const fileIds = Array.from(new Set((Array.isArray(args.fileIds) ? args.fileIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean)));
  if (!folderIds.length && !fileIds.length) {
    return {
      folderById: new Map(),
      fileById: new Map(),
    };
  }

  const now = new Date();
  const [folderRows, fileRows] = await Promise.all([
    folderIds.length
      ? prisma.cavSafeShare.findMany({
          where: {
            accountId,
            folderId: { in: folderIds },
            revokedAt: null,
            expiresAt: { gt: now },
          },
          select: {
            folderId: true,
            mode: true,
          },
        })
      : Promise.resolve([]),
    fileIds.length
      ? prisma.cavSafeShare.findMany({
          where: {
            accountId,
            fileId: { in: fileIds },
            revokedAt: null,
            expiresAt: { gt: now },
          },
          select: {
            fileId: true,
            mode: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const folderById = new Map<string, { sharedUserCount: number; collaborationEnabled: boolean }>();
  for (const row of folderRows) {
    const folderId = String(row.folderId || "").trim();
    if (!folderId) continue;
    const current = folderById.get(folderId) || { sharedUserCount: 0, collaborationEnabled: false };
    current.sharedUserCount += 1;
    if (String(row.mode || "").trim().toUpperCase() !== "READ_ONLY") {
      current.collaborationEnabled = true;
    }
    folderById.set(folderId, current);
  }

  const fileById = new Map<string, { sharedUserCount: number; collaborationEnabled: boolean }>();
  for (const row of fileRows) {
    const fileId = String(row.fileId || "").trim();
    if (!fileId) continue;
    const current = fileById.get(fileId) || { sharedUserCount: 0, collaborationEnabled: false };
    current.sharedUserCount += 1;
    if (String(row.mode || "").trim().toUpperCase() !== "READ_ONLY") {
      current.collaborationEnabled = true;
    }
    fileById.set(fileId, current);
  }

  return { folderById, fileById };
}

async function purgeExpiredTrash(accountId: string, operatorUserId?: string) {
  const policy = await resolveTrashRetentionPolicy(accountId, operatorUserId || null);
  if (!policy.autoPurgeTrash) return;

  const expired = await prisma.cavSafeTrash.findMany({
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

  for (const item of expired) {
    await permanentlyDeleteTrashEntry({
      accountId,
      trashId: item.id,
      operatorUserId: operatorUserId || null,
      reason: "lifecycle_purge",
    });
  }
}

async function maybePurgeExpiredTrash(accountId: string, operatorUserId?: string) {
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

function workspaceR2ObjectKey(accountId: string, fileId: string, filename: string): string {
  const safe = safeFilenameForKey(filename);
  return `safe/${accountId}/${fileId}/${safe}`;
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
  const stream = await getCavsafeObjectStream({
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
  const stream = await getCavsafeObjectStream({ objectKey });
  if (!stream) throw new CavSafeError("FILE_NOT_FOUND", 404, "source object missing");

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
      throw new CavSafeError("ZIP_SOURCE_TOO_LARGE", 413, "archive source exceeds configured size limit");
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
  const source = await getCavsafeObjectStream({ objectKey: args.sourceKey });
  if (!source) throw new CavSafeError("FILE_NOT_FOUND", 404, "source object missing");

  const body = Readable.fromWeb(source.body as unknown as NodeReadableStream<Uint8Array>);
  await putCavsafeObjectStream({
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

async function loadFolderChildrenPayload(args: {
  accountId: string;
  folderWhere: Prisma.CavSafeFolderWhereInput;
  query?: string;
}): Promise<CavSafeFolderChildrenPayload> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  await ensureOfficialSyncedFolders(accountId);

  const folder = await prisma.cavSafeFolder.findFirst({
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
  if (!folder) throw new CavSafeError("FOLDER_NOT_FOUND", 404);

  const q = String(args.query || "").trim();
  const nameFilter = q ? { contains: q, mode: "insensitive" as const } : null;

  const [folders, files, breadcrumbRows] = await Promise.all([
    prisma.cavSafeFolder.findMany({
      where: {
        accountId,
        parentId: folder.id,
        deletedAt: null,
        ...(nameFilter ? { name: nameFilter } : {}),
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        path: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.cavSafeFile.findMany({
      where: {
        accountId,
        folderId: folder.id,
        deletedAt: null,
        ...(nameFilter ? { name: nameFilter } : {}),
      },
      orderBy: [{ name: "asc" }],
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
    }),
    prisma.cavSafeFolder.findMany({
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

  const breadcrumbByPath = new Map(breadcrumbRows.map((row) => [row.path, row]));
  const breadcrumbs = buildBreadcrumbPaths(folder.path)
    .map((p) => breadcrumbByPath.get(p))
    .filter((v): v is { id: string; name: string; path: string } => !!v)
    .map((row) => ({ id: row.id, name: row.name, path: row.path }));
  const shareSignals = await loadCavSafeShareSignals({
    accountId,
    folderIds: [folder.id, ...folders.map((row) => row.id)],
    fileIds: files.map((row) => row.id),
  });
  const folderSignal = shareSignals.folderById.get(folder.id);

  return {
    folder: mapFolder({
      ...folder,
      sharedUserCount: folderSignal?.sharedUserCount ?? 0,
      collaborationEnabled: folderSignal?.collaborationEnabled ?? false,
    }),
    breadcrumbs,
    folders: folders.map((row) => {
      const signal = shareSignals.folderById.get(row.id);
      return mapFolder({
        ...row,
        sharedUserCount: signal?.sharedUserCount ?? 0,
        collaborationEnabled: signal?.collaborationEnabled ?? false,
      });
    }),
    files: files.map((row) => {
      const signal = shareSignals.fileById.get(row.id);
      return mapFile({
        ...row,
        sharedUserCount: signal?.sharedUserCount ?? 0,
        collaborationEnabled: signal?.collaborationEnabled ?? false,
      });
    }),
  };
}

export async function getRootFolder(args: { accountId: string }) {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  const root = await ensureRootFolder(accountId);
  await ensureOfficialSyncedFolders(accountId);
  const shareSignals = await loadCavSafeShareSignals({
    accountId,
    folderIds: [root.id],
    fileIds: [],
  });
  const signal = shareSignals.folderById.get(root.id);
  return mapFolder({
    ...root,
    sharedUserCount: signal?.sharedUserCount ?? 0,
    collaborationEnabled: signal?.collaborationEnabled ?? false,
  });
}

export async function getFolderChildrenById(args: { accountId: string; folderId: string }) {
  const accountId = String(args.accountId || "").trim();
  const folderId = String(args.folderId || "").trim();
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!folderId) throw new CavSafeError("FOLDER_ID_REQUIRED", 400);
  return loadFolderChildrenPayload({
    accountId,
    folderWhere: {
      id: folderId,
      accountId,
      deletedAt: null,
    },
  });
}

export async function searchFolderChildren(args: { accountId: string; folderId: string; query: string }) {
  const accountId = String(args.accountId || "").trim();
  const folderId = String(args.folderId || "").trim();
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!folderId) throw new CavSafeError("FOLDER_ID_REQUIRED", 400);
  return loadFolderChildrenPayload({
    accountId,
    folderWhere: {
      id: folderId,
      accountId,
      deletedAt: null,
    },
    query: args.query,
  });
}

export async function getTreeLite(args: { accountId: string; folderPath?: string }): Promise<CavSafeFolderChildrenPayload> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
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
  });
}

export async function getTree(args: { accountId: string; folderPath?: string; operatorUserId?: string | null }): Promise<CavSafeTreePayload> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);

  void maybePurgeExpiredTrash(accountId, args.operatorUserId || undefined);

  const path = normalizePathNoTrailingSlash(args.folderPath || "/");
  await ensureRootFolder(accountId);
  await ensureOfficialSyncedFolders(accountId);

  const folder = await prisma.cavSafeFolder.findFirst({
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

  if (!folder) throw new CavSafeError("FOLDER_NOT_FOUND", 404);

  const [folders, files, breadcrumbRows, trashRows, usage, activity, storageHistory] = await Promise.all([
    prisma.cavSafeFolder.findMany({
      where: {
        accountId,
        parentId: folder.id,
        deletedAt: null,
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        path: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.cavSafeFile.findMany({
      where: {
        accountId,
        folderId: folder.id,
        deletedAt: null,
      },
      orderBy: [{ name: "asc" }],
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
    }),
    prisma.cavSafeFolder.findMany({
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
    prisma.cavSafeTrash.findMany({
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

  const breadcrumbByPath = new Map(breadcrumbRows.map((b) => [b.path, b]));
  const breadcrumbs = buildBreadcrumbPaths(folder.path)
    .map((p) => breadcrumbByPath.get(p))
    .filter((v): v is { id: string; name: string; path: string } => !!v)
    .map((b) => ({ id: b.id, name: b.name, path: b.path }));
  const shareSignals = await loadCavSafeShareSignals({
    accountId,
    folderIds: [folder.id, ...folders.map((row) => row.id)],
    fileIds: files.map((row) => row.id),
  });
  const folderSignal = shareSignals.folderById.get(folder.id);

  return {
    folder: mapFolder({
      ...folder,
      sharedUserCount: folderSignal?.sharedUserCount ?? 0,
      collaborationEnabled: folderSignal?.collaborationEnabled ?? false,
    }),
    breadcrumbs,
    folders: folders.map((row) => {
      const signal = shareSignals.folderById.get(row.id);
      return mapFolder({
        ...row,
        sharedUserCount: signal?.sharedUserCount ?? 0,
        collaborationEnabled: signal?.collaborationEnabled ?? false,
      });
    }),
    files: files.map((row) => {
      const signal = shareSignals.fileById.get(row.id);
      return mapFile({
        ...row,
        sharedUserCount: signal?.sharedUserCount ?? 0,
        collaborationEnabled: signal?.collaborationEnabled ?? false,
      });
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

export async function listGalleryFiles(args: { accountId: string }): Promise<CavSafeFileItem[]> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);

  const files = await prisma.cavSafeFile.findMany({
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

  const shareSignals = await loadCavSafeShareSignals({
    accountId,
    folderIds: [],
    fileIds: files.map((row) => row.id),
  });
  return files.map((row) => {
    const signal = shareSignals.fileById.get(row.id);
    return mapFile({
      ...row,
      sharedUserCount: signal?.sharedUserCount ?? 0,
      collaborationEnabled: signal?.collaborationEnabled ?? false,
    });
  });
}

export async function getFileById(args: { accountId: string; fileId: string; enforceReadTimelock?: boolean }) {
  const file = await prisma.cavSafeFile.findFirst({
    where: {
      id: args.fileId,
      accountId: args.accountId,
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
      immutableAt: true,
      unlockAt: true,
      expireAt: true,
      previewSnippet: true,
      previewSnippetUpdatedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!file) throw new CavSafeError("FILE_NOT_FOUND", 404);
  if (args.enforceReadTimelock) {
    assertFileTimeLockReadable({
      unlockAt: file.unlockAt,
      expireAt: file.expireAt,
    });
  }
  const shareSignals = await loadCavSafeShareSignals({
    accountId: args.accountId,
    folderIds: [],
    fileIds: [file.id],
  });
  const signal = shareSignals.fileById.get(file.id);
  return mapFile({
    ...file,
    sharedUserCount: signal?.sharedUserCount ?? 0,
    collaborationEnabled: signal?.collaborationEnabled ?? false,
  });
}

export async function getOrCreateFilePreviewSnippets(args: {
  accountId: string;
  fileIds: string[];
  maxBatch?: number;
  concurrency?: number;
}): Promise<Record<string, string | null>> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);

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

  const files = await prisma.cavSafeFile.findMany({
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
      if (!file.previewSnippetUpdatedAt) {
        await prisma.cavSafeFile.updateMany({
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

    let snippet: string | null = null;
    try {
      snippet = await computePreviewSnippetFromObject(file.r2Key, file.name, file.mimeType);
    } catch {
      snippet = null;
    }

    await prisma.cavSafeFile.updateMany({
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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!trashId) throw new CavSafeError("TRASH_ID_REQUIRED", 400);

  const trash = await prisma.cavSafeTrash.findFirst({
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

  if (!trash?.file) throw new CavSafeError("TRASH_FILE_NOT_FOUND", 404);

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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);

  const name = safeNodeName(args.name);

  const created = await prisma.$transaction(async (tx) => {
    const parent = await resolveFolderForWrite({
      accountId,
      folderId: args.parentId ?? null,
      folderPath: args.parentPath ?? null,
      tx,
    });

    const path = joinPath(parent.path, name);
    const existingFolder = await tx.cavSafeFolder.findFirst({
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

    const existingFile = await tx.cavSafeFile.findFirst({
      where: {
        accountId,
        path,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existingFile) {
      throw new CavSafeError("PATH_CONFLICT_FILE", 409, `A file already exists at ${path}.`);
    }

    const now = new Date();
    const inserted = await tx.$executeRaw`
      INSERT INTO "CavSafeFolder" ("id", "accountId", "parentId", "name", "path", "createdAt", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${accountId}, ${parent.id}, ${name}, ${path}, ${now}, ${now})
      ON CONFLICT ("accountId", "path") DO NOTHING
    `;

    const insertedCount = typeof inserted === "bigint" ? Number(inserted) : Number(inserted || 0);
    const createdNew = Number.isFinite(insertedCount) && insertedCount > 0;
    const folder = await tx.cavSafeFolder.findFirst({
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
    if (!folder) {
      const raceFile = await tx.cavSafeFile.findFirst({
        where: {
          accountId,
          path,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (raceFile) {
        throw new CavSafeError("PATH_CONFLICT_FILE", 409, `A file already exists at ${path}.`);
      }
      throw new CavSafeError("PATH_CONFLICT", 409, "path already exists");
    }

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

    return folder;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return mapFolder(created);
}

async function resolveFolderMovePlan(tx: DbClient, args: {
  accountId: string;
  folderId: string;
  nextName?: string;
  nextParentId?: string | null;
}) {
  const folder = await tx.cavSafeFolder.findFirst({
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

  if (!folder) throw new CavSafeError("FOLDER_NOT_FOUND", 404);
  if (folder.path === "/") throw new CavSafeError("ROOT_FOLDER_IMMUTABLE", 400);
  if (isOfficialSyncedSystemPath(folder.path)) {
    throw new CavSafeError("SYSTEM_FOLDER_IMMUTABLE", 400, "System synced folders are immutable.");
  }

  const nextName = args.nextName ? safeNodeName(args.nextName) : folder.name;
  const nextParentId = args.nextParentId === undefined ? folder.parentId : args.nextParentId;

  let parentPath = "/";
  let parentId: string | null = null;

  if (nextParentId) {
    const parent = await tx.cavSafeFolder.findFirst({
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
    if (!parent) throw new CavSafeError("PARENT_FOLDER_NOT_FOUND", 404);
    if (parent.id === folder.id) throw new CavSafeError("FOLDER_CYCLE", 409);
    if (parent.path === folder.path || parent.path.startsWith(`${folder.path}/`)) {
      throw new CavSafeError("FOLDER_CYCLE", 409);
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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!folderId) throw new CavSafeError("FOLDER_ID_REQUIRED", 400);

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
      const destFolderConflicts = await tx.cavSafeFolder.findMany({
        where: {
          accountId,
          deletedAt: null,
          OR: [{ path: plan.nextPath }, { path: scopePaths(plan.nextPath) }],
        },
        select: { path: true },
      });
      const destFileConflicts = await tx.cavSafeFile.findMany({
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
      if (hasConflict) throw new CavSafeError("PATH_CONFLICT", 409);
    }

    const descendantsFolders = await tx.cavSafeFolder.findMany({
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

    const descendantsFiles = await tx.cavSafeFile.findMany({
      where: {
        accountId,
        deletedAt: null,
        path: scopePaths(plan.folder.path),
      },
      select: {
        id: true,
        path: true,
        immutableAt: true,
      },
      orderBy: { path: "asc" },
    });

    if (descendantsFiles.some((row) => !!row.immutableAt)) {
      throw new CavSafeError("IMMUTABLE_LOCKED", 403, "Integrity Lock is enabled for one or more files in this folder.");
    }

    const saved = await tx.cavSafeFolder.update({
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
        await tx.cavSafeFolder.update({
          where: { id: child.id },
          data: { path: `${plan.nextPath}${suffix}` },
        });
      }

      for (const file of descendantsFiles) {
        const suffix = file.path.slice(plan.folder.path.length);
        await tx.cavSafeFile.update({
          where: { id: file.id },
          data: { path: `${plan.nextPath}${suffix}` },
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
}) {
  const accountId = String(args.accountId || "").trim();
  const folderId = String(args.folderId || "").trim();
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!folderId) throw new CavSafeError("FOLDER_ID_REQUIRED", 400);
  const trashPolicy = await resolveTrashRetentionPolicy(accountId, args.operatorUserId || null);

  try {
    await runSerializableTxWithRetry(() => prisma.$transaction(async (tx) => {
      const folder = await tx.cavSafeFolder.findFirst({
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

      if (!folder) throw new CavSafeError("FOLDER_NOT_FOUND", 404);
      if (folder.path === "/") throw new CavSafeError("ROOT_FOLDER_IMMUTABLE", 400);
      if (isOfficialSyncedSystemPath(folder.path)) {
        throw new CavSafeError("SYSTEM_FOLDER_IMMUTABLE", 400, "System synced folders are immutable.");
      }

      const now = new Date();

      const folderScope: Prisma.CavSafeFolderWhereInput = {
        accountId,
        deletedAt: null,
        OR: [{ path: folder.path }, { path: scopePaths(folder.path) }],
      };

      const fileScope: Prisma.CavSafeFileWhereInput = {
        accountId,
        deletedAt: null,
        OR: [{ path: folder.path }, { path: scopePaths(folder.path) }],
      };

      const immutableHit = await tx.cavSafeFile.findFirst({
        where: {
          ...fileScope,
          immutableAt: { not: null },
        },
        select: { id: true },
      });
      if (immutableHit) {
        throw new CavSafeError("IMMUTABLE_LOCKED", 403, "Integrity Lock is enabled for one or more files in this folder.");
      }

      await tx.cavSafeFolder.updateMany({
        where: folderScope,
        data: {
          deletedAt: now,
        },
      });

      await tx.cavSafeFile.updateMany({
        where: fileScope,
        data: {
          deletedAt: now,
        },
      });

      await tx.cavSafeTrash.create({
        data: {
          accountId,
          folderId: folder.id,
          deletedAt: now,
          purgeAfter: nowPlusDays(trashPolicy.trashRetentionDays),
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (err) {
    if (isRetryableSerializableTxError(err)) {
      throw new CavSafeError("TX_CONFLICT", 409, "Temporary folder write conflict. Please retry.");
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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);

  const name = safeNodeName(args.name);
  const mimeType = preferredMimeType({
    providedMimeType: args.mimeType,
    fileName: name,
  }) || "application/octet-stream";
  const inputBytes = parsePositiveInt(args.bytes ?? 0) ?? 0;
  const bytes = BigInt(inputBytes);

  const sha256Raw = String(args.sha256 || "").trim().toLowerCase();
  const sha256 = /^[a-f0-9]{64}$/.test(sha256Raw) ? sha256Raw : bytes === BigInt(0) ? EMPTY_SHA256 : "";
  if (!sha256) throw new CavSafeError("SHA256_REQUIRED", 400, "sha256 must be a 64-char hex digest");

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
    const r2Key = String(args.r2Key || "").trim() || workspaceR2ObjectKey(accountId, id, name);

    const file = await tx.cavSafeFile.create({
      data: {
        id,
        accountId,
        folderId: folder.id,
        name,
        path,
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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);

  const source = String(args.source || "").trim() || null;
  const folderPath = normalizeSyncedFolderPathForSource(
    normalizePathNoTrailingSlash(String(args.folderPath || "/")),
    source,
  );
  if (isCavcodeSystemShadowPath(folderPath, source)) {
    throw new CavSafeError(
      "CAVCODE_SYSTEM_SYNC_BLOCKED",
      400,
      "The CavCode system folder is local-only and cannot sync to CavSafe.",
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
      const existing = await tx.cavSafeFile.findFirst({
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
          immutableAt: true,
        },
      });

      const quota = await quotaSnapshot(accountId, tx);
      assertPerFileLimit(bytes, quota.perFileMaxBytes);
      if (existing) {
        assertFileMutableIntegrity({ immutableAt: existing.immutableAt });
        const delta = bytes - existing.bytes;
        if (delta > BigInt(0)) {
          assertQuotaLimit(quota.usedBytes, delta, quota.limitBytes);
        }
      } else {
        await assertPathAvailable(accountId, path, tx);
        assertQuotaLimit(quota.usedBytes, bytes, quota.limitBytes);
      }

      const fileId = existing?.id || crypto.randomUUID();
      const objectKey = existing?.r2Key || workspaceR2ObjectKey(accountId, fileId, name);
      uploadedObjectKey = objectKey;
      createdNew = !existing;

      await putCavsafeObject({
        objectKey,
        body,
        contentType: mimeType,
        contentLength: body.byteLength,
      });

      const savedFile = existing
        ? await tx.cavSafeFile.update({
          where: { id: existing.id },
          data: {
            folderId: folder.id,
            name,
            path,
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
        : await tx.cavSafeFile.create({
          data: {
            id: fileId,
            accountId,
            folderId: folder.id,
            name,
            path,
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

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
}) {
  const accountId = String(args.accountId || "").trim();
  const fileId = String(args.fileId || "").trim();
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!fileId) throw new CavSafeError("FILE_ID_REQUIRED", 400);

  const body = Buffer.isBuffer(args.body) ? args.body : Buffer.from(args.body);
  const inputMimeType = String(args.mimeType || "").trim();
  const bytes = BigInt(body.byteLength);
  const sha256 = crypto.createHash("sha256").update(body).digest("hex");

  const updated = await prisma.$transaction(async (tx) => {
    const file = await tx.cavSafeFile.findFirst({
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
        immutableAt: true,
      },
    });
    if (!file) throw new CavSafeError("FILE_NOT_FOUND", 404);
    assertFileMutableIntegrity({ immutableAt: file.immutableAt });
    const mimeType = preferredMimeType({
      providedMimeType: inputMimeType,
      fileName: file.name,
    }) || "application/octet-stream";
    const previewUpdate = previewSnippetUpdateFromBytes(
      file.name,
      mimeType,
      body.subarray(0, PREVIEW_SNIPPET_RANGE_BYTES),
    );

    const quota = await quotaSnapshot(accountId, tx);
    assertPerFileLimit(bytes, quota.perFileMaxBytes);
    const delta = bytes - file.bytes;
    if (delta > BigInt(0)) {
      assertQuotaLimit(quota.usedBytes, delta, quota.limitBytes);
    }

    await putCavsafeObject({
      objectKey: file.r2Key,
      body,
      contentType: mimeType,
      contentLength: body.byteLength,
    });

    const savedFile = await tx.cavSafeFile.update({
      where: { id: file.id },
      data: {
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
      action: "file.update",
      targetType: "file",
      targetId: savedFile.id,
      targetPath: savedFile.path,
      metaJson: {
        edited: true,
        bytes: savedFile.bytes.toString(),
        mimeType,
        usedBytes: usedBytes.toString(),
      },
    });

    return savedFile;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return mapFile(updated);
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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!fileId) throw new CavSafeError("FILE_ID_REQUIRED", 400);

  const updated = await prisma.$transaction(async (tx) => {
    const file = await tx.cavSafeFile.findFirst({
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
        immutableAt: true,
      },
    });

    if (!file) throw new CavSafeError("FILE_NOT_FOUND", 404);
    assertFileMutableIntegrity({ immutableAt: file.immutableAt });

    let targetFolder = await tx.cavSafeFolder.findFirst({
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
    if (!targetFolder) throw new CavSafeError("FOLDER_NOT_FOUND", 404);

    if (args.folderId !== undefined) {
      const folderId = String(args.folderId || "").trim();
      if (!folderId) throw new CavSafeError("FOLDER_ID_REQUIRED", 400);
      const nextFolder = await tx.cavSafeFolder.findFirst({
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
      if (!nextFolder) throw new CavSafeError("FOLDER_NOT_FOUND", 404);
      targetFolder = nextFolder;
    }

    const nextName = args.name ? safeNodeName(args.name) : file.name;
    const nextPath = joinPath(targetFolder.path, nextName);
    await assertPathAvailable(accountId, nextPath, tx, { fileId: file.id });

    const updatedFile = await tx.cavSafeFile.update({
      where: { id: file.id },
      data: {
        name: nextName,
        folderId: targetFolder.id,
        path: nextPath,
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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!fileId) throw new CavSafeError("FILE_ID_REQUIRED", 400);

  const plan = await prisma.$transaction(async (tx) => {
    const source = await tx.cavSafeFile.findFirst({
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
    if (!source) throw new CavSafeError("FILE_NOT_FOUND", 404);

    const folder = await tx.cavSafeFolder.findFirst({
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
    if (!folder) throw new CavSafeError("FOLDER_NOT_FOUND", 404);

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
    const duplicateKey = workspaceR2ObjectKey(accountId, duplicateId, next.name);

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

      const file = await tx.cavSafeFile.create({
        data: {
          id: plan.duplicateId,
          accountId,
          folderId: plan.folder.id,
          name: plan.duplicateName,
          path: plan.duplicatePath,
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!fileId) throw new CavSafeError("FILE_ID_REQUIRED", 400);

  const source = await prisma.cavSafeFile.findFirst({
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
  if (!source) throw new CavSafeError("FILE_NOT_FOUND", 404);

  const folder = await prisma.cavSafeFolder.findFirst({
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
  if (!folder) throw new CavSafeError("FOLDER_NOT_FOUND", 404);

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
    const zippedKey = workspaceR2ObjectKey(accountId, zippedId, next.name);
    return {
      zippedId,
      zippedKey,
      zippedName: next.name,
      zippedPath: next.path,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await putCavsafeObject({
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

      const file = await tx.cavSafeFile.create({
        data: {
          id: plan.zippedId,
          accountId,
          folderId: folder.id,
          name: plan.zippedName,
          path: plan.zippedPath,
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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!folderId) throw new CavSafeError("FOLDER_ID_REQUIRED", 400);

  const folder = await prisma.cavSafeFolder.findFirst({
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
  if (!folder) throw new CavSafeError("FOLDER_NOT_FOUND", 404);

  const parent = folder.parentId
    ? await prisma.cavSafeFolder.findFirst({
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
  if (!parent) throw new CavSafeError("FOLDER_NOT_FOUND", 404);

  const files = await prisma.cavSafeFile.findMany({
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
    throw new CavSafeError("ZIP_SOURCE_TOO_LARGE", 413, "folder archive exceeds configured size limit");
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
  const baseName = folder.path === "/" ? "cavsafe-root" : folder.name;

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
    const zippedKey = workspaceR2ObjectKey(accountId, zippedId, next.name);
    return {
      zippedId,
      zippedKey,
      zippedName: next.name,
      zippedPath: next.path,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await putCavsafeObject({
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

      const file = await tx.cavSafeFile.create({
        data: {
          id: plan.zippedId,
          accountId,
          folderId: parent.id,
          name: plan.zippedName,
          path: plan.zippedPath,
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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!fileId) throw new CavSafeError("FILE_ID_REQUIRED", 400);
  const trashPolicy = await resolveTrashRetentionPolicy(accountId, args.operatorUserId || null);

  try {
    await runSerializableTxWithRetry(() => prisma.$transaction(async (tx) => {
      const file = await tx.cavSafeFile.findFirst({
        where: {
          id: fileId,
          accountId,
          deletedAt: null,
        },
        select: {
          id: true,
          path: true,
          immutableAt: true,
        },
      });

      if (!file) throw new CavSafeError("FILE_NOT_FOUND", 404);
      assertFileMutableIntegrity({ immutableAt: file.immutableAt });

      const now = new Date();

      await tx.cavSafeFile.update({
        where: { id: file.id },
        data: {
          deletedAt: now,
        },
      });

      await tx.cavSafeTrash.create({
        data: {
          accountId,
          fileId: file.id,
          deletedAt: now,
          purgeAfter: nowPlusDays(trashPolicy.trashRetentionDays),
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
      throw new CavSafeError("TX_CONFLICT", 409, "Temporary file write conflict. Please retry.");
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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!trashId) throw new CavSafeError("TRASH_ID_REQUIRED", 400);

  const restored = await prisma.$transaction(async (tx) => {
    const trash = await tx.cavSafeTrash.findFirst({
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

    if (!trash) throw new CavSafeError("TRASH_NOT_FOUND", 404);

    if (trash.fileId) {
      const file = await tx.cavSafeFile.findFirst({
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
        await tx.cavSafeTrash.delete({ where: { id: trash.id } });
        return { kind: "file" as const, restoredId: null };
      }

      if (file.deletedAt) {
        await assertPathAvailable(accountId, file.path, tx, { fileId: file.id });
        await tx.cavSafeFile.update({ where: { id: file.id }, data: { deletedAt: null } });
      }

      await tx.cavSafeTrash.delete({ where: { id: trash.id } });
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
      const folder = await tx.cavSafeFolder.findFirst({
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
        await tx.cavSafeTrash.delete({ where: { id: trash.id } });
        return { kind: "folder" as const, restoredId: null };
      }

      if (folder.deletedAt) {
        await assertPathAvailable(accountId, folder.path, tx, { folderId: folder.id });

        await tx.cavSafeFolder.updateMany({
          where: {
            accountId,
            OR: [{ path: folder.path }, { path: scopePaths(folder.path) }],
          },
          data: {
            deletedAt: null,
          },
        });

        await tx.cavSafeFile.updateMany({
          where: {
            accountId,
            OR: [{ path: folder.path }, { path: scopePaths(folder.path) }],
          },
          data: {
            deletedAt: null,
          },
        });
      }

      await tx.cavSafeTrash.delete({ where: { id: trash.id } });
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

    await tx.cavSafeTrash.delete({ where: { id: trash.id } });
    return { kind: "unknown" as const, restoredId: null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return restored;
}

async function deleteObjectKeysBestEffort(keys: string[]) {
  for (const key of keys) {
    try {
      await deleteCavsafeObject(key);
    } catch {
      // Keep deleting remaining keys, then rely on DB consistency on next retries.
    }
  }
}

async function deleteObjectKeysStrict(keys: string[]) {
  for (const key of keys) {
    try {
      await deleteCavsafeObject(key);
    } catch {
      throw new CavSafeError("R2_DELETE_FAILED", 502, "Failed to delete one or more objects from storage");
    }
  }
}

export async function permanentlyDeleteTrashEntry(args: {
  accountId: string;
  trashId: string;
  operatorUserId?: string | null;
  reason?: string;
}) {
  const accountId = String(args.accountId || "").trim();
  const trashId = String(args.trashId || "").trim();
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!trashId) throw new CavSafeError("TRASH_ID_REQUIRED", 400);

  const trash = await prisma.cavSafeTrash.findFirst({
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
  if (!trash) throw new CavSafeError("TRASH_NOT_FOUND", 404);

  if (trash.fileId) {
    const file = await prisma.cavSafeFile.findFirst({
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
      await tx.cavSafeTrash.deleteMany({ where: { accountId, fileId: trash.fileId } });
      if (file) await tx.cavSafeFile.delete({ where: { id: file.id } });
      const usedBytes = await refreshQuota(accountId, tx);
      await recordStorageHistoryPoint(tx, { accountId, usedBytes });
      await writeActivity(tx, {
        accountId,
        operatorUserId: args.operatorUserId,
        action: "trash.permanent_delete",
        targetType: "file",
        targetId: file?.id || trash.fileId,
        targetPath: file?.path || null,
        metaJson: { reason: args.reason || "manual", usedBytes: usedBytes.toString() },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { ok: true } as const;
  }

  if (trash.folderId) {
    const folder = await prisma.cavSafeFolder.findFirst({
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
      await prisma.cavSafeTrash.delete({ where: { id: trash.id } });
      return { ok: true } as const;
    }
    if (isOfficialSyncedSystemPath(folder.path)) {
      throw new CavSafeError("SYSTEM_FOLDER_IMMUTABLE", 400, "System synced folders are immutable.");
    }

    const folderScope: Prisma.CavSafeFolderWhereInput = {
      accountId,
      OR: [{ path: folder.path }, { path: scopePaths(folder.path) }],
    };

    const fileScope: Prisma.CavSafeFileWhereInput = {
      accountId,
      OR: [{ path: folder.path }, { path: scopePaths(folder.path) }],
    };

    const [folderRows, fileRows] = await Promise.all([
      prisma.cavSafeFolder.findMany({ where: folderScope, select: { id: true, path: true } }),
      prisma.cavSafeFile.findMany({ where: fileScope, select: { id: true, path: true, r2Key: true } }),
    ]);

    await deleteObjectKeysStrict(fileRows.map((f) => f.r2Key));

    const folderIds = folderRows.map((r) => r.id);
    const fileIds = fileRows.map((r) => r.id);

    await prisma.$transaction(async (tx) => {
      await tx.cavSafeMultipartPart.deleteMany({
        where: {
          upload: {
            accountId,
            folderId: { in: folderIds },
          },
        },
      });

      await tx.cavSafeMultipartUpload.deleteMany({
        where: {
          accountId,
          folderId: { in: folderIds },
        },
      });

      await tx.cavSafeTrash.deleteMany({
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
        await tx.cavSafeFile.deleteMany({ where: { id: { in: fileIds } } });
      }

      await tx.cavSafeFolder.deleteMany({
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
          reason: args.reason || "manual",
          removedFiles: fileIds.length,
          removedFolders: folderIds.length,
          usedBytes: usedBytes.toString(),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { ok: true } as const;
  }

  await prisma.cavSafeTrash.delete({ where: { id: trash.id } });
  return { ok: true } as const;
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
}) {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);

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
  const objectKey = workspaceR2ObjectKey(accountId, fileId, fileName);

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
      putCavsafeObjectStream({
        objectKey,
        body: pass,
        contentType: mimeType,
        contentLength: contentLength ?? undefined,
      }),
      pipeline(input, meter, pass),
    ]);
  } catch (err) {
    await deleteObjectKeysBestEffort([objectKey]);
    if (err instanceof CavSafeError) throw err;
    throw new CavSafeError("UPLOAD_FAILED", 500);
  }

  const sha256 = hash.digest("hex");
  const previewSnippet = previewSnippetFromChunkParts(previewChunks, previewChunkBytes, fileName, mimeType);
  const previewSnippetUpdatedAt = new Date();

  try {
    const created = await prisma.$transaction(async (tx) => {
      await assertPathAvailable(accountId, path, tx);
      const q = await quotaSnapshot(accountId, tx);
      assertPerFileLimit(byteCount, q.perFileMaxBytes);
      assertQuotaLimit(q.usedBytes, byteCount, q.limitBytes);

      const file = await tx.cavSafeFile.create({
        data: {
          id: fileId,
          accountId,
          folderId: folder.id,
          name: fileName,
          path,
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
    if (err instanceof CavSafeError) throw err;
    const code = String((err as { code?: unknown })?.code || "");
    if (code === "P2002") throw new CavSafeError("PATH_CONFLICT", 409);
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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);

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
  });

  const path = joinPath(folder.path, fileName);
  await assertPathAvailable(accountId, path);

  const usage = await quotaSnapshot(accountId);
  if (expectedBytes != null) {
    assertPerFileLimit(expectedBytes, usage.perFileMaxBytes);
    assertQuotaLimit(usage.usedBytes, expectedBytes, usage.limitBytes);

    const partsNeeded = Math.ceil(Number(expectedBytes) / partSizeBytes);
    if (partsNeeded > MAX_MULTIPART_PARTS) {
      throw new CavSafeError("MULTIPART_TOO_MANY_PARTS", 400);
    }
  }

  const objectFileId = crypto.randomUUID();
  const objectKey = workspaceR2ObjectKey(accountId, objectFileId, fileName);

  const created = await createCavsafeMultipartUpload({
    objectKey,
    contentType: mimeType,
  });

  const session = await prisma.cavSafeMultipartUpload.create({
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

  await prisma.cavSafeActivity.create({
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

  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!uploadId) throw new CavSafeError("UPLOAD_ID_REQUIRED", 400);
  if (!Number.isFinite(partNumber) || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_MULTIPART_PARTS) {
    throw new CavSafeError("PART_NUMBER_INVALID", 400);
  }

  const upload = await prisma.cavSafeMultipartUpload.findFirst({
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

  if (!upload) throw new CavSafeError("UPLOAD_NOT_FOUND", 404);
  if (new Date(upload.expiresAt).getTime() <= Date.now()) {
    throw new CavSafeError("UPLOAD_EXPIRED", 410);
  }

  if (args.body.length > upload.partSizeBytes) {
    throw new CavSafeError("PART_TOO_LARGE", 413);
  }

  const sha256 = crypto.createHash("sha256").update(args.body).digest("hex");

  const uploaded = await uploadCavsafeMultipartPart({
    objectKey: upload.r2Key,
    uploadId: upload.r2UploadId,
    partNumber,
    body: args.body,
    contentLength: args.body.length,
  });

  await prisma.cavSafeMultipartPart.upsert({
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

  await prisma.cavSafeActivity.create({
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
}) {
  const accountId = String(args.accountId || "").trim();
  const uploadId = String(args.uploadId || "").trim();
  const sha256 = String(args.sha256 || "").trim().toLowerCase();

  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!uploadId) throw new CavSafeError("UPLOAD_ID_REQUIRED", 400);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new CavSafeError("SHA256_REQUIRED", 400);

  const upload = await prisma.cavSafeMultipartUpload.findFirst({
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
  if (!upload) throw new CavSafeError("UPLOAD_NOT_FOUND", 404);
  if (new Date(upload.expiresAt).getTime() <= Date.now()) throw new CavSafeError("UPLOAD_EXPIRED", 410);

  const parts = await prisma.cavSafeMultipartPart.findMany({
    where: { uploadId: upload.id },
    orderBy: { partNumber: "asc" },
    select: {
      partNumber: true,
      etag: true,
      bytes: true,
    },
  });

  if (!parts.length) throw new CavSafeError("MULTIPART_NO_PARTS", 400);

  await completeCavsafeMultipartUpload({
    objectKey: upload.r2Key,
    uploadId: upload.r2UploadId,
    parts: parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
  });

  const head = await headCavsafeObject(upload.r2Key);
  if (!head) {
    throw new CavSafeError("UPLOAD_COMPLETE_MISSING_OBJECT", 500);
  }

  const bytes = BigInt(head.bytes);
  let previewSnippet: string | null = null;
  try {
    previewSnippet = await computePreviewSnippetFromObject(upload.r2Key, upload.fileName, upload.mimeType);
  } catch {
    previewSnippet = null;
  }
  const previewSnippetUpdatedAt = new Date();

  try {
    const file = await prisma.$transaction(async (tx) => {
      await assertPathAvailable(accountId, upload.filePath, tx);
      const usage = await quotaSnapshot(accountId, tx);
      assertPerFileLimit(bytes, usage.perFileMaxBytes);
      assertQuotaLimit(usage.usedBytes, bytes, usage.limitBytes);

      const fileId = crypto.randomUUID();
      const file = await tx.cavSafeFile.create({
        data: {
          id: fileId,
          accountId,
          folderId: upload.folderId,
          name: upload.fileName,
          path: upload.filePath,
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

      await tx.cavSafeMultipartUpload.update({
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

    await prisma.cavSafeMultipartUpload.updateMany({
      where: { id: upload.id, status: "CREATED" },
      data: { status: "ABORTED" },
    });

    if (err instanceof CavSafeError) throw err;
    const code = String((err as { code?: unknown })?.code || "");
    if (code === "P2002") throw new CavSafeError("PATH_CONFLICT", 409);
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
  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!uploadId) throw new CavSafeError("UPLOAD_ID_REQUIRED", 400);

  const upload = await prisma.cavSafeMultipartUpload.findFirst({
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
  if (!upload) throw new CavSafeError("UPLOAD_NOT_FOUND", 404);

  try {
    await abortCavsafeMultipartUpload({
      objectKey: upload.r2Key,
      uploadId: upload.r2UploadId,
    });
  } catch {
    // Continue and mark as aborted so UI can retry with a fresh session.
  }

  await prisma.$transaction(async (tx) => {
    await tx.cavSafeMultipartPart.deleteMany({ where: { uploadId: upload.id } });
    await tx.cavSafeMultipartUpload.update({
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
