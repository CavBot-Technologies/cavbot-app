import { ApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavCloudSettings } from "@/lib/cavcloud/settings.server";
import { getRootFolder } from "@/lib/cavcloud/storage.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizePath(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "/";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withSlash.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function isReservedSystemPath(rawPath: string): boolean {
  const normalized = normalizePath(rawPath);
  return normalized === "/System" || normalized.startsWith("/System/");
}

function isMissingCavCloudTablesError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  if (msg.includes("does not exist") && msg.includes("cavcloud")) return true;
  if (msg.includes("relation") && msg.includes("cavcloud")) return true;
  return false;
}

function isCavCloudRootSchemaMismatch(err: unknown) {
  return isSchemaMismatchError(err, {
    tables: ["CavCloudFolder", "CavCloudSettings", "Membership"],
    columns: [
      "path",
      "name",
      "parentId",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "lastFolderId",
      "pinnedFolderId",
      "startLocation",
      "accountId",
      "userId",
    ],
  });
}

function degradedRootPayload() {
  const now = new Date().toISOString();
  const root = {
    id: "root",
    name: "root",
    path: "/",
    parentId: null,
    createdAtISO: now,
    updatedAtISO: now,
    sharedUserCount: 0,
    collaborationEnabled: false,
  };
  return {
    ok: true,
    degraded: true,
    rootFolderId: root.id,
    defaultFolderId: root.id,
    root,
    defaultFolder: root,
  };
}

async function buildDegradedRootResponse(req: Request) {
  const sess = await requireSession(req);
  requireAccountContext(sess);
  requireUser(sess);
  return jsonNoStore(degradedRootPayload(), 200);
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const root = await getRootFolder({
      accountId: sess.accountId,
    });
    const settings = await getCavCloudSettings({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
    });

    let defaultFolder = root;
    if (settings.startLocation === "lastFolder" && settings.lastFolderId) {
      const row = await prisma.cavCloudFolder.findFirst({
        where: {
          id: settings.lastFolderId,
          accountId: String(sess.accountId || ""),
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
      if (row?.path && !isReservedSystemPath(row.path)) {
        defaultFolder = {
          id: row.id,
          name: row.name,
          path: row.path,
          parentId: row.parentId || null,
          createdAtISO: new Date(row.createdAt).toISOString(),
          updatedAtISO: new Date(row.updatedAt).toISOString(),
          sharedUserCount: 0,
          collaborationEnabled: false,
        };
      }
    } else if (settings.startLocation === "pinnedFolder" && settings.pinnedFolderId) {
      const row = await prisma.cavCloudFolder.findFirst({
        where: {
          id: settings.pinnedFolderId,
          accountId: String(sess.accountId || ""),
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
      if (row?.path && !isReservedSystemPath(row.path)) {
        defaultFolder = {
          id: row.id,
          name: row.name,
          path: row.path,
          parentId: row.parentId || null,
          createdAtISO: new Date(row.createdAt).toISOString(),
          updatedAtISO: new Date(row.updatedAt).toISOString(),
          sharedUserCount: 0,
          collaborationEnabled: false,
        };
      }
    }

    return jsonNoStore({
      ok: true,
      rootFolderId: root.id,
      defaultFolderId: defaultFolder.id,
      root,
      defaultFolder,
    }, 200);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return cavcloudErrorResponse(err, "Failed to load CavCloud root.");
    }
    if (isMissingCavCloudTablesError(err) || isCavCloudRootSchemaMismatch(err)) {
      try {
        return await buildDegradedRootResponse(req);
      } catch (fallbackError) {
        return cavcloudErrorResponse(fallbackError, "Failed to load CavCloud root.");
      }
    }
    try {
      return await buildDegradedRootResponse(req);
    } catch {}
    return cavcloudErrorResponse(err, "Failed to load CavCloud root.");
  }
}
