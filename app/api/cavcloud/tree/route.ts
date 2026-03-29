import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavCloudSettings, toCavCloudListingPreferences } from "@/lib/cavcloud/settings.server";
import { getTree, getTreeLite } from "@/lib/cavcloud/storage.server";
import { prisma } from "@/lib/prisma";
import { getPlanLimits, resolvePlanIdFromTier, type PlanId } from "@/lib/plans";

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
  const limits = getPlanLimits(planId);
  if (limits.storageGb === "unlimited") return null;
  const bytes = Number(limits.storageGb || 0) * 1024 * 1024 * 1024;
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.trunc(bytes);
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

async function fallbackTreeForMissingTables(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { tier: true, trialSeatActive: true, trialEndsAt: true },
  });

  let planId: PlanId = resolvePlanIdFromTier(account?.tier || "FREE");
  const trialEndsAtMs = account?.trialEndsAt ? new Date(account.trialEndsAt).getTime() : 0;
  if (account?.trialSeatActive && Number.isFinite(trialEndsAtMs) && trialEndsAtMs > Date.now()) {
    planId = "premium_plus";
  }

  const limitBytes = storageLimitBytesForPlan(planId);
  const perFileMaxBytes = perFileMaxBytesForPlan(planId);
  const now = new Date().toISOString();

  return {
    ok: true,
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
    if (isMissingCavCloudTablesError(err)) {
      try {
        const sess = await requireSession(req);
        requireAccountContext(sess);
        requireUser(sess);
        const fallback = await fallbackTreeForMissingTables(sess.accountId);
        return jsonNoStore(fallback, 200);
      } catch {
        // fall through to standard error response
      }
    }
    return cavcloudErrorResponse(err, "Failed to load CavCloud tree.");
  }
}
