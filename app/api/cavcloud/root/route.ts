import { ApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore, withCavCloudDeadline } from "@/lib/cavcloud/http.server";
import {
  ensureCavCloudRootFolderRuntime,
  findCavCloudFolderByIdRuntime,
} from "@/lib/cavcloud/runtimeStorage.server";
import { getCavCloudSettings } from "@/lib/cavcloud/settings.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROOT_REQUEST_TIMEOUT_MS = 8_000;
const ROOT_START_FOLDER_TIMEOUT_MS = 1_500;

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

function buildStaticDegradedRootResponse() {
  return jsonNoStore(degradedRootPayload(), 200);
}

async function buildDegradedRootResponse(req: Request) {
  const sess = await requireSession(req);
  requireAccountContext(sess);
  requireUser(sess);
  return buildStaticDegradedRootResponse();
}

export async function GET(req: Request) {
  let sessionValidated = false;

  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);
    sessionValidated = true;

    const accountId = String(sess.accountId || "");
    const userId = String(sess.sub || "");

    const [root, settings] = await withCavCloudDeadline(
      Promise.all([
        ensureCavCloudRootFolderRuntime(sess.accountId),
        getCavCloudSettings({
          accountId,
          userId,
        }),
      ]),
      { timeoutMs: ROOT_REQUEST_TIMEOUT_MS, message: "Timed out loading CavCloud root." },
    );

    let defaultFolder = root;
    if (settings.startLocation === "lastFolder" && settings.lastFolderId) {
      const row = await withCavCloudDeadline(
        findCavCloudFolderByIdRuntime(accountId, settings.lastFolderId),
        { timeoutMs: ROOT_START_FOLDER_TIMEOUT_MS, message: "Timed out loading CavCloud start folder." },
      );
      if (row?.path && !isReservedSystemPath(row.path)) {
        defaultFolder = row;
      }
    } else if (settings.startLocation === "pinnedFolder" && settings.pinnedFolderId) {
      const row = await withCavCloudDeadline(
        findCavCloudFolderByIdRuntime(accountId, settings.pinnedFolderId),
        { timeoutMs: ROOT_START_FOLDER_TIMEOUT_MS, message: "Timed out loading CavCloud start folder." },
      );
      if (row?.path && !isReservedSystemPath(row.path)) {
        defaultFolder = row;
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
    if (sessionValidated) {
      return buildStaticDegradedRootResponse();
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
