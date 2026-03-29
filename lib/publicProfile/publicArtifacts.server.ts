import "server-only";

import { prisma } from "@/lib/prisma";
import { isBasicUsername, normalizeUsername } from "@/lib/username";

export type PublicArtifactScope = {
  id: string;
  username: string;
  ownerUserId: string;
  displayTitle: string;
  type: string;
  sourcePath: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number | null;
  sha256: string | null;
  rootFolder:
    | null
    | {
        id: string;
        accountId: string;
        path: string;
        name: string;
        parentId: string | null;
      };
};

export function normalizePublicPath(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "/";
  const withLeadingSlash = input.startsWith("/") ? input : `/${input}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, "/");
  return collapsed || "/";
}

export function normalizePublicPathNoTrailingSlash(raw: string): string {
  const normalized = normalizePublicPath(raw);
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

export function normalizeArtifactType(rawType: string, sourcePath: string, storageKey: string): string {
  const direct = String(rawType || "").trim().toUpperCase();
  if (direct) return direct;
  if (!String(storageKey || "").trim() && String(sourcePath || "").trim()) return "FOLDER";
  return "FILE";
}

export function resolveScopedPath(rootPath: string, requestedPath: string | null | undefined): string | null {
  const root = normalizePublicPathNoTrailingSlash(rootPath);
  const requested = String(requestedPath || "").trim();
  if (!requested) return root;

  const nextRaw = requested.startsWith("/") ? requested : `${root}/${requested}`;
  const next = normalizePublicPathNoTrailingSlash(nextRaw);
  if (next === root) return next;
  if (root === "/") return next;
  if (next.startsWith(`${root}/`)) return next;
  return null;
}

export async function resolvePublicArtifactScope(args: {
  username: string;
  artifactId: string;
}): Promise<PublicArtifactScope | null> {
  const username = normalizeUsername(args.username || "");
  const artifactId = String(args.artifactId || "").trim();
  if (!username || !isBasicUsername(username) || !artifactId) return null;

  const row = await prisma.publicArtifact.findFirst({
    where: {
      id: artifactId,
      visibility: "PUBLIC_PROFILE",
      publishedAt: { not: null },
      user: {
        username,
        publicProfileEnabled: true,
        publicShowArtifacts: true,
      },
    },
    select: {
      id: true,
      displayTitle: true,
      type: true,
      sourcePath: true,
      storageKey: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      user: {
        select: {
          id: true,
          username: true,
        },
      },
    },
  });
  if (!row?.user?.id) return null;

  const sourcePath = normalizePublicPathNoTrailingSlash(String(row.sourcePath || ""));
  const storageKey = String(row.storageKey || "").trim();
  const rootType = normalizeArtifactType(String(row.type || ""), sourcePath, storageKey);

  let rootFolder: PublicArtifactScope["rootFolder"] = null;
  if (rootType === "FOLDER" && sourcePath) {
    rootFolder = await prisma.cavCloudFolder.findFirst({
      where: {
        path: sourcePath,
        deletedAt: null,
        account: {
          members: {
            some: {
              userId: row.user.id,
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        accountId: true,
        path: true,
        name: true,
        parentId: true,
      },
    });
    if (!rootFolder) return null;
  }

  return {
    id: row.id,
    username: String(row.user.username || username),
    ownerUserId: row.user.id,
    displayTitle: String(row.displayTitle || "").trim() || "Artifact",
    type: rootType,
    sourcePath,
    storageKey,
    mimeType: String(row.mimeType || "").trim(),
    sizeBytes: Number.isFinite(Number(row.sizeBytes)) ? Number(row.sizeBytes) : null,
    sha256: row.sha256 ? String(row.sha256) : null,
    rootFolder,
  };
}

