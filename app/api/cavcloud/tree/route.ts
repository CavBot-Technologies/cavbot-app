import { ApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavCloudPlanContext } from "@/lib/cavcloud/plan.server";
import { getCavCloudSettings, toCavCloudListingPreferences } from "@/lib/cavcloud/settings.server";
import { getTree, getTreeLite } from "@/lib/cavcloud/storage.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";

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

function stripReservedSystemEntriesAtRoot<T extends { folders?: Array<{ path?: string }>; files?: Array<{ path?: string }> }>(
  payload: T
): T {
  const folders = Array.isArray(payload.folders) ? payload.folders : [];
  const files = Array.isArray(payload.files) ? payload.files : [];
  return {
    ...payload,
    folders: folders.filter((item) => !isReservedSystemPath(String(item?.path || ""))),
    files: files.filter((item) => !isReservedSystemPath(String(item?.path || ""))),
  };
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

function isCavCloudTreeSchemaMismatch(err: unknown) {
  return isSchemaMismatchError(err, {
    tables: ["Account", "CavCloudFolder", "CavCloudFile", "CavCloudSettings", "Membership"],
    columns: [
      "tier",
      "trialSeatActive",
      "trialEndsAt",
      "path",
      "name",
      "parentId",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "bytes",
      "mimeType",
      "sha256",
      "status",
      "errorCode",
      "errorMessage",
      "lastFolderId",
      "pinnedFolderId",
      "defaultView",
      "defaultSort",
    ],
  });
}

async function fallbackTreeForMissingTables(accountId: string) {
  const plan = await getCavCloudPlanContext(accountId);
  const now = new Date().toISOString();

  return {
    ok: true,
    degraded: true,
    folder: { id: "root", name: "root", path: "/", parentId: null, createdAtISO: now, updatedAtISO: now },
    breadcrumbs: [{ id: "root", name: "root", path: "/" }],
    folders: [],
    files: [],
    trash: [],
    usage: {
      usedBytes: 0,
      usedBytesExact: "0",
      limitBytes: plan.limitBytes,
      limitBytesExact: plan.limitBytes == null ? null : String(plan.limitBytes),
      remainingBytes: plan.limitBytes == null ? null : plan.limitBytes,
      remainingBytesExact: plan.limitBytes == null ? null : String(plan.limitBytes),
      planId: plan.planId,
      perFileMaxBytes: plan.perFileMaxBytes,
      perFileMaxBytesExact: String(plan.perFileMaxBytes),
    },
    activity: [],
    storageHistory: [],
  };
}

async function buildDegradedTreeResponse(req: Request) {
  const sess = await requireSession(req);
  requireAccountContext(sess);
  requireUser(sess);
  const fallback = await fallbackTreeForMissingTables(String(sess.accountId || ""));
  return jsonNoStore(fallback, 200);
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const url = new URL(req.url);
    const folderInput = String(url.searchParams.get("folder") || "/").trim() || "/";
    const folder = isReservedSystemPath(folderInput) ? "/" : folderInput;
    const liteRaw = String(url.searchParams.get("lite") || "").trim().toLowerCase();
    const lite = liteRaw === "1" || liteRaw === "true" || liteRaw === "yes";
    const settings = await getCavCloudSettings({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
    });
    const listing = toCavCloudListingPreferences(settings);

    if (lite) {
      const tree = await getTreeLite({
        accountId: sess.accountId,
        folderPath: folder,
        listing,
      });
      const filtered = normalizePath(folder) === "/" ? stripReservedSystemEntriesAtRoot(tree) : tree;
      return jsonNoStore({ ok: true, ...filtered }, 200);
    }

    const tree = await getTree({
      accountId: sess.accountId,
      folderPath: folder,
      operatorUserId: sess.sub,
      listing,
    });

    const filtered = normalizePath(folder) === "/" ? stripReservedSystemEntriesAtRoot(tree) : tree;
    return jsonNoStore({ ok: true, ...filtered }, 200);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return cavcloudErrorResponse(err, "Failed to load CavCloud tree.");
    }
    if (isMissingCavCloudTablesError(err) || isCavCloudTreeSchemaMismatch(err)) {
      try {
        return await buildDegradedTreeResponse(req);
      } catch (fallbackError) {
        return cavcloudErrorResponse(fallbackError, "Failed to load CavCloud tree.");
      }
    }
    try {
      return await buildDegradedTreeResponse(req);
    } catch {}
    return cavcloudErrorResponse(err, "Failed to load CavCloud tree.");
  }
}
