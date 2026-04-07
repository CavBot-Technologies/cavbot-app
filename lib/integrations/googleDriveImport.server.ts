import "server-only";

import crypto from "crypto";
import { PassThrough, Readable, Transform } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { pipeline } from "stream/promises";

import { CavCloudImportItemStatus, CavCloudImportSessionStatus, IntegrationProvider, Prisma } from "@prisma/client";

import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";
import { putCavcloudObjectStream } from "@/lib/cavcloud/r2.server";
import { writeCavCloudOperationLog } from "@/lib/cavcloud/operationLog.server";
import {
  appendGoogleNativeExportExtension,
  downloadGoogleDriveFileStream,
  getGoogleDriveAccessTokenForUser,
  getGoogleDriveFileMetadata,
  GoogleDriveError,
  listGoogleDriveFolderChildrenRaw,
} from "@/lib/integrations/googleDrive.server";
import { getPlanLimits, resolvePlanIdFromTier } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const GIB = BigInt(1024) * BigInt(1024) * BigInt(1024);

const DISCOVERY_CREATE_MANY_BATCH_SIZE = 400;
const SESSION_STATUS_FAILED_PAGE_SIZE_DEFAULT = 50;
const SESSION_STATUS_FAILED_PAGE_SIZE_MAX = 200;
const IMPORT_RUN_BATCH_DEFAULT = 2;
const IMPORT_RUN_BATCH_MAX = 8;
const IMPORT_AUTO_RETRY_ATTEMPTS = 2;

type FolderNode = {
  id: string;
  path: string;
};

type StorageGuard = {
  usedBytes: bigint;
  limitBytes: bigint | null;
};

type ImportSessionSummary = {
  sessionId: string;
  status: CavCloudImportSessionStatus;
  discoveredCount: number;
  importedCount: number;
  failedCount: number;
  pendingCount: number;
  updatedAtISO: string;
  completedAtISO: string | null;
};

export type CavCloudImportFailedItem = {
  id: string;
  providerPath: string;
  providerItemId: string;
  retryCount: number;
  failureCode: string | null;
  failureMessageSafe: string | null;
  updatedAtISO: string;
};

export type CavCloudImportSessionStatusPayload = {
  sessionId: string;
  status: CavCloudImportSessionStatus;
  provider: IntegrationProvider;
  targetFolderId: string;
  discoveredCount: number;
  importedCount: number;
  failedCount: number;
  pendingCount: number;
  currentItemLabel: string | null;
  failedPage: number;
  failedPageSize: number;
  failedTotal: number;
  failedItems: CavCloudImportFailedItem[];
  createdAtISO: string;
  updatedAtISO: string;
  completedAtISO: string | null;
};

function asTrimmedString(value: unknown): string {
  return String(value || "").trim();
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  return normalized > 0 ? normalized : fallback;
}

function toISO(value: Date | null | undefined): string | null {
  if (!value) return null;
  const ts = value.getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function normalizeProviderPath(raw: string): string {
  const pieces = String(raw || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => sanitizeNodeName(part))
    .filter(Boolean);
  return pieces.join("/");
}

function splitProviderPath(path: string): string[] {
  return normalizeProviderPath(path).split("/").filter(Boolean);
}

function joinProviderPath(left: string, right: string): string {
  const l = normalizeProviderPath(left);
  const r = normalizeProviderPath(right);
  if (!l) return r;
  if (!r) return l;
  return `${l}/${r}`;
}

function sanitizeNodeName(raw: unknown): string {
  const cleaned = String(raw || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Untitled";
  const reserved = cleaned === "." || cleaned === "..";
  return reserved ? "Untitled" : cleaned.slice(0, 220);
}

function normalizeAbsolutePath(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value) return "/";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  const collapsed = withSlash.replace(/\/+/g, "/");
  if (collapsed.length > 1 && collapsed.endsWith("/")) return collapsed.slice(0, -1);
  return collapsed;
}

function joinAbsolutePath(base: string, node: string): string {
  const normalizedBase = normalizeAbsolutePath(base);
  const normalizedNode = sanitizeNodeName(node);
  if (normalizedBase === "/") return normalizeAbsolutePath(`/${normalizedNode}`);
  return normalizeAbsolutePath(`${normalizedBase}/${normalizedNode}`);
}

function toRelPath(path: string): string {
  const normalized = normalizeAbsolutePath(path);
  if (normalized === "/") return "";
  return normalized.slice(1);
}

function parseBaseAndExtension(name: string): { base: string; ext: string } {
  const normalized = sanitizeNodeName(name);
  const idx = normalized.lastIndexOf(".");
  if (idx <= 0 || idx === normalized.length - 1) {
    return {
      base: normalized,
      ext: "",
    };
  }
  return {
    base: normalized.slice(0, idx),
    ext: normalized.slice(idx),
  };
}

function withCollisionSuffix(name: string, index: number): string {
  const parsed = parseBaseAndExtension(name);
  if (index <= 1) return sanitizeNodeName(name);
  const base = parsed.base || "Untitled";
  return sanitizeNodeName(`${base} (${index})${parsed.ext}`);
}

function safeFailureCode(error: unknown): string {
  const code = asTrimmedString((error as { code?: unknown })?.code).toUpperCase();
  if (!code) return "IMPORT_FAILED";
  return code.slice(0, 64);
}

function safeFailureMessage(error: unknown): string {
  const fallback = "Import failed.";
  const message = asTrimmedString((error as { message?: unknown })?.message);
  if (!message) return fallback;
  return message.slice(0, 400);
}

function safeFileNameForObjectKey(name: string): string {
  const safe = sanitizeNodeName(name)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\.]+|[_\.]+$/g, "")
    .slice(0, 180);
  return safe || "file";
}

