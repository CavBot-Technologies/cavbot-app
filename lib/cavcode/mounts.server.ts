import "server-only";

import crypto from "crypto";

import type { CavCloudMountMode } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export class CavCodeMountError extends Error {
  code: string;
  status: number;

  constructor(code: string, status = 400, message?: string) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

export type CavCodeMountSourceType = "CAVCLOUD" | "CAVSAFE";

type DbMount = {
  id: string;
  accountId: string;
  projectId: number;
  folderId: string;
  sourceType: CavCodeMountSourceType;
  mountPath: string;
  mode: CavCloudMountMode;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
  folder: {
    id: string;
    path: string;
    deletedAt: Date | null;
  } | null;
};

type ResolvedMountedFile = {
  sourceType: CavCodeMountSourceType;
  fileId: string;
  r2Key: string;
  mimeType: string;
  bytes: bigint;
  sha256: string;
  cacheHintSeconds: number;
};

function normalizeSlashes(raw: string): string {
  return raw.replace(/\/+/g, "/");
}

function decodePathSegments(raw: string, code: string, message: string): string {
  const parts = String(raw || "").split("/");
  return parts
    .map((part) => {
      if (!part) return "";
      if (/%2f|%5c/i.test(part)) {
        throw new CavCodeMountError(code, 400, message);
      }
      try {
        return decodeURIComponent(part);
      } catch {
        throw new CavCodeMountError(code, 400, message);
      }
    })
    .join("/");
}

function hasTraversalSegments(path: string): boolean {
  return path.split("/").some((segment) => segment === "." || segment === "..");
}

export function normalizeMountSourceType(raw: unknown): CavCodeMountSourceType {
  const normalized = String(raw || "")
    .trim()
    .toUpperCase();
  if (!normalized || normalized === "CAVCLOUD") return "CAVCLOUD";
  if (normalized === "CAVSAFE") return "CAVSAFE";
  throw new CavCodeMountError("MOUNT_SOURCE_TYPE_INVALID", 400, "sourceType must be CAVCLOUD or CAVSAFE.");
}

export function normalizeMountPath(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new CavCodeMountError("MOUNT_PATH_REQUIRED", 400, "mountPath is required");
  if (!trimmed.startsWith("/")) throw new CavCodeMountError("MOUNT_PATH_INVALID", 400, "mountPath must start with '/'");
  if (trimmed.includes("..")) throw new CavCodeMountError("MOUNT_PATH_INVALID", 400, "mountPath cannot contain '..'");
  if (trimmed.includes("//")) throw new CavCodeMountError("MOUNT_PATH_INVALID", 400, "mountPath cannot contain '//'");

  let normalized = normalizeSlashes(trimmed);
  if (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (normalized.length > 512) normalized = normalized.slice(0, 512);
  if (!normalized) throw new CavCodeMountError("MOUNT_PATH_INVALID", 400);
  return normalized;
}

export function normalizeResolverPath(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new CavCodeMountError("PATH_REQUIRED", 400, "path is required");
  if (!trimmed.startsWith("/")) throw new CavCodeMountError("PATH_INVALID", 400, "path must start with '/'");
  const decoded = decodePathSegments(trimmed, "PATH_INVALID", "path is invalid");
  if (decoded.includes("\\")) throw new CavCodeMountError("PATH_INVALID", 400, "path cannot contain '\\'");
  if (decoded.includes("\u0000")) throw new CavCodeMountError("PATH_INVALID", 400, "path cannot contain null bytes");
  if (decoded.includes("//")) throw new CavCodeMountError("PATH_INVALID", 400, "path cannot contain '//'");
  if (hasTraversalSegments(decoded)) throw new CavCodeMountError("PATH_INVALID", 400, "path cannot contain traversal segments");

  let normalized = normalizeSlashes(decoded);
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized || "/";
}

function normalizeRelPath(raw: string): string {
  const trimmed = String(raw || "").trim();
  const withoutLeading = trimmed.replace(/^\/+/, "");
  if (!withoutLeading) return "";

  const decoded = decodePathSegments(withoutLeading, "PATH_INVALID", "path is invalid");
  if (decoded.includes("\\")) throw new CavCodeMountError("PATH_INVALID", 400, "path cannot contain '\\'");
  if (decoded.includes("\u0000")) throw new CavCodeMountError("PATH_INVALID", 400, "path cannot contain null bytes");
  if (decoded.includes("//")) throw new CavCodeMountError("PATH_INVALID", 400, "path cannot contain '//'");
  if (hasTraversalSegments(decoded)) throw new CavCodeMountError("PATH_INVALID", 400, "path cannot contain traversal segments");

  let normalized = normalizeSlashes(decoded).replace(/^\/+/, "");
  if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
}

function relPathHasExtension(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath);
  if (!normalized) return false;
  const leaf = normalized.split("/").filter(Boolean).pop() || "";
  return /\.[A-Za-z0-9_-]{1,16}$/.test(leaf);
}

function buildLookupRelPathCandidates(relPath: string, htmlFallback = false): string[] {
  const normalized = normalizeRelPath(relPath);
  const ordered = new Set<string>();
  const push = (candidate: string) => {
    const clean = normalizeRelPath(candidate);
    if (!clean) return;
    ordered.add(clean);
  };

  if (!normalized) {
    if (htmlFallback) {
      push("index.html");
      push("index.htm");
    }
    return Array.from(ordered);
  }

  push(normalized);
  if (!htmlFallback || relPathHasExtension(normalized)) {
    return Array.from(ordered);
  }

  push(`${normalized}.html`);
  push(`${normalized}.htm`);
  push(`${normalized}/index.html`);
  push(`${normalized}/index.htm`);
  return Array.from(ordered);
}

function isPrefixMatch(mountPath: string, requestPath: string): boolean {
  if (mountPath === "/") return requestPath.startsWith("/");
  return requestPath === mountPath || requestPath.startsWith(`${mountPath}/`);
}

function relPathWithinMount(mountPath: string, requestPath: string): string {
  if (mountPath === "/") return normalizeRelPath(requestPath);
  if (!isPrefixMatch(mountPath, requestPath)) return "";
  if (requestPath === mountPath) return "";
  return normalizeRelPath(requestPath.slice(mountPath.length));
}

function compareMountPrecedence(a: DbMount, b: DbMount): number {
  const byLen = b.mountPath.length - a.mountPath.length;
  if (byLen !== 0) return byLen;
  const byPriority = b.priority - a.priority;
  if (byPriority !== 0) return byPriority;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

function pickWinningMount(mounts: DbMount[], requestPath: string): DbMount | null {
  const candidates = mounts.filter((mount) => isPrefixMatch(mount.mountPath, requestPath));
  if (!candidates.length) return null;

  candidates.sort(compareMountPrecedence);
  return candidates[0] || null;
}

function fullPathFromFolderAndRel(folderPath: string, relPath: string): string {
  const root = folderPath === "/" ? "" : folderPath.replace(/\/+$/, "");
  const rel = normalizeRelPath(relPath);
  if (!rel) return folderPath;
  return normalizeResolverPath(`${root}/${rel}`);
}

function inferSourceTypeFromObjectKey(objectKey: string): CavCodeMountSourceType {
  const key = String(objectKey || "")
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase();
  if (key.startsWith("safe/") || key.startsWith("safe-archive/")) return "CAVSAFE";
  return "CAVCLOUD";
}

async function assertProjectBelongsToAccount(accountId: string, projectId: number) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      accountId,
      isActive: true,
    },
    select: { id: true },
  });
  if (!project) throw new CavCodeMountError("PROJECT_NOT_FOUND", 404, "Project not found.");
}

