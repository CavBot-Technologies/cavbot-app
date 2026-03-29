import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { prisma } from "@/lib/prisma";
import { getPublicArtifactViewCountsByPath } from "@/lib/publicProfile/publicArtifactViews.server";
import {
  normalizePublicPathNoTrailingSlash,
  resolvePublicArtifactScope,
  resolveScopedPath,
} from "@/lib/publicProfile/publicArtifacts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore<T>(body: T, status = 200) {
  noStore();
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function notFoundJson() {
  return jsonNoStore({ ok: false, code: "NOT_FOUND" }, 404);
}

function basename(path: string): string {
  const clean = normalizePublicPathNoTrailingSlash(path);
  if (!clean || clean === "/") return "/";
  const parts = clean.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

function toSafeNumber(value: bigint | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.trunc(value);
  }
  if (value < BigInt(0)) return 0;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  return Number(value);
}

function extOf(name: string): string {
  const raw = String(name || "").trim().toLowerCase();
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return "";
  return raw.slice(idx + 1);
}

function previewKind(mimeType: string, name: string): "image" | "video" | "text" | "code" | "unknown" {
  const mime = String(mimeType || "").trim().toLowerCase();
  const ext = extOf(name);

  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (
    mime.startsWith("text/")
    || mime === "application/json"
    || mime === "application/xml"
    || mime === "application/yaml"
  ) {
    return ["md", "json", "html", "css", "js", "ts", "tsx", "jsx", "xml", "yaml", "yml"].includes(ext) ? "code" : "text";
  }

  if (["png", "jpg", "jpeg", "webp", "avif", "gif", "svg", "bmp", "heic", "heif"].includes(ext)) return "image";
  if (["mp4", "mov", "m4v", "webm", "ogv"].includes(ext)) return "video";
  if (["md", "json", "html", "css", "js", "ts", "tsx", "jsx", "xml", "yaml", "yml"].includes(ext)) return "code";
  if (["txt", "csv", "log"].includes(ext)) return "text";
  return "unknown";
}

function buildFolderPathChain(rootPath: string, targetPath: string): string[] {
  const root = normalizePublicPathNoTrailingSlash(rootPath);
  const target = normalizePublicPathNoTrailingSlash(targetPath);
  if (root === target) return [root];

  const out: string[] = [root];
  const rootPrefix = root === "/" ? "/" : `${root}/`;
  if (!target.startsWith(rootPrefix)) return out;

  const remainder = target.slice(rootPrefix.length);
  if (!remainder) return out;

  const parts = remainder.split("/").filter(Boolean);
  let cur = root;
  for (const part of parts) {
    cur = cur === "/" ? `/${part}` : `${cur}/${part}`;
    out.push(cur);
  }
  return out;
}

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const artifactId = String(ctx?.params?.id || "").trim();
    const url = new URL(req.url);
    const username = String(url.searchParams.get("username") || "").trim();
    const requestedPath = url.searchParams.get("path");

    if (!artifactId || !username) {
      return jsonNoStore({ ok: false, code: "BAD_REQUEST", message: "id and username are required." }, 400);
    }

    const scope = await resolvePublicArtifactScope({ artifactId, username });
    if (!scope) return notFoundJson();

    if (scope.type !== "FOLDER" || !scope.rootFolder) {
      return jsonNoStore({
        ok: true,
        mode: "file",
        artifact: {
          id: scope.id,
          title: scope.displayTitle,
          type: scope.type,
          sourcePath: scope.sourcePath,
          storageKey: scope.storageKey ? "present" : "missing",
          mimeType: scope.mimeType || "application/octet-stream",
          sizeBytes: scope.sizeBytes,
          previewKind: previewKind(scope.mimeType, scope.displayTitle),
        },
      });
    }

    const targetPath = resolveScopedPath(scope.rootFolder.path, requestedPath);
    if (!targetPath) return notFoundJson();

    const targetFolder = await prisma.cavCloudFolder.findFirst({
      where: {
        accountId: scope.rootFolder.accountId,
        path: targetPath,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        path: true,
        parentId: true,
      },
    });
    if (!targetFolder) return notFoundJson();

    const [folders, files] = await Promise.all([
      prisma.cavCloudFolder.findMany({
        where: {
          accountId: scope.rootFolder.accountId,
          parentId: targetFolder.id,
          deletedAt: null,
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          path: true,
          updatedAt: true,
        },
      }),
      prisma.cavCloudFile.findMany({
        where: {
          accountId: scope.rootFolder.accountId,
          folderId: targetFolder.id,
          deletedAt: null,
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          path: true,
          mimeType: true,
          bytes: true,
          updatedAt: true,
        },
      }),
    ]);

    const viewCountsByPath = await getPublicArtifactViewCountsByPath({
      artifactId: scope.id,
      itemPaths: [
        ...folders.map((folder) => folder.path),
        ...files.map((file) => file.path),
      ],
    }).catch(() => new Map<string, number>());

    const breadcrumbPaths = buildFolderPathChain(scope.rootFolder.path, targetFolder.path);
    const breadcrumbFolders = await prisma.cavCloudFolder.findMany({
      where: {
        accountId: scope.rootFolder.accountId,
        path: { in: breadcrumbPaths },
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        path: true,
      },
    });
    const breadcrumbByPath = new Map(breadcrumbFolders.map((folder) => [normalizePublicPathNoTrailingSlash(folder.path), folder]));

    return jsonNoStore({
      ok: true,
      mode: "folder",
      artifact: {
        id: scope.id,
        title: scope.displayTitle,
        type: scope.type,
      },
      folder: {
        id: targetFolder.id,
        name: targetFolder.path === scope.rootFolder.path ? scope.displayTitle : targetFolder.name,
        path: targetFolder.path,
        rootPath: scope.rootFolder.path,
      },
      breadcrumbs: breadcrumbPaths.map((path, index) => {
        const row = breadcrumbByPath.get(normalizePublicPathNoTrailingSlash(path));
        const isRoot = index === 0;
        return {
          id: row?.id || (isRoot ? scope.rootFolder!.id : ""),
          name: isRoot ? scope.displayTitle : (row?.name || basename(path)),
          path,
          isRoot,
        };
      }),
      folders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        path: folder.path,
        updatedAtISO: new Date(folder.updatedAt).toISOString(),
        viewCount: Number(viewCountsByPath.get(normalizePublicPathNoTrailingSlash(folder.path)) || 0),
      })),
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        path: file.path,
        mimeType: String(file.mimeType || "").trim() || "application/octet-stream",
        bytes: toSafeNumber(file.bytes),
        previewKind: previewKind(String(file.mimeType || ""), file.name),
        updatedAtISO: new Date(file.updatedAt).toISOString(),
        viewCount: Number(viewCountsByPath.get(normalizePublicPathNoTrailingSlash(file.path)) || 0),
      })),
    });
  } catch {
    return jsonNoStore({ ok: false, code: "INTERNAL_ERROR" }, 500);
  }
}