function safeScopeSegment(raw: string): string {
  const normalized = asTrimmedString(raw)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || "scope";
}

function importObjectKey(accountId: string, fileId: string, fileName: string, userId: string): string {
  const owner = safeScopeSegment(userId || accountId);
  return `u/${owner}/${fileId}/${safeFileNameForObjectKey(fileName)}`;
}

function mapFailedRow(row: {
  id: string;
  providerPath: string;
  providerItemId: string;
  retryCount: number;
  failureCode: string | null;
  failureMessageSafe: string | null;
  updatedAt: Date;
}): CavCloudImportFailedItem {
  return {
    id: row.id,
    providerPath: row.providerPath,
    providerItemId: row.providerItemId,
    retryCount: Math.max(0, Math.trunc(Number(row.retryCount || 0)) || 0),
    failureCode: row.failureCode || null,
    failureMessageSafe: row.failureMessageSafe || null,
    updatedAtISO: toISO(row.updatedAt) || new Date(0).toISOString(),
  };
}

async function resolveStorageGuard(accountId: string): Promise<StorageGuard> {
  const [account, plan, aggregate] = await Promise.all([
    prisma.account.findUnique({
      where: { id: accountId },
      select: {
        tier: true,
        trialSeatActive: true,
        trialEndsAt: true,
      },
    }),
    getEffectiveAccountPlanContext(accountId).catch(() => null),
    prisma.cavCloudFile.aggregate({
      where: {
        accountId,
        deletedAt: null,
      },
      _sum: {
        bytes: true,
      },
    }),
  ]);

  const usedBytes = aggregate._sum.bytes ?? BigInt(0);

  const trialEndsAtMs = account?.trialEndsAt ? account.trialEndsAt.getTime() : 0;
  const trialActive = plan?.trialActive
    ?? (Boolean(account?.trialSeatActive) && Number.isFinite(trialEndsAtMs) && trialEndsAtMs > Date.now());
  if (trialActive) {
    return {
      usedBytes,
      limitBytes: null,
    };
  }

  const planId = plan?.planId ?? resolvePlanIdFromTier(account?.tier || "FREE");
  const storageGb = getPlanLimits(planId).storageGb;
  if (storageGb === "unlimited" || typeof storageGb !== "number" || !Number.isFinite(storageGb) || storageGb <= 0) {
    return {
      usedBytes,
      limitBytes: null,
    };
  }

  return {
    usedBytes,
    limitBytes: BigInt(Math.max(1, Math.trunc(storageGb))) * GIB,
  };
}

function assertStorageGuardAvailable(guard: StorageGuard, bytesAdded: bigint): void {
  if (guard.limitBytes == null) return;
  if (bytesAdded <= BigInt(0)) return;
  if (guard.usedBytes + bytesAdded > guard.limitBytes) {
    throw new GoogleDriveError("STORAGE_LIMIT_EXCEEDED", 413, "CavCloud storage limit exceeded.");
  }
}

async function updateQuotaUsedBytes(accountId: string, usedBytes: bigint): Promise<void> {
  await prisma.cavCloudQuota.upsert({
    where: { accountId },
    create: {
      accountId,
      usedBytes,
    },
    update: {
      usedBytes,
    },
  });
}

async function resolveImportSessionOrThrow(args: {
  accountId: string;
  userId: string;
  sessionId: string;
}) {
  const session = await prisma.cavCloudImportSession.findFirst({
    where: {
      id: args.sessionId,
      accountId: args.accountId,
      userId: args.userId,
      provider: IntegrationProvider.GOOGLE_DRIVE,
    },
    select: {
      id: true,
      accountId: true,
      userId: true,
      provider: true,
      targetFolderId: true,
      status: true,
      discoveredCount: true,
      importedCount: true,
      failedCount: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      targetFolder: {
        select: {
          id: true,
          path: true,
        },
      },
    },
  });

  if (!session?.id || !session.targetFolder?.id) {
    throw new GoogleDriveError("IMPORT_SESSION_NOT_FOUND", 404, "Import session not found.");
  }

  return session;
}

