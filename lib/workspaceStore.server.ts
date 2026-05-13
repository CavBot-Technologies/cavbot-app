import "server-only";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma"; // adjust if your prisma import differs
import { getAppOrigin, getSession } from "@/lib/apiAuth";
import {
  findLatestEntitledSubscription,
  planTierTokenFromPlanId,
  resolveEffectivePlanId,
} from "@/lib/accountPlan.server";

type SiteDTO = {
  id: string;
  label: string;
  origin: string;
  createdAt: number;
  notes?: string;
};

export type WorkspacePayload = {
  projectId: number;
  sites: SiteDTO[];      // resolved from DB in readWorkspace()
  topSiteId: string;     // resolved
  activeSiteId: string;  // resolved

  // Optional convenience fields used by UI pages that want account context.
  // These are additive and won't break older callers.
  account?: { id?: string; tier?: string | null; projectId?: string | number | null };
  workspace?: {
    // Some pages treat `workspace` as a container for selection pointers.
    activeSiteOrigin?: string | null;
    account?: { id?: string; tier?: string | null; projectId?: string | number | null };
  };
  tier?: string | null;

  // Optional cookie pointers (useful for pages that want origin without re-deriving).
  activeSiteOrigin?: string;
  topSiteOrigin?: string;
};

const KEY_ACTIVE_PROJECT_ID = "cb_active_project_id";

const KEY_ACTIVE_SITE_ORIGIN_PREFIX = "cb_active_site_origin__";
const KEY_TOP_SITE_ORIGIN_PREFIX = "cb_top_site_origin__";
const KEY_ACTIVE_SITE_ID_PREFIX = "cb_active_site_id__"; // optional

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function cookieGetDecoded(key: string): string {
  const jar = cookies();
  const raw = (jar.get(key)?.value ?? "").trim();
  return safeDecode(raw).trim();
}

function getActiveProjectIdFromCookies(): { projectId: number; projectIdStr: string } {
  const jar = cookies();
  const projectIdStr = (jar.get(KEY_ACTIVE_PROJECT_ID)?.value ?? "1").trim() || "1";
  const projectId = Number.parseInt(projectIdStr, 10) || 1;
  return { projectId, projectIdStr };
}

