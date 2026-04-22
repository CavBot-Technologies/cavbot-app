import "server-only";

import { prisma } from "@/lib/prisma";

type BigLike = bigint | number | string | null | undefined;

export type AdminAccountStorageSummary = {
  accountId: string;
  cloudFiles: number;
  safeFiles: number;
  cloudBytes: bigint;
  safeBytes: bigint;
  totalFiles: number;
  totalBytes: bigint;
  cloudUploadedFiles: number;
  safeUploadedFiles: number;
  uploadedFiles: number;
  cloudDeletedFiles: number;
  safeDeletedFiles: number;
  deletedFiles: number;
};

export type AdminUserStorageActivitySummary = {
  userId: string;
  uploadedFiles: number;
  deletedFiles: number;
};

function toBigInt(value: BigLike) {
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

function emptyAccountStorageSummary(accountId: string): AdminAccountStorageSummary {
  return {
    accountId,
    cloudFiles: 0,
    safeFiles: 0,
    cloudBytes: BigInt(0),
    safeBytes: BigInt(0),
    totalFiles: 0,
    totalBytes: BigInt(0),
    cloudUploadedFiles: 0,
    safeUploadedFiles: 0,
    uploadedFiles: 0,
    cloudDeletedFiles: 0,
    safeDeletedFiles: 0,
    deletedFiles: 0,
  };
}

function finalizeAccountStorageSummary(summary: AdminAccountStorageSummary): AdminAccountStorageSummary {
  const totalFiles = summary.cloudFiles + summary.safeFiles;
  const totalBytes = summary.cloudBytes + summary.safeBytes;
  const uploadedFiles = summary.cloudUploadedFiles + summary.safeUploadedFiles;
  const deletedFiles = summary.cloudDeletedFiles + summary.safeDeletedFiles;
  return {
    ...summary,
    totalFiles,
    totalBytes,
    uploadedFiles,
    deletedFiles,
  };
}

export async function getAccountStorageMap(accountIds: string[]) {
  const uniqueAccountIds = Array.from(new Set(accountIds.filter(Boolean)));
  const baseMap = new Map<string, AdminAccountStorageSummary>(
    uniqueAccountIds.map((accountId) => [accountId, emptyAccountStorageSummary(accountId)]),
  );

  if (!uniqueAccountIds.length) return baseMap;

  const [
    cloudRows,
    safeRows,
    cloudQuotaRows,
    safeQuotaRows,
    cloudUploadedRows,
    safeUploadedRows,
    cloudDeletedRows,
    safeDeletedRows,
  ] = await Promise.all([
    prisma.cavCloudFile.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: uniqueAccountIds },
        deletedAt: null,
      },
      _count: { _all: true },
      _sum: { bytes: true },
    }),
    prisma.cavSafeFile.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: uniqueAccountIds },
        deletedAt: null,
      },
      _count: { _all: true },
      _sum: { bytes: true },
    }),
    prisma.cavCloudQuota.findMany({
      where: { accountId: { in: uniqueAccountIds } },
      select: {
        accountId: true,
        usedBytes: true,
      },
    }),
    prisma.cavSafeQuota.findMany({
      where: { accountId: { in: uniqueAccountIds } },
      select: {
        accountId: true,
        usedBytes: true,
      },
    }),
    prisma.cavCloudFile.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: uniqueAccountIds },
      },
      _count: { _all: true },
    }),
    prisma.cavSafeFile.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: uniqueAccountIds },
      },
      _count: { _all: true },
    }),
    prisma.cavCloudTrash.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: uniqueAccountIds },
        fileId: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.cavSafeTrash.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: uniqueAccountIds },
        fileId: { not: null },
      },
      _count: { _all: true },
    }),
  ]);

  for (const row of cloudRows) {
    const summary = baseMap.get(row.accountId) || emptyAccountStorageSummary(row.accountId);
    summary.cloudFiles = row._count._all;
    summary.cloudBytes = toBigInt(row._sum.bytes);
    baseMap.set(row.accountId, summary);
  }

  for (const row of safeRows) {
    const summary = baseMap.get(row.accountId) || emptyAccountStorageSummary(row.accountId);
    summary.safeFiles = row._count._all;
    summary.safeBytes = toBigInt(row._sum.bytes);
    baseMap.set(row.accountId, summary);
  }

  for (const row of cloudQuotaRows) {
    const summary = baseMap.get(row.accountId) || emptyAccountStorageSummary(row.accountId);
    summary.cloudBytes = toBigInt(row.usedBytes);
    baseMap.set(row.accountId, summary);
  }

  for (const row of safeQuotaRows) {
    const summary = baseMap.get(row.accountId) || emptyAccountStorageSummary(row.accountId);
    summary.safeBytes = toBigInt(row.usedBytes);
    baseMap.set(row.accountId, summary);
  }

  for (const row of cloudUploadedRows) {
    const summary = baseMap.get(row.accountId) || emptyAccountStorageSummary(row.accountId);
    summary.cloudUploadedFiles = row._count._all;
    baseMap.set(row.accountId, summary);
  }

  for (const row of safeUploadedRows) {
    const summary = baseMap.get(row.accountId) || emptyAccountStorageSummary(row.accountId);
    summary.safeUploadedFiles = row._count._all;
    baseMap.set(row.accountId, summary);
  }

  for (const row of cloudDeletedRows) {
    const summary = baseMap.get(row.accountId) || emptyAccountStorageSummary(row.accountId);
    summary.cloudDeletedFiles = row._count._all;
    baseMap.set(row.accountId, summary);
  }

  for (const row of safeDeletedRows) {
    const summary = baseMap.get(row.accountId) || emptyAccountStorageSummary(row.accountId);
    summary.safeDeletedFiles = row._count._all;
    baseMap.set(row.accountId, summary);
  }

  for (const [accountId, summary] of baseMap) {
    baseMap.set(accountId, finalizeAccountStorageSummary(summary));
  }

  return baseMap;
}