async function resolveTargetFolderOrThrow(args: {
  accountId: string;
  folderId: string;
}): Promise<FolderNode> {
  const folder = await prisma.cavCloudFolder.findFirst({
    where: {
      id: args.folderId,
      accountId: args.accountId,
      deletedAt: null,
    },
    select: {
      id: true,
      path: true,
    },
  });

  if (!folder?.id) {
    throw new GoogleDriveError("TARGET_FOLDER_NOT_FOUND", 404, "Target folder not found.");
  }

  return {
    id: folder.id,
    path: normalizeAbsolutePath(folder.path),
  };
}

async function ensureDestinationFolder(args: {
  accountId: string;
  targetRoot: FolderNode;
  relativeFolderSegments: string[];
  cache: Map<string, FolderNode>;
}): Promise<FolderNode> {
  const normalizedSegments = args.relativeFolderSegments.map(sanitizeNodeName).filter(Boolean);
  const cacheKey = normalizedSegments.join("/");
  if (cacheKey && args.cache.has(cacheKey)) {
    const cached = args.cache.get(cacheKey);
    if (cached) return cached;
  }

  let parent = args.targetRoot;
  if (!args.cache.has("")) {
    args.cache.set("", args.targetRoot);
  }

  let currentKey = "";
  for (const segment of normalizedSegments) {
    currentKey = currentKey ? `${currentKey}/${segment}` : segment;
    const cached = args.cache.get(currentKey);
    if (cached) {
      parent = cached;
      continue;
    }

    const nextPath = joinAbsolutePath(parent.path, segment);

    const fileConflict = await prisma.cavCloudFile.findFirst({
      where: {
        accountId: args.accountId,
        path: nextPath,
      },
      select: {
        id: true,
      },
    });
    if (fileConflict?.id) {
      throw new GoogleDriveError("PATH_CONFLICT", 409, `Path conflict at ${nextPath}.`);
    }

    const existingFolder = await prisma.cavCloudFolder.findFirst({
      where: {
        accountId: args.accountId,
        parentId: parent.id,
        name: segment,
        deletedAt: null,
      },
      select: {
        id: true,
        path: true,
      },
    });

    if (existingFolder?.id) {
      parent = {
        id: existingFolder.id,
        path: normalizeAbsolutePath(existingFolder.path),
      };
      args.cache.set(currentKey, parent);
      continue;
    }

    try {
      const created = await prisma.cavCloudFolder.create({
        data: {
          accountId: args.accountId,
          parentId: parent.id,
          name: segment,
          path: nextPath,
        },
        select: {
          id: true,
          path: true,
        },
      });

      parent = {
        id: created.id,
        path: normalizeAbsolutePath(created.path),
      };
      args.cache.set(currentKey, parent);
      continue;
    } catch (error) {
      const code = asTrimmedString((error as { code?: unknown })?.code);
      if (code !== "P2002") throw error;

      const fallbackFolder = await prisma.cavCloudFolder.findFirst({
        where: {
          accountId: args.accountId,
          path: nextPath,
          deletedAt: null,
        },
        select: {
          id: true,
          path: true,
        },
      });
      if (!fallbackFolder?.id) {
        throw new GoogleDriveError("PATH_CONFLICT", 409, `Path conflict at ${nextPath}.`);
      }

      parent = {
        id: fallbackFolder.id,
        path: normalizeAbsolutePath(fallbackFolder.path),
      };
      args.cache.set(currentKey, parent);
    }
  }

  if (cacheKey && !args.cache.has(cacheKey)) {
    args.cache.set(cacheKey, parent);
  }

  return parent;
}

async function reserveFileName(args: {
  accountId: string;
  folder: FolderNode;
  desiredName: string;
}): Promise<{ name: string; path: string }> {
  const desired = sanitizeNodeName(args.desiredName);
  for (let index = 1; index <= 1000; index += 1) {
    const candidateName = withCollisionSuffix(desired, index);
    const candidatePath = joinAbsolutePath(args.folder.path, candidateName);

    const [fileConflict, folderConflict] = await Promise.all([
      prisma.cavCloudFile.findFirst({
        where: {
          accountId: args.accountId,
          path: candidatePath,
        },
        select: {
          id: true,
        },
      }),
      prisma.cavCloudFolder.findFirst({
        where: {
          accountId: args.accountId,
          path: candidatePath,
        },
        select: {
          id: true,
        },
      }),
    ]);

    if (!fileConflict?.id && !folderConflict?.id) {
      return {
        name: candidateName,
        path: candidatePath,
      };
    }
  }

  throw new GoogleDriveError("PATH_CONFLICT", 409, "Unable to reserve destination filename.");
}