export async function loadProjectMounts(
  accountId: string,
  projectId: number,
  options?: { includeCavsafe?: boolean },
): Promise<DbMount[]> {
  const includeCavsafe = options?.includeCavsafe !== false;
  await assertProjectBelongsToAccount(accountId, projectId);

  const cloudMountsPromise = prisma.cavCodeProjectMount.findMany({
    where: {
      accountId,
      projectId,
    },
    orderBy: [
      { mountPath: "desc" },
      { priority: "desc" },
      { createdAt: "asc" },
    ],
    include: {
      folder: {
        select: {
          id: true,
          path: true,
          deletedAt: true,
        },
      },
    },
  });

  const cavsafeMountsPromise = includeCavsafe
    ? prisma.cavSafeProjectMount.findMany({
        where: {
          accountId,
          projectId,
        },
        orderBy: [
          { mountPath: "desc" },
          { priority: "desc" },
          { createdAt: "asc" },
        ],
        include: {
          folder: {
            select: {
              id: true,
              path: true,
              deletedAt: true,
            },
          },
        },
      })
    : Promise.resolve([] as Array<{
        id: string;
        accountId: string;
        projectId: number;
        folderId: string;
        mountPath: string;
        mode: CavCloudMountMode;
        priority: number;
        createdAt: Date;
        updatedAt: Date;
        folder: {
          id: string;
          path: string;
          deletedAt: Date | null;
        } | null;
      }>);

  const [cloudMounts, cavsafeMounts] = await Promise.all([cloudMountsPromise, cavsafeMountsPromise]);

  const mounts: DbMount[] = [
    ...cloudMounts.map((mount) => ({
      ...mount,
      sourceType: "CAVCLOUD" as const,
    })),
    ...cavsafeMounts.map((mount) => ({
      ...mount,
      sourceType: "CAVSAFE" as const,
    })),
  ];

  mounts.sort(compareMountPrecedence);
  return mounts;
}

