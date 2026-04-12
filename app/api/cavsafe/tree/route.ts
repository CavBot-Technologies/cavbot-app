import { isApiAuthError } from "@/lib/apiAuth";
import {
  isCavsafePlanSchemaMismatchError,
  requireCavsafeOwnerContext,
  requireCavsafeOwnerSession,
  resolveCavsafePlanIdOrDefault,
} from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { getTree, getTreeLite } from "@/lib/cavsafe/storage.server";
import { cavsafeSecuredStorageLimitBytesForPlan } from "@/lib/cavsafe/policy.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import type { PlanId } from "@/lib/plans";

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

function envPositiveInt(name: string, fallback: number): number {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function perFileMaxBytesForPlan(planId: PlanId): number {
  const free = envPositiveInt("CAVCLOUD_MAX_FILE_BYTES_FREE", 64 * 1024 * 1024);
  const premium = envPositiveInt("CAVCLOUD_MAX_FILE_BYTES_PREMIUM", 1024 * 1024 * 1024);
  const premiumPlus = envPositiveInt("CAVCLOUD_MAX_FILE_BYTES_PREMIUM_PLUS", 5 * 1024 * 1024 * 1024);
  if (planId === "premium_plus") return premiumPlus;
  if (planId === "premium") return premium;
  return free;
}

function storageLimitBytesForPlan(planId: PlanId): number | null {
  const limit = cavsafeSecuredStorageLimitBytesForPlan(planId);
  if (limit <= BigInt(0)) return 0;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (limit > max) return Number.MAX_SAFE_INTEGER;
  return Number(limit);
}

function isMissingCavSafeTablesError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  if (msg.includes("does not exist") && msg.includes("cavsafe")) return true;
  if (msg.includes("relation") && msg.includes("cavsafe")) return true;
  return false;
}

async function fallbackTreeForMissingTables(accountId: string) {
  const planId: PlanId = await resolveCavsafePlanIdOrDefault(accountId, "premium");

  const limitBytes = storageLimitBytesForPlan(planId);
  const perFileMaxBytes = perFileMaxBytesForPlan(planId);
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
      limitBytes,
      limitBytesExact: limitBytes == null ? null : String(limitBytes),
      remainingBytes: limitBytes == null ? null : limitBytes,
      remainingBytesExact: limitBytes == null ? null : String(limitBytes),
      planId,
      perFileMaxBytes,
      perFileMaxBytesExact: String(perFileMaxBytes),
    },
    activity: [],
    storageHistory: [],
  };
}

function isCavSafeTreeSchemaMismatch(err: unknown) {
  return isCavsafePlanSchemaMismatchError(err) || isSchemaMismatchError(err, {
    tables: ["CavSafeFolder", "CavSafeFile", "CavSafeQuota", "CavSafeTrash", "CavSafeShare", "CavSafeOperationLog"],
    columns: [
      "path",
      "name",
      "parentId",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "folderId",
      "bytes",
      "mimeType",
      "sha256",
      "previewSnippet",
      "previewSnippetUpdatedAt",
      "usedBytes",
      "deletedAt",
      "purgeAfter",
      "fileId",
      "revokedAt",
      "expiresAt",
      "mode",
      "action",
      "targetType",
      "targetId",
      "targetPath",
      "metaJson",
    ],
  });
}

async function buildDegradedTreeResponse(req: Request) {
  const sess = await requireCavsafeOwnerContext(req);
  const fallback = await fallbackTreeForMissingTables(String(sess.accountId || ""));
  return jsonNoStore(fallback, 200);
}

export async function GET(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);

    const url = new URL(req.url);
    const folderInput = String(url.searchParams.get("folder") || "/").trim() || "/";
    const folder = isReservedSystemPath(folderInput) ? "/" : folderInput;
    const liteRaw = String(url.searchParams.get("lite") || "").trim().toLowerCase();
    const lite = liteRaw === "1" || liteRaw === "true" || liteRaw === "yes";

    if (lite) {
      const tree = await getTreeLite({
        accountId: sess.accountId,
        folderPath: folder,
      });
      const filtered = normalizePath(folder) === "/" ? stripReservedSystemEntriesAtRoot(tree) : tree;
      return jsonNoStore({ ok: true, ...filtered }, 200);
    }

    const tree = await getTree({
      accountId: sess.accountId,
      folderPath: folder,
      operatorUserId: sess.sub,
    });

    const filtered = normalizePath(folder) === "/" ? stripReservedSystemEntriesAtRoot(tree) : tree;
    return jsonNoStore({ ok: true, ...filtered }, 200);
  } catch (err) {
    if (isApiAuthError(err)) {
      return cavsafeErrorResponse(err, "Failed to load CavSafe tree.");
    }
    if (isMissingCavSafeTablesError(err) || isCavSafeTreeSchemaMismatch(err)) {
      try {
        return await buildDegradedTreeResponse(req);
      } catch (fallbackError) {
        return cavsafeErrorResponse(fallbackError, "Failed to load CavSafe tree.");
      }
    }
    try {
      return await buildDegradedTreeResponse(req);
    } catch {}
    return cavsafeErrorResponse(err, "Failed to load CavSafe tree.");
  }
}