async function createOrReuseImportFileRow(args: {
  accountId: string;
  userId: string;
  itemId: string;
  existingCavCloudFileId: string | null;
  destinationFolder: FolderNode;
  desiredName: string;
  mimeType: string;
}): Promise<{
  id: string;
  folderId: string;
  path: string;
  name: string;
  r2Key: string;
  bytes: bigint;
}> {
  const existingFileId = asTrimmedString(args.existingCavCloudFileId);
  if (existingFileId) {
    const existing = await prisma.cavCloudFile.findFirst({
      where: {
        id: existingFileId,
        accountId: args.accountId,
      },
      select: {
        id: true,
        folderId: true,
        path: true,
        name: true,
        r2Key: true,
        bytes: true,
      },
    });

    if (existing?.id) {
      const updated = await prisma.cavCloudFile.update({
        where: {
          id: existing.id,
        },
        data: {
          status: "UPLOADING",
        },
        select: {
          id: true,
          folderId: true,
          path: true,
          name: true,
          r2Key: true,
          bytes: true,
        },
      });

      return {
        id: updated.id,
        folderId: updated.folderId,
        path: updated.path,
        name: updated.name,
        r2Key: updated.r2Key,
        bytes: updated.bytes,
      };
    }
  }

  const reserved = await reserveFileName({
    accountId: args.accountId,
    folder: args.destinationFolder,
    desiredName: args.desiredName,
  });

  const id = crypto.randomUUID();
  const r2Key = importObjectKey(args.accountId, id, reserved.name, args.userId);

  const created = await prisma.cavCloudFile.create({
    data: {
      id,
      accountId: args.accountId,
      folderId: args.destinationFolder.id,
      name: reserved.name,
      path: reserved.path,
      relPath: toRelPath(reserved.path),
      r2Key,
      bytes: BigInt(0),
      mimeType: asTrimmedString(args.mimeType) || "application/octet-stream",
      sha256: EMPTY_SHA256,
      status: "UPLOADING",
    },
    select: {
      id: true,
      folderId: true,
      path: true,
      name: true,
      r2Key: true,
      bytes: true,
    },
  });

  await prisma.cavCloudImportItem.update({
    where: {
      id: args.itemId,
    },
    data: {
      cavCloudFileId: created.id,
    },
  });

  return {
    id: created.id,
    folderId: created.folderId,
    path: created.path,
    name: created.name,
    r2Key: created.r2Key,
    bytes: created.bytes,
  };
}

async function uploadDriveStreamToR2(args: {
  objectKey: string;
  source: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
  storageGuard: StorageGuard;
}): Promise<{ bytes: bigint; sha256: string }> {
  const hash = crypto.createHash("sha256");
  let uploadedBytes = BigInt(0);

  const input = Readable.fromWeb(args.source as unknown as NodeReadableStream<Uint8Array>);
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      try {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        uploadedBytes += BigInt(bufferChunk.length);

        assertStorageGuardAvailable(args.storageGuard, uploadedBytes);

        hash.update(bufferChunk);
        cb(null, bufferChunk);
      } catch (error) {
        cb(error as Error);
      }
    },
  });

  const pass = new PassThrough();
  await Promise.all([
    putCavcloudObjectStream({
      objectKey: args.objectKey,
      body: pass,
      contentType: asTrimmedString(args.contentType) || "application/octet-stream",
      contentLength: args.contentLength != null ? Math.max(0, Math.trunc(args.contentLength)) : undefined,
    }),
    pipeline(input, meter, pass),
  ]);

  return {
    bytes: uploadedBytes,
    sha256: hash.digest("hex"),
  };
}

async function recomputeSessionSummary(args: {
  accountId: string;
  userId: string;
  sessionId: string;
}): Promise<ImportSessionSummary> {
  const [session, discoveredCount, importedCount, failedCount, pendingCount] = await Promise.all([
    resolveImportSessionOrThrow(args),
    prisma.cavCloudImportItem.count({
      where: {
        accountId: args.accountId,
        sessionId: args.sessionId,
        kind: "FILE",
      },
    }),
    prisma.cavCloudImportItem.count({
      where: {
        accountId: args.accountId,
        sessionId: args.sessionId,
        kind: "FILE",
        status: "IMPORTED",
      },
    }),
    prisma.cavCloudImportItem.count({
      where: {
        accountId: args.accountId,
        sessionId: args.sessionId,
        kind: "FILE",
        status: "FAILED",
      },
    }),
    prisma.cavCloudImportItem.count({
      where: {
        accountId: args.accountId,
        sessionId: args.sessionId,
        kind: "FILE",
        status: {
          in: ["PENDING", "IMPORTING"],
        },
      },
    }),
  ]);

  const discovered = Math.max(0, Math.trunc(Number(discoveredCount || 0)) || 0);
  const imported = Math.max(0, Math.trunc(Number(importedCount || 0)) || 0);
  const failed = Math.max(0, Math.trunc(Number(failedCount || 0)) || 0);
  const pending = Math.max(0, Math.trunc(Number(pendingCount || 0)) || 0);

  let nextStatus: CavCloudImportSessionStatus = "RUNNING";
  if (pending <= 0) {
    nextStatus = failed > 0 ? "FAILED" : "COMPLETED";
  }

  const updated = await prisma.cavCloudImportSession.update({
    where: {
      id: session.id,
    },
    data: {
      status: nextStatus,
      discoveredCount: discovered,
      importedCount: imported,
      failedCount: failed,
      completedAt: nextStatus === "COMPLETED" ? new Date() : null,
    },
    select: {
      id: true,
      status: true,
      discoveredCount: true,
      importedCount: true,
      failedCount: true,
      updatedAt: true,
      completedAt: true,
    },
  });

  return {
    sessionId: updated.id,
    status: updated.status,
    discoveredCount: Math.max(0, Math.trunc(Number(updated.discoveredCount || 0)) || 0),
    importedCount: Math.max(0, Math.trunc(Number(updated.importedCount || 0)) || 0),
    failedCount: Math.max(0, Math.trunc(Number(updated.failedCount || 0)) || 0),
    pendingCount: pending,
    updatedAtISO: toISO(updated.updatedAt) || new Date(0).toISOString(),
    completedAtISO: toISO(updated.completedAt),
  };
}