export async function listProjectMounts(
  accountId: string,
  projectId: number,
  options?: { includeCavsafe?: boolean },
) {
  const includeCavsafe = options?.includeCavsafe !== false;
  const mounts = await loadProjectMounts(accountId, projectId, { includeCavsafe });
  return mounts
    .filter((mount) => includeCavsafe || mount.sourceType === "CAVCLOUD")
    .filter((mount) => !!mount.folder && !mount.folder.deletedAt)
    .map((mount) => ({
      id: mount.id,
      sourceType: mount.sourceType,
      accountId: mount.accountId,
      projectId: mount.projectId,
      folderId: mount.folderId,
      mountPath: mount.mountPath,
      mode: mount.mode,
      priority: mount.priority,
      createdAtISO: mount.createdAt.toISOString(),
      updatedAtISO: mount.updatedAt.toISOString(),
    }));
}

function isStrictPrefix(a: string, b: string): boolean {
  return b.startsWith(`${a}/`);
}

function validateOverlapRules(existing: Array<{ mountPath: string; priority: number }>, incomingPath: string, incomingPriority: number) {
  for (const row of existing) {
    if (row.mountPath === incomingPath) continue;
    const overlap = isStrictPrefix(row.mountPath, incomingPath) || isStrictPrefix(incomingPath, row.mountPath);
    if (!overlap) continue;

    // Longest-prefix matching is deterministic. Require non-equal priority for explicit tie-breaking policy.
    if (row.priority === incomingPriority) {
      throw new CavCodeMountError(
        "MOUNT_OVERLAP_AMBIGUOUS",
        409,
        "Overlapping mounts require distinct priorities.",
      );
    }
  }
}

