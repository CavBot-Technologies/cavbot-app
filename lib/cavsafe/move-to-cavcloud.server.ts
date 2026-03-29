import "server-only";

import crypto from "crypto";
import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";

import { prisma } from "@/lib/prisma";
import { getCavsafeObjectStream } from "@/lib/cavsafe/r2.server";
import { CavSafeError, softDeleteFile as softDeleteCavsafeFile, softDeleteFolder as softDeleteCavsafeFolder } from "@/lib/cavsafe/storage.server";
import { putCavcloudObjectStream, deleteCavcloudObject } from "@/lib/cavcloud/r2.server";
import { createFileMetadata as createCavcloudFileMetadata, createFolder as createCavcloudFolder } from "@/lib/cavcloud/storage.server";

type MoveKind = "file" | "folder";

type MoveResult = {
  kind: MoveKind;
  sourceId: string;
  movedFiles: number;
  movedFolders: number;
};

function normalizePath(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "/";
  const withSlash = input.startsWith("/") ? input : `/${input}`;
  const normalized = withSlash.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function parentPath(rawPath: string): string {
  const path = normalizePath(rawPath);
  if (path === "/") return "/";
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

function joinPath(parent: string, name: string): string {
  const p = normalizePath(parent);
  const n = String(name || "").trim();
  if (!n) return p;
  if (p === "/") return normalizePath(`/${n}`);
  return normalizePath(`${p}/${n}`);
}

function sanitizeNodeName(raw: string, fallback = "item"): string {
  const cleaned = String(raw || "")
    .replace(/[\\/\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 220);
  return cleaned || fallback;
}

function safeFilenameForKey(raw: string): string {
  return String(raw || "")
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "file";
}

function cavcloudObjectKey(accountId: string, fileId: string, fileName: string): string {
  return `w/${accountId}/${fileId}/${safeFilenameForKey(fileName)}`;
}

async function ensureCloudRoot(accountId: string): Promise<{ id: string; path: string }> {
  const existing = await prisma.cavCloudFolder.findFirst({
    where: { accountId, path: "/", deletedAt: null },
    select: { id: true, path: true },
  });
  if (existing) return existing;

  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO "CavCloudFolder" ("id", "accountId", "parentId", "name", "path", "createdAt", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${accountId}, ${null}, ${"root"}, ${"/"}, ${now}, ${now})
    ON CONFLICT ("accountId", "path") DO NOTHING
  `;

  const settled = await prisma.cavCloudFolder.findFirst({
    where: { accountId, path: "/", deletedAt: null },
    select: { id: true, path: true },
  });
  if (settled) return settled;

  const fallback = await prisma.cavCloudFolder.findFirst({
    where: { accountId, path: "/" },
    select: { id: true, path: true, name: true, parentId: true, deletedAt: true },
  });
  if (!fallback) throw new CavSafeError("ROOT_FOLDER_INIT_FAILED", 500, "Failed to initialize CavCloud root folder.");

  if (fallback.deletedAt || fallback.parentId !== null || fallback.name !== "root") {
    return prisma.cavCloudFolder.update({
      where: { id: fallback.id },
      data: {
        parentId: null,
        name: "root",
        path: "/",
        deletedAt: null,
      },
      select: { id: true, path: true },
    });
  }

  return { id: fallback.id, path: fallback.path };
}

async function ensureCloudFolderPath(args: {
  accountId: string;
  operatorUserId: string;
  path: string;
}): Promise<{ id: string; path: string }> {
  const target = normalizePath(args.path);
  let current = await ensureCloudRoot(args.accountId);
  if (target === "/") return current;

  const parts = target.split("/").filter(Boolean);
  let cursorPath = "/";
  for (const partRaw of parts) {
    const part = sanitizeNodeName(partRaw, "folder");
    cursorPath = joinPath(cursorPath, part);
    const hit = await prisma.cavCloudFolder.findFirst({
      where: { accountId: args.accountId, path: cursorPath, deletedAt: null },
      select: { id: true, path: true },
    });
    if (hit) {
      current = hit;
      continue;
    }

    const created = await createCavcloudFolder({
      accountId: args.accountId,
      operatorUserId: args.operatorUserId,
      parentId: current.id,
      name: part,
    });
    current = { id: created.id, path: created.path };
  }

  return current;
}

async function cloudPathConflictExists(accountId: string, path: string): Promise<boolean> {
  const [folderHit, fileHit] = await Promise.all([
    prisma.cavCloudFolder.findFirst({
      where: { accountId, path, deletedAt: null },
      select: { id: true },
    }),
    prisma.cavCloudFile.findFirst({
      where: { accountId, path, deletedAt: null },
      select: { id: true },
    }),
  ]);
  return !!folderHit || !!fileHit;
}

async function uniqueCloudName(args: {
  accountId: string;
  parentPath: string;
  desired: string;
}): Promise<string> {
  const base = sanitizeNodeName(args.desired, "item");
  for (let idx = 0; idx < 2048; idx += 1) {
    const candidate = idx === 0 ? base : `${base} (${idx + 1})`;
    const path = joinPath(args.parentPath, candidate);
    if (!(await cloudPathConflictExists(args.accountId, path))) return candidate;
  }
  throw new CavSafeError("PATH_CONFLICT", 409, "Unable to allocate destination path in CavCloud.");
}

async function copySafeObjectToCloud(args: {
  sourceKey: string;
  destinationKey: string;
  contentType: string;
  contentLength: number | null;
}) {
  const source = await getCavsafeObjectStream({ objectKey: args.sourceKey });
  if (!source) throw new CavSafeError("FILE_NOT_FOUND", 404, "Source object missing.");

  const body = Readable.fromWeb(source.body as unknown as NodeReadableStream<Uint8Array>);
  await putCavcloudObjectStream({
    objectKey: args.destinationKey,
    body,
    contentType: args.contentType || source.contentType || "application/octet-stream",
    contentLength: Number.isFinite(args.contentLength || 0) ? Number(args.contentLength) : undefined,
  });
}

async function cleanupBestEffort(args: {
  cloudFileIds: string[];
  cloudFolderIds: string[];
  cloudObjectKeys: string[];
}) {
  try {
    if (args.cloudFileIds.length) {
      await prisma.cavCloudFile.deleteMany({ where: { id: { in: args.cloudFileIds } } });
    }
  } catch {
    // best effort
  }
  try {
    if (args.cloudFolderIds.length) {
      await prisma.cavCloudFolder.deleteMany({ where: { id: { in: args.cloudFolderIds } } });
    }
  } catch {
    // best effort
  }
  await Promise.all(
    args.cloudObjectKeys.map(async (key) => {
      try {
        await deleteCavcloudObject(key);
      } catch {
        // best effort
      }
    })
  );
}

async function moveFileToCavCloud(args: {
  accountId: string;
  operatorUserId: string;
  fileId: string;
}): Promise<MoveResult> {
  const source = await prisma.cavSafeFile.findFirst({
    where: {
      id: args.fileId,
      accountId: args.accountId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      path: true,
      r2Key: true,
      bytes: true,
      mimeType: true,
      sha256: true,
    },
  });
  if (!source) throw new CavSafeError("FILE_NOT_FOUND", 404, "Source file not found.");

  const destinationParent = await ensureCloudFolderPath({
    accountId: args.accountId,
    operatorUserId: args.operatorUserId,
    path: parentPath(source.path),
  });

  const destinationName = await uniqueCloudName({
    accountId: args.accountId,
    parentPath: destinationParent.path,
    desired: source.name,
  });

  const destinationFileId = crypto.randomUUID();
  const destinationKey = cavcloudObjectKey(args.accountId, destinationFileId, destinationName);
  const cloudFileIds: string[] = [];
  const cloudObjectKeys: string[] = [];

  try {
    await copySafeObjectToCloud({
      sourceKey: source.r2Key,
      destinationKey,
      contentType: source.mimeType,
      contentLength: Number(source.bytes),
    });
    cloudObjectKeys.push(destinationKey);

    const created = await createCavcloudFileMetadata({
      accountId: args.accountId,
      operatorUserId: args.operatorUserId,
      folderId: destinationParent.id,
      name: destinationName,
      mimeType: source.mimeType,
      bytes: Number(source.bytes),
      sha256: source.sha256,
      r2Key: destinationKey,
    });
    cloudFileIds.push(created.id);

    await softDeleteCavsafeFile({
      accountId: args.accountId,
      operatorUserId: args.operatorUserId,
      fileId: source.id,
    });

    return {
      kind: "file",
      sourceId: source.id,
      movedFiles: 1,
      movedFolders: 0,
    };
  } catch (err) {
    await cleanupBestEffort({
      cloudFileIds,
      cloudFolderIds: [],
      cloudObjectKeys,
    });
    throw err;
  }
}

async function moveFolderTreeToCavCloud(args: {
  accountId: string;
  operatorUserId: string;
  folderId: string;
}): Promise<MoveResult> {
  const sourceRoot = await prisma.cavSafeFolder.findFirst({
    where: {
      id: args.folderId,
      accountId: args.accountId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      path: true,
    },
  });
  if (!sourceRoot) throw new CavSafeError("FOLDER_NOT_FOUND", 404, "Source folder not found.");
  if (sourceRoot.path === "/") throw new CavSafeError("ROOT_FOLDER_IMMUTABLE", 400, "Root folder cannot be moved.");

  const destinationParent = await ensureCloudFolderPath({
    accountId: args.accountId,
    operatorUserId: args.operatorUserId,
    path: parentPath(sourceRoot.path),
  });
  const rootName = await uniqueCloudName({
    accountId: args.accountId,
    parentPath: destinationParent.path,
    desired: sourceRoot.name,
  });

  const queue: Array<{ sourceFolderId: string; cloudFolderId: string }> = [];
  const createdFolderIds: string[] = [];
  const createdFileIds: string[] = [];
  const copiedObjectKeys: string[] = [];
  let movedFiles = 0;
  let movedFolders = 0;

  try {
    const rootCreated = await createCavcloudFolder({
      accountId: args.accountId,
      operatorUserId: args.operatorUserId,
      parentId: destinationParent.id,
      name: rootName,
    });
    queue.push({ sourceFolderId: sourceRoot.id, cloudFolderId: rootCreated.id });
    createdFolderIds.push(rootCreated.id);
    movedFolders += 1;

    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;

      const [childFolders, childFiles] = await Promise.all([
        prisma.cavSafeFolder.findMany({
          where: {
            accountId: args.accountId,
            parentId: next.sourceFolderId,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        prisma.cavSafeFile.findMany({
          where: {
            accountId: args.accountId,
            folderId: next.sourceFolderId,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            r2Key: true,
            bytes: true,
            mimeType: true,
            sha256: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
      ]);

      for (const row of childFolders) {
        const created = await createCavcloudFolder({
          accountId: args.accountId,
          operatorUserId: args.operatorUserId,
          parentId: next.cloudFolderId,
          name: row.name,
        });
        queue.push({ sourceFolderId: row.id, cloudFolderId: created.id });
        createdFolderIds.push(created.id);
        movedFolders += 1;
      }

      for (const row of childFiles) {
        const nextFileId = crypto.randomUUID();
        const nextObjectKey = cavcloudObjectKey(args.accountId, nextFileId, row.name);
        await copySafeObjectToCloud({
          sourceKey: row.r2Key,
          destinationKey: nextObjectKey,
          contentType: row.mimeType,
          contentLength: Number(row.bytes),
        });
        copiedObjectKeys.push(nextObjectKey);

        const created = await createCavcloudFileMetadata({
          accountId: args.accountId,
          operatorUserId: args.operatorUserId,
          folderId: next.cloudFolderId,
          name: row.name,
          mimeType: row.mimeType,
          bytes: Number(row.bytes),
          sha256: row.sha256,
          r2Key: nextObjectKey,
        });
        createdFileIds.push(created.id);
        movedFiles += 1;
      }
    }

    await softDeleteCavsafeFolder({
      accountId: args.accountId,
      operatorUserId: args.operatorUserId,
      folderId: sourceRoot.id,
    });

    return {
      kind: "folder",
      sourceId: sourceRoot.id,
      movedFiles,
      movedFolders,
    };
  } catch (err) {
    await cleanupBestEffort({
      cloudFileIds: createdFileIds,
      cloudFolderIds: [...createdFolderIds].reverse(),
      cloudObjectKeys: copiedObjectKeys,
    });
    throw err;
  }
}

export async function moveFromCavSafeToCavCloud(args: {
  accountId: string;
  operatorUserId: string;
  kind: MoveKind;
  id: string;
}): Promise<MoveResult> {
  const accountId = String(args.accountId || "").trim();
  const operatorUserId = String(args.operatorUserId || "").trim();
  const id = String(args.id || "").trim();
  const kind = String(args.kind || "").trim().toLowerCase() as MoveKind;

  if (!accountId) throw new CavSafeError("ACCOUNT_REQUIRED", 400);
  if (!operatorUserId) throw new CavSafeError("OPERATOR_REQUIRED", 400);
  if (!id) throw new CavSafeError("ID_REQUIRED", 400);
  if (kind !== "file" && kind !== "folder") throw new CavSafeError("KIND_INVALID", 400);

  if (kind === "file") {
    return moveFileToCavCloud({
      accountId,
      operatorUserId,
      fileId: id,
    });
  }

  return moveFolderTreeToCavCloud({
    accountId,
    operatorUserId,
    folderId: id,
  });
}