async function importSingleItemWithRetries(args: {
  accountId: string;
  userId: string;
  session: {
    id: string;
    targetFolder: FolderNode;
  };
  item: {
    id: string;
    providerItemId: string;
    providerPath: string;
    cavCloudFileId: string | null;
  };
  accessToken: string;
  folderCache: Map<string, FolderNode>;
  storageGuard: StorageGuard;
}): Promise<void> {
  for (let attempt = 0; attempt <= IMPORT_AUTO_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const metadata = await getGoogleDriveFileMetadata({
        accessToken: args.accessToken,
        fileId: args.item.providerItemId,
      });

      if (metadata.isFolder) {
        throw new GoogleDriveError("GOOGLE_DRIVE_ITEM_NOT_FILE", 400, "Selected Google Drive item is a folder.");
      }

      const providerSegments = splitProviderPath(args.item.providerPath);
      const fallbackName = sanitizeNodeName(metadata.name);
      const pathName = providerSegments.length ? providerSegments[providerSegments.length - 1] : fallbackName;
      const desiredName = appendGoogleNativeExportExtension(pathName || fallbackName, metadata.mimeType);
      const folderSegments = providerSegments.length > 1 ? providerSegments.slice(0, -1) : [];

      const destinationFolder = await ensureDestinationFolder({
        accountId: args.accountId,
        targetRoot: args.session.targetFolder,
        relativeFolderSegments: folderSegments,
        cache: args.folderCache,
      });

      const fileRow = await createOrReuseImportFileRow({
        accountId: args.accountId,
        userId: args.userId,
        itemId: args.item.id,
        existingCavCloudFileId: args.item.cavCloudFileId,
        destinationFolder,
        desiredName,
        mimeType: metadata.mimeType,
      });

      const download = await downloadGoogleDriveFileStream({
        accessToken: args.accessToken,
        fileId: metadata.id,
        mimeType: metadata.mimeType,
      });

      if (download.contentLength != null) {
        assertStorageGuardAvailable(args.storageGuard, BigInt(Math.max(0, Math.trunc(download.contentLength))));
      }

      const previousBytes = fileRow.bytes;
      const upload = await uploadDriveStreamToR2({
        objectKey: fileRow.r2Key,
        source: download.stream,
        contentType: download.contentType,
        contentLength: download.contentLength,
        storageGuard: args.storageGuard,
      });

      await prisma.cavCloudFile.update({
        where: {
          id: fileRow.id,
        },
        data: {
          bytes: upload.bytes,
          mimeType: download.contentType,
          sha256: upload.sha256,
          status: "READY",
          previewSnippet: null,
          previewSnippetUpdatedAt: null,
        },
      });

      const delta = upload.bytes - previousBytes;
      if (delta > BigInt(0)) {
        args.storageGuard.usedBytes += delta;
      }

      await prisma.cavCloudImportItem.update({
        where: {
          id: args.item.id,
        },
        data: {
          status: "IMPORTED",
          retryCount: attempt,
          failureCode: null,
          failureMessageSafe: null,
          cavCloudFileId: fileRow.id,
        },
      });

      return;
    } catch (error) {
      const code = safeFailureCode(error);
      const message = safeFailureMessage(error);

      await prisma.cavCloudImportItem.update({
        where: {
          id: args.item.id,
        },
        data: {
          retryCount: attempt + 1,
          ...(attempt >= IMPORT_AUTO_RETRY_ATTEMPTS
            ? {
                status: "FAILED" as CavCloudImportItemStatus,
                failureCode: code,
                failureMessageSafe: message,
              }
            : {
                status: "IMPORTING" as CavCloudImportItemStatus,
              }),
        },
      });

      const fileId = asTrimmedString(args.item.cavCloudFileId);
      if (fileId) {
        await prisma.cavCloudFile.updateMany({
          where: {
            id: fileId,
            accountId: args.accountId,
          },
          data: {
            status: "FAILED",
          },
        });
      }

      if (attempt >= IMPORT_AUTO_RETRY_ATTEMPTS) {
        await writeCavCloudOperationLog({
          accountId: args.accountId,
          operatorUserId: args.userId,
          kind: "GOOGLE_DRIVE_IMPORT_FILE_FAILED",
          subjectType: "import_item",
          subjectId: args.item.id,
          label: `Google Drive import failed: ${args.item.providerPath}`,
          meta: {
            safeCode: code,
            safeReason: message,
          } as Prisma.InputJsonValue,
        });
        return;
      }
    }
  }
}