export function sumAccountStorageSummaries(
  summaries: readonly AdminAccountStorageSummary[],
): AdminAccountStorageSummary {
  return finalizeAccountStorageSummary(
    summaries.reduce<AdminAccountStorageSummary>(
      (acc, summary) => ({
        accountId: acc.accountId,
        cloudFiles: acc.cloudFiles + summary.cloudFiles,
        safeFiles: acc.safeFiles + summary.safeFiles,
        cloudBytes: acc.cloudBytes + summary.cloudBytes,
        safeBytes: acc.safeBytes + summary.safeBytes,
        totalFiles: 0,
        totalBytes: BigInt(0),
        cloudUploadedFiles: acc.cloudUploadedFiles + summary.cloudUploadedFiles,
        safeUploadedFiles: acc.safeUploadedFiles + summary.safeUploadedFiles,
        uploadedFiles: 0,
        cloudDeletedFiles: acc.cloudDeletedFiles + summary.cloudDeletedFiles,
        safeDeletedFiles: acc.safeDeletedFiles + summary.safeDeletedFiles,
        deletedFiles: 0,
      }),
      emptyAccountStorageSummary("aggregate"),
    ),
  );
}

export async function getUserStorageActivityMap(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const baseMap = new Map<string, AdminUserStorageActivitySummary>(
    uniqueUserIds.map((userId) => [userId, { userId, uploadedFiles: 0, deletedFiles: 0 }]),
  );

  if (!uniqueUserIds.length) return baseMap;

  const [cloudUploads, safeUploads, cloudDeletes, safeDeletes] = await Promise.all([
    prisma.cavCloudOperationLog.groupBy({
      by: ["operatorUserId"],
      where: {
        operatorUserId: { in: uniqueUserIds },
        kind: { in: ["UPLOAD_FILE", "FILE_UPLOADED"] },
      },
      _count: { _all: true },
    }),
    prisma.cavSafeOperationLog.groupBy({
      by: ["operatorUserId"],
      where: {
        operatorUserId: { in: uniqueUserIds },
        kind: { in: ["UPLOAD_FILE"] },
      },
      _count: { _all: true },
    }),
    prisma.cavCloudOperationLog.groupBy({
      by: ["operatorUserId"],
      where: {
        operatorUserId: { in: uniqueUserIds },
        kind: { in: ["DELETE_FILE", "FILE_DELETED"] },
      },
      _count: { _all: true },
    }),
    prisma.cavSafeOperationLog.groupBy({
      by: ["operatorUserId"],
      where: {
        operatorUserId: { in: uniqueUserIds },
        kind: { in: ["DELETE"] },
      },
      _count: { _all: true },
    }),
  ]);

  for (const row of cloudUploads) {
    if (!row.operatorUserId) continue;
    const summary = baseMap.get(row.operatorUserId) || {
      userId: row.operatorUserId,
      uploadedFiles: 0,
      deletedFiles: 0,
    };
    summary.uploadedFiles += row._count._all;
    baseMap.set(row.operatorUserId, summary);
  }

  for (const row of safeUploads) {
    if (!row.operatorUserId) continue;
    const summary = baseMap.get(row.operatorUserId) || {
      userId: row.operatorUserId,
      uploadedFiles: 0,
      deletedFiles: 0,
    };
    summary.uploadedFiles += row._count._all;
    baseMap.set(row.operatorUserId, summary);
  }

  for (const row of cloudDeletes) {
    if (!row.operatorUserId) continue;
    const summary = baseMap.get(row.operatorUserId) || {
      userId: row.operatorUserId,
      uploadedFiles: 0,
      deletedFiles: 0,
    };
    summary.deletedFiles += row._count._all;
    baseMap.set(row.operatorUserId, summary);
  }

  for (const row of safeDeletes) {
    if (!row.operatorUserId) continue;
    const summary = baseMap.get(row.operatorUserId) || {
      userId: row.operatorUserId,
      uploadedFiles: 0,
      deletedFiles: 0,
    };
    summary.deletedFiles += row._count._all;
    baseMap.set(row.operatorUserId, summary);
  }

  return baseMap;
}