function cookieSetOrDelete(key: string, value: string) {
  const jar = cookies();
  const v = (value ?? "").trim();

  if (!v) {
    jar.delete(key);
    return;
  }

  jar.set(key, encodeURIComponent(v), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

async function inferAccountIdFromSessionCookie(): Promise<string | null> {
  try {
    const h = headers();
    const cookie = String(h.get("cookie") || "").trim();
    if (!cookie) return null;

    const fallback = new URL(getAppOrigin());
    const host = String(h.get("x-forwarded-host") || h.get("host") || fallback.host).trim();
    const proto = String(h.get("x-forwarded-proto") || fallback.protocol.replace(/:$/, "")).trim() || "http";

    // getSession() reads cookies from the Request headers.
    const req = new Request(`${proto}://${host}/_workspace`, {
      headers: {
        cookie,
        host,
      },
    });

    const sess = await getSession(req);
    const accountId = sess?.systemRole === "user" ? String(sess?.accountId || "").trim() : "";
    return accountId || null;
  } catch {
    return null;
  }
}

async function resolveProjectIdForAccount(
  cookieProjectId: number,
  accountId?: string
): Promise<{ projectId: number; topSiteIdFromProject: string }> {
  // If no login/account context provided, keep old behavior.
  if (!accountId) {
    const project = await prisma.project.findUnique({
      where: { id: cookieProjectId },
      select: { id: true, topSiteId: true },
    });

    return {
      projectId: project?.id ?? cookieProjectId,
      topSiteIdFromProject: project?.topSiteId ?? "",
    };
  }

  // 1) Try cookie projectId within this account
  const exact = await prisma.project.findFirst({
    where: { id: cookieProjectId, accountId, isActive: true },
    select: { id: true, topSiteId: true },
  });

  if (exact) {
    return { projectId: exact.id, topSiteIdFromProject: exact.topSiteId ?? "" };
  }

  // 2) Fall back to first active project in this account
  const fallback = await prisma.project.findFirst({
    where: { accountId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, topSiteId: true },
  });

  if (!fallback) {
    // If the account has no active projects, keep cookie id (caller may error elsewhere)
    return { projectId: cookieProjectId, topSiteIdFromProject: "" };
  }

  return { projectId: fallback.id, topSiteIdFromProject: fallback.topSiteId ?? "" };
}

/**
 * READ (Server): DB is source of truth.
 * Cookies provide per-project "pointers" to choose active/top site.
 *
 *command-centerUpdated for login/multi-tenant:
 * - Pass { accountId } to enforce ownership + prevent leakage.
 * - Repairs cb_active_project_id if it points outside the account.
 */
export async function readWorkspace(opts?: { accountId?: string }): Promise<WorkspacePayload> {
  const { projectId: cookieProjectId, projectIdStr: cookieProjectIdStr } = getActiveProjectIdFromCookies();
  const accountId = opts?.accountId || (await inferAccountIdFromSessionCookie()) || undefined;

  // Resolve a projectId that is valid for this account (if provided)
  const resolved = await resolveProjectIdForAccount(cookieProjectId, accountId);
  const projectId = resolved.projectId;
  const projectIdStr = String(projectId);

  // If cookie project differs (wrong tenant / stale), repair it
  if (projectIdStr !== cookieProjectIdStr) {
    cookieSetOrDelete(KEY_ACTIVE_PROJECT_ID, projectIdStr);
  }

  // Read pointers for *resolved* project
  const activeSiteOrigin = cookieGetDecoded(`${KEY_ACTIVE_SITE_ORIGIN_PREFIX}${projectIdStr}`);
  const topSiteOrigin = cookieGetDecoded(`${KEY_TOP_SITE_ORIGIN_PREFIX}${projectIdStr}`);
  const activeSiteIdHint = cookieGetDecoded(`${KEY_ACTIVE_SITE_ID_PREFIX}${projectIdStr}`);

  // 1) Pull sites from DB (source of truth) — account-scoped when accountId exists
  const dbSites = await prisma.site.findMany({
    where: accountId
      ? { projectId, isActive: true, project: { accountId, isActive: true } }
      : { projectId, isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, origin: true, createdAt: true, notes: true },
  });

  const sites: SiteDTO[] = dbSites.map((s) => ({
    id: s.id,
    label: s.label,
    origin: s.origin,
    createdAt: s.createdAt instanceof Date ? s.createdAt.getTime() : Number(s.createdAt),
    notes: s.notes ?? undefined,
  }));

  // 2) Resolve topSiteId (prefer Project.topSiteId; fall back to origin pointer)
  let topSiteId = (resolved.topSiteIdFromProject ?? "").trim();

  // Validate topSiteId is actually in current active sites
  if (topSiteId && !sites.some((s) => s.id === topSiteId)) {
    topSiteId = "";
  }

  if (!topSiteId && topSiteOrigin) {
    const match = sites.find((s) => s.origin === topSiteOrigin);
    if (match) topSiteId = match.id;
  }

  // 3) Resolve activeSiteId (prefer explicit id hint; else origin; else top; else first)
  let activeSiteId = "";
  if (activeSiteIdHint && sites.some((s) => s.id === activeSiteIdHint)) {
    activeSiteId = activeSiteIdHint;
  } else if (activeSiteOrigin) {
    const match = sites.find((s) => s.origin === activeSiteOrigin);
    if (match) activeSiteId = match.id;
  } else if (topSiteId) {
    activeSiteId = topSiteId;
  } else {
    activeSiteId = sites[0]?.id ?? "";
  }

  // Attach account tier when we have account context (used by /plan and billing UI).
  const acct =
    accountId
      ? await prisma.account.findUnique({
          where: { id: accountId },
          select: { id: true, tier: true, trialSeatActive: true, trialEndsAt: true },
        })
      : null;

  const subscription = acct?.id ? await findLatestEntitledSubscription(acct.id).catch(() => null) : null;
  const effectivePlanId = acct ? resolveEffectivePlanId({ account: acct, subscription }) : null;
  const tierStr = effectivePlanId ? planTierTokenFromPlanId(effectivePlanId) : acct?.tier ? String(acct.tier) : null;

  return {
    projectId,
    sites,
    topSiteId,
    activeSiteId,
    activeSiteOrigin: activeSiteOrigin || undefined,
    topSiteOrigin: topSiteOrigin || undefined,
    account: acct ? { id: acct.id, tier: tierStr } : undefined,
    workspace: acct
      ? { activeSiteOrigin: activeSiteOrigin || null, account: { id: acct.id, tier: tierStr } }
      : { activeSiteOrigin: activeSiteOrigin || null },
    tier: tierStr,
  };
}

/**
 * WRITE (Server): write cookie pointers for the *current project*.
 * This does NOT write sites to cookies (DB is source of truth).
 */
export function writeWorkspace(payload: WorkspacePayload) {
  const projectIdStr = String(payload?.projectId ?? 1).trim() || "1";

  // Always keep active project cookie in sync
  cookieSetOrDelete(KEY_ACTIVE_PROJECT_ID, projectIdStr);

  const sites = Array.isArray(payload?.sites) ? payload.sites : [];
  const topSiteId = String(payload?.topSiteId ?? "").trim();
  const activeSiteId = String(payload?.activeSiteId ?? "").trim();

  const byId = new Map<string, SiteDTO>();
  for (const s of sites) byId.set(s.id, s);

  const topOrigin = topSiteId ? (byId.get(topSiteId)?.origin ?? "") : "";
  const activeOrigin = activeSiteId ? (byId.get(activeSiteId)?.origin ?? "") : "";

  // Per-project pointers (these match what readWorkspace() reads)
  cookieSetOrDelete(`${KEY_TOP_SITE_ORIGIN_PREFIX}${projectIdStr}`, topOrigin);
  cookieSetOrDelete(`${KEY_ACTIVE_SITE_ORIGIN_PREFIX}${projectIdStr}`, activeOrigin);
  cookieSetOrDelete(`${KEY_ACTIVE_SITE_ID_PREFIX}${projectIdStr}`, activeSiteId);
}