export async function createGoogleDriveImportSession(args: {
  accountId: string;
  userId: string;
  targetFolderId: string;
  items: Array<{ id: string; type: "file" | "folder" }>;
  mode: "copy";
}): Promise<{ sessionId: string }> {
  const accountId = asTrimmedString(args.accountId);
  const userId = asTrimmedString(args.userId);
  const targetFolderId = asTrimmedString(args.targetFolderId);
  if (!accountId || !userId || !targetFolderId) {
    throw new GoogleDriveError("IMPORT_SESSION_INPUT_INVALID", 400, "Import session input is invalid.");
  }

  if (args.mode !== "copy") {
    throw new GoogleDriveError("IMPORT_MODE_UNSUPPORTED", 400, "Only copy mode is supported.");
  }

  const selections = Array.isArray(args.items)
    ? args.items
      .map((item) => ({
        id: asTrimmedString(item?.id),
        type: String(item?.type || "").toLowerCase() === "folder" ? "folder" : "file",
      }))
      .filter((item) => !!item.id)
    : [];

  if (!selections.length) {
    throw new GoogleDriveError("IMPORT_SELECTION_REQUIRED", 400, "Select at least one file or folder to import.");
  }

  const targetFolder = await resolveTargetFolderOrThrow({
    accountId,
    folderId: targetFolderId,
  });

  const { accessToken } = await getGoogleDriveAccessTokenForUser({
    accountId,
    userId,
  });

  const session = await prisma.cavCloudImportSession.create({
    data: {
      accountId,
      userId,
      provider: IntegrationProvider.GOOGLE_DRIVE,
      targetFolderId: targetFolder.id,
      status: "CREATED",
      discoveredCount: 0,
      importedCount: 0,
      failedCount: 0,
    },
    select: {
      id: true,
    },
  });

  const rowsBuffer: Prisma.CavCloudImportItemCreateManyInput[] = [];
  let discoveredFiles = 0;

  const enqueueRow = (row: Prisma.CavCloudImportItemCreateManyInput) => {
    rowsBuffer.push(row);
  };

  const flushRows = async () => {
    if (!rowsBuffer.length) return;
    const chunk = rowsBuffer.splice(0, rowsBuffer.length);
    await prisma.cavCloudImportItem.createMany({
      data: chunk,
    });
  };

  const folderQueue: Array<{ folderId: string; providerPath: string }> = [];

  for (const selection of selections) {
    const metadata = await getGoogleDriveFileMetadata({
      accessToken,
      fileId: selection.id,
    });

    const rootPath = normalizeProviderPath(metadata.name);

    if (metadata.isFolder || selection.type === "folder") {
      enqueueRow({
        id: crypto.randomUUID(),
        sessionId: session.id,
        accountId,
        providerItemId: metadata.id,
        providerPath: rootPath,
        kind: "FOLDER",
        status: "IMPORTED",
      });
      folderQueue.push({
        folderId: metadata.id,
        providerPath: rootPath,
      });
    } else {
      enqueueRow({
        id: crypto.randomUUID(),
        sessionId: session.id,
        accountId,
        providerItemId: metadata.id,
        providerPath: rootPath,
        kind: "FILE",
        status: "PENDING",
      });
      discoveredFiles += 1;
    }

    if (rowsBuffer.length >= DISCOVERY_CREATE_MANY_BATCH_SIZE) {
      await flushRows();
    }
  }

  while (folderQueue.length) {
    const current = folderQueue.shift();
    if (!current) continue;

    let pageToken: string | null = null;
    do {
      const listed = await listGoogleDriveFolderChildrenRaw({
        accessToken,
        folderId: current.folderId,
        pageToken,
        pageSize: 200,
      });

      for (const child of listed.items) {
        const childPath = joinProviderPath(current.providerPath, child.name);

        if (child.isFolder) {
          enqueueRow({
            id: crypto.randomUUID(),
            sessionId: session.id,
            accountId,
            providerItemId: child.id,
            providerPath: childPath,
            kind: "FOLDER",
            status: "IMPORTED",
          });

          folderQueue.push({
            folderId: child.id,
            providerPath: childPath,
          });
        } else {
          enqueueRow({
            id: crypto.randomUUID(),
            sessionId: session.id,
            accountId,
            providerItemId: child.id,
            providerPath: childPath,
            kind: "FILE",
            status: "PENDING",
          });
          discoveredFiles += 1;
        }

        if (rowsBuffer.length >= DISCOVERY_CREATE_MANY_BATCH_SIZE) {
          await flushRows();
        }
      }

      pageToken = listed.nextPageToken;
    } while (pageToken);
  }

  await flushRows();

  await prisma.cavCloudImportSession.update({
    where: {
      id: session.id,
    },
    data: {
      status: "RUNNING",
      discoveredCount: discoveredFiles,
      importedCount: 0,
      failedCount: 0,
      completedAt: null,
    },
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId: userId,
    kind: "GOOGLE_DRIVE_IMPORT_STARTED",
    subjectType: "import_session",
    subjectId: session.id,
    label: "Google Drive import started",
    meta: {
      provider: "GOOGLE_DRIVE",
      discoveredCount: discoveredFiles,
      targetFolderId: targetFolder.id,
    } as Prisma.InputJsonValue,
  });

  return {
    sessionId: session.id,
  };
}