export async function upsertProjectMount(args: {
  accountId: string;
  projectId: number;
  folderId: string;
  mountPath: string;
  sourceType?: CavCodeMountSourceType;
  mode?: CavCloudMountMode;
  priority?: number;
}) {
  const accountId = String(args.accountId || "").trim();
  const projectId = Number(args.projectId);
  const folderId = String(args.folderId || "").trim();
  if (!accountId) throw new CavCodeMountError("ACCOUNT_REQUIRED", 400);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new CavCodeMountError("PROJECT_ID_INVALID", 400);
  if (!folderId) throw new CavCodeMountError("FOLDER_ID_REQUIRED", 400);

  const mountPath = normalizeMountPath(args.mountPath);
  const sourceType = normalizeMountSourceType(args.sourceType);
  const mode = args.mode === "READ_WRITE" ? "READ_WRITE" : "READ_ONLY";
  const priority = Number.isFinite(Number(args.priority)) ? Math.trunc(Number(args.priority)) : 0;

  await assertProjectBelongsToAccount(accountId, projectId);

  const folder =
    sourceType === "CAVSAFE"
      ? await prisma.cavSafeFolder.findFirst({
          where: {
            id: folderId,
            accountId,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        })
      : await prisma.cavCloudFolder.findFirst({
          where: {
            id: folderId,
            accountId,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });
  if (!folder) throw new CavCodeMountError("FOLDER_NOT_FOUND", 404, "Folder not found.");

  const [existingCloud, existingSafe] = await Promise.all([
    prisma.cavCodeProjectMount.findMany({
      where: {
        accountId,
        projectId,
      },
      select: {
        id: true,
        mountPath: true,
        priority: true,
      },
    }),
    prisma.cavSafeProjectMount.findMany({
      where: {
        accountId,
        projectId,
      },
      select: {
        id: true,
        mountPath: true,
        priority: true,
      },
    }),
  ]);

  const existing = [...existingCloud, ...existingSafe];

  validateOverlapRules(existing, mountPath, priority);

  const now = new Date();
  const mount =
    sourceType === "CAVSAFE"
      ? await prisma.cavSafeProjectMount.upsert({
          where: {
            accountId_projectId_mountPath: {
              accountId,
              projectId,
              mountPath,
            },
          },
          create: {
            id: crypto.randomUUID(),
            accountId,
            projectId,
            folderId,
            mountPath,
            mode,
            priority,
            createdAt: now,
            updatedAt: now,
          },
          update: {
            folderId,
            mode,
            priority,
            updatedAt: now,
          },
          select: {
            id: true,
            accountId: true,
            projectId: true,
            folderId: true,
            mountPath: true,
            mode: true,
            priority: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : await prisma.cavCodeProjectMount.upsert({
          where: {
            accountId_projectId_mountPath: {
              accountId,
              projectId,
              mountPath,
            },
          },
          create: {
            id: crypto.randomUUID(),
            accountId,
            projectId,
            folderId,
            mountPath,
            mode,
            priority,
            createdAt: now,
            updatedAt: now,
          },
          update: {
            folderId,
            mode,
            priority,
            updatedAt: now,
          },
          select: {
            id: true,
            accountId: true,
            projectId: true,
            folderId: true,
            mountPath: true,
            mode: true,
            priority: true,
            createdAt: true,
            updatedAt: true,
          },
        });

  return {
    sourceType,
    ...mount,
    createdAtISO: mount.createdAt.toISOString(),
    updatedAtISO: mount.updatedAt.toISOString(),
  };
}

export async function deleteProjectMount(args: {
  accountId: string;
  projectId: number;
  mountId: string;
  includeCavsafe?: boolean;
}) {
  const accountId = String(args.accountId || "").trim();
  const projectId = Number(args.projectId);
  const mountId = String(args.mountId || "").trim();
  const includeCavsafe = args.includeCavsafe !== false;
  if (!accountId) throw new CavCodeMountError("ACCOUNT_REQUIRED", 400);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new CavCodeMountError("PROJECT_ID_INVALID", 400);
  if (!mountId) throw new CavCodeMountError("MOUNT_ID_REQUIRED", 400);

  const [deletedCloud, deletedCavsafe] = await Promise.all([
    prisma.cavCodeProjectMount.deleteMany({
      where: {
        id: mountId,
        accountId,
        projectId,
      },
    }),
    includeCavsafe
      ? prisma.cavSafeProjectMount.deleteMany({
          where: {
            id: mountId,
            accountId,
            projectId,
          },
        })
      : Promise.resolve({ count: 0 }),
  ]);

  if (!deletedCloud.count && !deletedCavsafe.count) throw new CavCodeMountError("MOUNT_NOT_FOUND", 404, "Mount not found.");
  return { ok: true as const };
}

async function lookupMountedCavcloudFileByIndex(args: {
  accountId: string;
  folderId: string;
  normalizedRelPath: string;
}): Promise<ResolvedMountedFile | null> {
  const row = await prisma.cavCloudFilePathIndex.findFirst({
    where: {
      accountId: args.accountId,
      folderId: args.folderId,
      normalizedRelPath: args.normalizedRelPath,
      file: {
        accountId: args.accountId,
        deletedAt: null,
      },
    },
    select: {
      file: {
        select: {
          id: true,
          r2Key: true,
          mimeType: true,
          bytes: true,
          sha256: true,
        },
      },
    },
  });
  if (!row?.file) return null;
  return {
    sourceType: "CAVCLOUD",
    fileId: row.file.id,
    r2Key: row.file.r2Key,
    mimeType: row.file.mimeType,
    bytes: row.file.bytes,
    sha256: row.file.sha256,
    cacheHintSeconds: 300,
  };
}

async function lookupMountedCavcloudFileByPath(args: {
  accountId: string;
  folderId: string;
  folderPath: string;
  normalizedRelPath: string;
}): Promise<ResolvedMountedFile | null> {
  const fullPath = fullPathFromFolderAndRel(args.folderPath, args.normalizedRelPath);
  const file = await prisma.cavCloudFile.findFirst({
    where: {
      accountId: args.accountId,
      path: fullPath,
      deletedAt: null,
    },
    select: {
      id: true,
      r2Key: true,
      mimeType: true,
      bytes: true,
      sha256: true,
    },
  });
  if (!file) return null;

  try {
    await prisma.cavCloudFilePathIndex.upsert({
      where: {
        accountId_folderId_normalizedRelPath: {
          accountId: args.accountId,
          folderId: args.folderId,
          normalizedRelPath: args.normalizedRelPath,
        },
      },
      create: {
        id: crypto.randomUUID(),
        accountId: args.accountId,
        fileId: file.id,
        folderId: args.folderId,
        normalizedRelPath: args.normalizedRelPath,
      },
      update: {
        fileId: file.id,
      },
    });
  } catch {
    // Best effort: resolver must not fail if index backfill races.
  }

  return {
    sourceType: "CAVCLOUD",
    fileId: file.id,
    r2Key: file.r2Key,
    mimeType: file.mimeType,
    bytes: file.bytes,
    sha256: file.sha256,
    cacheHintSeconds: 300,
  };
}

async function lookupMountedCavsafeFileByPath(args: {
  accountId: string;
  folderPath: string;
  normalizedRelPath: string;
}): Promise<ResolvedMountedFile | null> {
  const fullPath = fullPathFromFolderAndRel(args.folderPath, args.normalizedRelPath);
  const file = await prisma.cavSafeFile.findFirst({
    where: {
      accountId: args.accountId,
      path: fullPath,
      deletedAt: null,
    },
    select: {
      id: true,
      r2Key: true,
      mimeType: true,
      bytes: true,
      sha256: true,
    },
  });
  if (!file) return null;
  return {
    sourceType: "CAVSAFE",
    fileId: file.id,
    r2Key: file.r2Key,
    mimeType: file.mimeType,
    bytes: file.bytes,
    sha256: file.sha256,
    cacheHintSeconds: 60,
  };
}

async function lookupMountedFileByPath(args: {
  sourceType: CavCodeMountSourceType;
  accountId: string;
  folderId: string;
  folderPath: string;
  normalizedRelPath: string;
}): Promise<ResolvedMountedFile | null> {
  if (args.sourceType === "CAVSAFE") {
    return lookupMountedCavsafeFileByPath({
      accountId: args.accountId,
      folderPath: args.folderPath,
      normalizedRelPath: args.normalizedRelPath,
    });
  }
  return lookupMountedCavcloudFileByPath({
    accountId: args.accountId,
    folderId: args.folderId,
    folderPath: args.folderPath,
    normalizedRelPath: args.normalizedRelPath,
  });
}

async function lookupMountedFileByCandidates(args: {
  sourceType: CavCodeMountSourceType;
  accountId: string;
  folderId: string;
  folderPath: string;
  relPathCandidates: string[];
}): Promise<ResolvedMountedFile | null> {
  for (const candidate of args.relPathCandidates) {
    if (args.sourceType === "CAVCLOUD") {
      const byIndex = await lookupMountedCavcloudFileByIndex({
        accountId: args.accountId,
        folderId: args.folderId,
        normalizedRelPath: candidate,
      });
      if (byIndex) return byIndex;
    }

    const byPath = await lookupMountedFileByPath({
      sourceType: args.sourceType,
      accountId: args.accountId,
      folderId: args.folderId,
      folderPath: args.folderPath,
      normalizedRelPath: candidate,
    });
    if (byPath) return byPath;
  }
  return null;
}

export async function resolveMountedFile(args: {
  accountId: string;
  projectId: number;
  requestPath: string;
  includeCavsafe?: boolean;
  htmlFallback?: boolean;
}): Promise<ResolvedMountedFile | null> {
  const accountId = String(args.accountId || "").trim();
  const projectId = Number(args.projectId);
  const includeCavsafe = args.includeCavsafe !== false;
  const htmlFallback = args.htmlFallback === true;
  if (!accountId) throw new CavCodeMountError("ACCOUNT_REQUIRED", 400);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new CavCodeMountError("PROJECT_ID_INVALID", 400);

  const requestPath = normalizeResolverPath(args.requestPath);
  const mounts = await loadProjectMounts(accountId, projectId, { includeCavsafe });
  const activeMounts = mounts.filter((mount) => mount.folder && !mount.folder.deletedAt);
  const winner = pickWinningMount(activeMounts, requestPath);
  if (winner && winner.folder) {
    const relPath = relPathWithinMount(winner.mountPath, requestPath);
    const winnerCandidates = buildLookupRelPathCandidates(relPath, htmlFallback);
    if (winnerCandidates.length) {
      const hit = await lookupMountedFileByCandidates({
        sourceType: winner.sourceType,
        accountId,
        folderId: winner.folderId,
        folderPath: winner.folder.path,
        relPathCandidates: winnerCandidates,
      });
      if (hit) return hit;
    }
  }

  // Fallback for pasted/raw HTML preview paths that omit mountPath prefixes.
  // We still stay within mounted folders and preserve deterministic precedence.
  const implicitRelPath = normalizeRelPath(requestPath);
  const implicitCandidates = buildLookupRelPathCandidates(implicitRelPath, htmlFallback);
  if (!implicitCandidates.length) return null;

  const orderedMounts = [...activeMounts].sort(compareMountPrecedence);
  for (const mount of orderedMounts) {
    if (!mount.folder) continue;
    const hit = await lookupMountedFileByCandidates({
      sourceType: mount.sourceType,
      accountId,
      folderId: mount.folderId,
      folderPath: mount.folder.path,
      relPathCandidates: implicitCandidates,
    });
    if (hit) return hit;
  }

  return null;
}

export async function ensureMountedObjectAccessible(args: {
  accountId: string;
  projectId: number;
  objectKey: string;
  sourceType?: CavCodeMountSourceType;
  includeCavsafe?: boolean;
}) {
  const accountId = String(args.accountId || "").trim();
  const projectId = Number(args.projectId);
  const objectKey = String(args.objectKey || "").trim();
  const includeCavsafe = args.includeCavsafe !== false;
  const sourceType = args.sourceType ? normalizeMountSourceType(args.sourceType) : inferSourceTypeFromObjectKey(objectKey);
  if (!accountId) throw new CavCodeMountError("ACCOUNT_REQUIRED", 400);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new CavCodeMountError("PROJECT_ID_INVALID", 400);
  if (!objectKey) throw new CavCodeMountError("OBJECT_KEY_REQUIRED", 400);

  if (sourceType === "CAVSAFE" && !includeCavsafe) {
    throw new CavCodeMountError("NOT_FOUND", 404, "File not found.");
  }

  const [file, mounts] = await Promise.all([
    sourceType === "CAVSAFE"
      ? prisma.cavSafeFile.findFirst({
          where: {
            accountId,
            r2Key: objectKey,
            deletedAt: null,
          },
          select: {
            id: true,
            path: true,
          },
        })
      : prisma.cavCloudFile.findFirst({
          where: {
            accountId,
            r2Key: objectKey,
            deletedAt: null,
          },
          select: {
            id: true,
            path: true,
          },
        }),
    loadProjectMounts(accountId, projectId, { includeCavsafe }),
  ]);

  if (!file) throw new CavCodeMountError("NOT_FOUND", 404, "File not found.");

  const activeMounts = mounts.filter(
    (mount) => mount.sourceType === sourceType && mount.folder && !mount.folder.deletedAt,
  );
  const allowed = activeMounts.some((mount) => {
    if (!mount.folder) return false;
    const root = normalizeResolverPath(mount.folder.path);
    const filePath = normalizeResolverPath(file.path);
    if (root === "/") return filePath.startsWith("/");
    return filePath === root || filePath.startsWith(`${root}/`);
  });

  if (!allowed) throw new CavCodeMountError("FORBIDDEN", 403, "Object is outside mounted scope.");
  return { ok: true as const, sourceType };
}

function pathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const root = normalizeResolverPath(rootPath);
  const candidate = normalizeResolverPath(candidatePath);
  if (root === "/") return candidate.startsWith("/");
  return candidate === root || candidate.startsWith(`${root}/`);
}

async function loadReadableStorageShare(shareId: string) {
  const now = new Date();
  const share = await prisma.cavCloudStorageShare.findFirst({
    where: {
      id: shareId,
      mode: "READ_ONLY",
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      accountId: true,
      fileId: true,
      folderId: true,
      file: {
        select: {
          id: true,
          name: true,
          path: true,
          r2Key: true,
          mimeType: true,
          bytes: true,
          sha256: true,
          deletedAt: true,
        },
      },
      folder: {
        select: {
          id: true,
          path: true,
          deletedAt: true,
        },
      },
    },
  });
  if (!share) return null;
  return share;
}

export async function resolveMountedFileForShare(args: {
  shareId: string;
  requestPath: string;
  htmlFallback?: boolean;
}): Promise<ResolvedMountedFile | null> {
  const shareId = String(args.shareId || "").trim();
  const htmlFallback = args.htmlFallback === true;
  if (!shareId) throw new CavCodeMountError("SHARE_ID_REQUIRED", 400, "shareId is required.");

  const requestPath = normalizeResolverPath(args.requestPath);
  const share = await loadReadableStorageShare(shareId);
  if (!share) return null;

  if (share.fileId && share.file && !share.file.deletedAt) {
    const byNamePath = `/${share.file.name}`;
    if (requestPath !== "/" && requestPath !== byNamePath) return null;
    return {
      sourceType: "CAVCLOUD",
      fileId: share.file.id,
      r2Key: share.file.r2Key,
      mimeType: share.file.mimeType,
      bytes: share.file.bytes,
      sha256: share.file.sha256,
      cacheHintSeconds: 300,
    };
  }

  if (!share.folderId || !share.folder || share.folder.deletedAt) return null;
  const normalizedRelPath = normalizeRelPath(requestPath);
  const relPathCandidates = buildLookupRelPathCandidates(normalizedRelPath, htmlFallback);
  if (!relPathCandidates.length) return null;

  return lookupMountedFileByCandidates({
    sourceType: "CAVCLOUD",
    accountId: share.accountId,
    folderId: share.folder.id,
    folderPath: share.folder.path,
    relPathCandidates,
  });
}

export async function ensureSharedObjectAccessible(args: {
  shareId: string;
  objectKey: string;
}) {
  const shareId = String(args.shareId || "").trim();
  const objectKey = String(args.objectKey || "").trim();
  if (!shareId) throw new CavCodeMountError("SHARE_ID_REQUIRED", 400, "shareId is required.");
  if (!objectKey) throw new CavCodeMountError("OBJECT_KEY_REQUIRED", 400, "r2Key is required.");

  const share = await loadReadableStorageShare(shareId);
  if (!share) throw new CavCodeMountError("NOT_FOUND", 404, "Share not found.");

  const file = await prisma.cavCloudFile.findFirst({
    where: {
      accountId: share.accountId,
      r2Key: objectKey,
      deletedAt: null,
    },
    select: {
      id: true,
      path: true,
    },
  });
  if (!file) throw new CavCodeMountError("NOT_FOUND", 404, "File not found.");

  if (share.fileId) {
    if (file.id !== share.fileId) {
      throw new CavCodeMountError("FORBIDDEN", 403, "Object is outside share scope.");
    }
    return { ok: true as const };
  }

  if (!share.folder || share.folder.deletedAt) {
    throw new CavCodeMountError("NOT_FOUND", 404, "Share folder not found.");
  }

  if (!pathWithinRoot(share.folder.path, file.path)) {
    throw new CavCodeMountError("FORBIDDEN", 403, "Object is outside share scope.");
  }
  return { ok: true as const };
}