export async function runGoogleDriveImportSessionBatch(args: {
  accountId: string;
  userId: string;
  sessionId: string;
  maxItems?: number;
}): Promise<ImportSessionSummary & { processedCount: number }> {
  const accountId = asTrimmedString(args.accountId);
  const userId = asTrimmedString(args.userId);
  const sessionId = asTrimmedString(args.sessionId);
  const maxItems = Math.max(1, Math.min(IMPORT_RUN_BATCH_MAX, asPositiveInt(args.maxItems, IMPORT_RUN_BATCH_DEFAULT)));

  if (!accountId || !userId || !sessionId) {
    throw new GoogleDriveError("IMPORT_SESSION_INPUT_INVALID", 400, "Import session input is invalid.");
  }

  const session = await resolveImportSessionOrThrow({
    accountId,
    userId,
    sessionId,
  });

  if (session.status === "COMPLETED" || session.status === "CANCELED") {
    const summary = await recomputeSessionSummary({ accountId, userId, sessionId });
    return {
      ...summary,
      processedCount: 0,
    };
  }

  await prisma.cavCloudImportSession.update({
    where: {
      id: session.id,
    },
    data: {
      status: "RUNNING",
      completedAt: null,
    },
  });

  let accessToken = "";
  try {
    const refreshed = await getGoogleDriveAccessTokenForUser({
      accountId,
      userId,
    });
    accessToken = refreshed.accessToken;
  } catch (error) {
    const code = safeFailureCode(error);
    const message = safeFailureMessage(error);

    const importingRows = await prisma.cavCloudImportItem.findMany({
      where: {
        accountId,
        sessionId,
        kind: "FILE",
        status: "IMPORTING",
      },
      select: {
        cavCloudFileId: true,
      },
    });
    const importingFileIds = importingRows
      .map((row) => asTrimmedString(row.cavCloudFileId))
      .filter(Boolean);
    if (importingFileIds.length) {
      await prisma.cavCloudFile.updateMany({
        where: {
          accountId,
          id: {
            in: importingFileIds,
          },
        },
        data: {
          status: "FAILED",
        },
      });
    }

    await prisma.cavCloudImportItem.updateMany({
      where: {
        accountId,
        sessionId,
        kind: "FILE",
        status: {
          in: ["PENDING", "IMPORTING"],
        },
      },
      data: {
        status: "FAILED",
        failureCode: code,
        failureMessageSafe: message,
      },
    });

    const summary = await recomputeSessionSummary({
      accountId,
      userId,
      sessionId,
    });

    await writeCavCloudOperationLog({
      accountId,
      operatorUserId: userId,
      kind: "GOOGLE_DRIVE_IMPORT_FILE_FAILED",
      subjectType: "import_session",
      subjectId: sessionId,
      label: "Google Drive import failed",
      meta: {
        safeCode: code,
        safeReason: message,
      } as Prisma.InputJsonValue,
    });

    return {
      ...summary,
      processedCount: 0,
    };
  }

  const candidateItems = await prisma.cavCloudImportItem.findMany({
    where: {
      accountId,
      sessionId,
      kind: "FILE",
      status: "PENDING",
    },
    orderBy: [
      { createdAt: "asc" },
      { id: "asc" },
    ],
    take: maxItems,
    select: {
      id: true,
      providerItemId: true,
      providerPath: true,
      cavCloudFileId: true,
    },
  });

  const targetFolder: FolderNode = {
    id: session.targetFolder.id,
    path: normalizeAbsolutePath(session.targetFolder.path),
  };

  const folderCache = new Map<string, FolderNode>([["", targetFolder]]);
  const storageGuard = await resolveStorageGuard(accountId);

  let processedCount = 0;

  for (const item of candidateItems) {
    const claimed = await prisma.cavCloudImportItem.updateMany({
      where: {
        id: item.id,
        status: "PENDING",
      },
      data: {
        status: "IMPORTING",
        failureCode: null,
        failureMessageSafe: null,
      },
    });
    if (!claimed.count) continue;

    processedCount += 1;

    await importSingleItemWithRetries({
      accountId,
      userId,
      session: {
        id: session.id,
        targetFolder,
      },
      item,
      accessToken,
      folderCache,
      storageGuard,
    });
  }

  await updateQuotaUsedBytes(accountId, storageGuard.usedBytes);

  const summary = await recomputeSessionSummary({
    accountId,
    userId,
    sessionId,
  });

  if (summary.status === "COMPLETED") {
    await writeCavCloudOperationLog({
      accountId,
      operatorUserId: userId,
      kind: "GOOGLE_DRIVE_IMPORT_COMPLETED",
      subjectType: "import_session",
      subjectId: sessionId,
      label: "Google Drive import completed",
      meta: {
        discoveredCount: summary.discoveredCount,
        importedCount: summary.importedCount,
        failedCount: summary.failedCount,
      } as Prisma.InputJsonValue,
    });
  }

  return {
    ...summary,
    processedCount,
  };
}

export async function getGoogleDriveImportSessionStatus(args: {
  accountId: string;
  userId: string;
  sessionId: string;
  failedPage?: number;
  failedPageSize?: number;
}): Promise<CavCloudImportSessionStatusPayload> {
  const accountId = asTrimmedString(args.accountId);
  const userId = asTrimmedString(args.userId);
  const sessionId = asTrimmedString(args.sessionId);

  if (!accountId || !userId || !sessionId) {
    throw new GoogleDriveError("IMPORT_SESSION_INPUT_INVALID", 400, "Import session input is invalid.");
  }

  const failedPage = Math.max(1, asPositiveInt(args.failedPage, 1));
  const failedPageSize = Math.max(
    1,
    Math.min(
      SESSION_STATUS_FAILED_PAGE_SIZE_MAX,
      asPositiveInt(args.failedPageSize, SESSION_STATUS_FAILED_PAGE_SIZE_DEFAULT),
    ),
  );
  const failedSkip = (failedPage - 1) * failedPageSize;

  const summary = await recomputeSessionSummary({
    accountId,
    userId,
    sessionId,
  });

  const [session, failedRows, failedTotal, inProgressRow] = await Promise.all([
    resolveImportSessionOrThrow({ accountId, userId, sessionId }),
    prisma.cavCloudImportItem.findMany({
      where: {
        accountId,
        sessionId,
        status: "FAILED",
        kind: "FILE",
      },
      orderBy: {
        updatedAt: "desc",
      },
      skip: failedSkip,
      take: failedPageSize,
      select: {
        id: true,
        providerPath: true,
        providerItemId: true,
        retryCount: true,
        failureCode: true,
        failureMessageSafe: true,
        updatedAt: true,
      },
    }),
    prisma.cavCloudImportItem.count({
      where: {
        accountId,
        sessionId,
        status: "FAILED",
        kind: "FILE",
      },
    }),
    prisma.cavCloudImportItem.findFirst({
      where: {
        accountId,
        sessionId,
        status: "IMPORTING",
        kind: "FILE",
      },
      orderBy: {
        updatedAt: "asc",
      },
      select: {
        providerPath: true,
      },
    }),
  ]);

  return {
    sessionId: session.id,
    status: summary.status,
    provider: session.provider,
    targetFolderId: session.targetFolderId,
    discoveredCount: summary.discoveredCount,
    importedCount: summary.importedCount,
    failedCount: summary.failedCount,
    pendingCount: summary.pendingCount,
    currentItemLabel: asTrimmedString(inProgressRow?.providerPath) || null,
    failedPage,
    failedPageSize,
    failedTotal,
    failedItems: failedRows.map(mapFailedRow),
    createdAtISO: toISO(session.createdAt) || new Date(0).toISOString(),
    updatedAtISO: summary.updatedAtISO,
    completedAtISO: summary.completedAtISO,
  };
}

export async function retryGoogleDriveImportItems(args: {
  accountId: string;
  userId: string;
  sessionId: string;
  itemId?: string | null;
}): Promise<{ retriedCount: number }> {
  const accountId = asTrimmedString(args.accountId);
  const userId = asTrimmedString(args.userId);
  const sessionId = asTrimmedString(args.sessionId);
  const itemId = asTrimmedString(args.itemId);

  if (!accountId || !userId || !sessionId) {
    throw new GoogleDriveError("IMPORT_SESSION_INPUT_INVALID", 400, "Import session input is invalid.");
  }

  await resolveImportSessionOrThrow({
    accountId,
    userId,
    sessionId,
  });

  const updated = await prisma.cavCloudImportItem.updateMany({
    where: {
      accountId,
      sessionId,
      kind: "FILE",
      status: "FAILED",
      ...(itemId ? { id: itemId } : {}),
    },
    data: {
      status: "PENDING",
      retryCount: 0,
      failureCode: null,
      failureMessageSafe: null,
    },
  });

  if (updated.count > 0) {
    await prisma.cavCloudImportSession.update({
      where: {
        id: sessionId,
      },
      data: {
        status: "RUNNING",
        completedAt: null,
      },
    });
  }

  return {
    retriedCount: Math.max(0, Number(updated.count || 0)),
  };
}
