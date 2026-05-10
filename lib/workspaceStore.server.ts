import "server-only";

import { cookies } from "next/headers";
import {
  planTierTokenFromPlanId,
  resolveEffectivePlanId,
} from "@/lib/accountPlan.server";
import { withDedicatedAuthClient } from "@/lib/authDb";
import { resolveEffectiveAccountIdFromHeaders } from "@/lib/effectiveSessionAccount.server";
import { originsShareWebsiteContext } from "@/originMatch";

type SiteDTO = {
  id: string;
  label: string;
  origin: string;
  createdAt: number;
  notes?: string;
};

type WorkspaceActiveSite = {
  id: string;
  origin: string;
  label?: string;
};

export type WorkspacePayload = {
  projectId: number;
  sites: SiteDTO[];
  topSiteId: string;
  activeSiteId: string;
  account?: { id?: string; tier?: string | null; projectId?: string | number | null };
  workspace?: {
    activeSiteOrigin?: string | null;
    account?: { id?: string; tier?: string | null; projectId?: string | number | null };
  };
  tier?: string | null;
  activeSiteOrigin?: string;
  topSiteOrigin?: string;
  activeSite?: WorkspaceActiveSite;
};

type CookieProjectPointers = {
  requestedProjectId: number;
  requestedProjectIdStr: string;
  fallbackProjectId: number | null;
};

type ProjectPointer = {
  id: number;
  topSiteId: string | null;
};

type RawProjectPointerRow = {
  id: number | string;
  topSiteId: string | null;
};

type RawWorkspaceSiteRow = {
  id: string;
  label: string;
  origin: string;
  notes: string | null;
  createdAt: Date | string;
};

type RawAccountTierRow = {
  tier: string | null;
  trialSeatActive?: boolean | null;
  trialEndsAt?: Date | string | null;
};

type RawSubscriptionTierRow = {
  tier: string | null;
  status: string | null;
  currentPeriodEnd?: Date | string | null;
};

const KEY_ACTIVE_PROJECT_ID = "cb_active_project_id";
const KEY_LEGACY_PROJECT_ID = "cb_pid";
const KEY_ACTIVE_SITE_ORIGIN_PREFIX = "cb_active_site_origin__";
const KEY_TOP_SITE_ORIGIN_PREFIX = "cb_top_site_origin__";
const KEY_ACTIVE_SITE_ID_PREFIX = "cb_active_site_id__";

function safeDecode(v: string) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function parseProjectId(raw: string | null | undefined) {
  const value = String(raw || "").trim();
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asProjectPointer(row: RawProjectPointerRow | null | undefined): ProjectPointer | null {
  if (!row) return null;
  const id = Number(row.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    topSiteId: row.topSiteId ? String(row.topSiteId).trim() : null,
  };
}

async function getCookieStore() {
  return await cookies();
}

async function cookieGetDecoded(key: string) {
  const jar = await getCookieStore();
  const raw = (jar.get(key)?.value ?? "").trim();
  return safeDecode(raw).trim();
}

async function getActiveProjectPointersFromCookies(): Promise<CookieProjectPointers> {
  const jar = await getCookieStore();
  const requestedProjectId =
    parseProjectId(jar.get(KEY_ACTIVE_PROJECT_ID)?.value) ??
    parseProjectId(jar.get(KEY_LEGACY_PROJECT_ID)?.value) ??
    1;
  return {
    requestedProjectId,
    requestedProjectIdStr: String(requestedProjectId),
    fallbackProjectId: parseProjectId(jar.get(KEY_LEGACY_PROJECT_ID)?.value),
  };
}

async function cookieSetOrDelete(key: string, value: string) {
  const jar = await getCookieStore();
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    jar.delete(key);
    return;
  }

  jar.set(key, encodeURIComponent(normalized), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}

async function inferAccountIdFromSessionCookie(): Promise<string | null> {
  return resolveEffectiveAccountIdFromHeaders();
}

async function findProjectPointerFrom(
  queryable: { query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  projectId: number,
) {
  const result = await queryable.query<RawProjectPointerRow>(
    `SELECT "id", "topSiteId"
     FROM "Project"
     WHERE "id" = $1
     LIMIT 1`,
    [projectId],
  );
  return asProjectPointer(result.rows[0]);
}

async function findProjectPointer(projectId: number) {
  return withDedicatedAuthClient((authClient) => findProjectPointerFrom(authClient, projectId));
}

async function findOwnedProjectPointerFrom(
  queryable: { query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  projectId: number,
  accountId: string,
) {
  const result = await queryable.query<RawProjectPointerRow>(
    `SELECT "id", "topSiteId"
     FROM "Project"
     WHERE "id" = $1
       AND "accountId" = $2
       AND "isActive" = true
     LIMIT 1`,
    [projectId, accountId],
  );
  return asProjectPointer(result.rows[0]);
}

async function findFirstOwnedProjectPointerFrom(
  queryable: { query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  accountId: string,
) {
  const result = await queryable.query<RawProjectPointerRow>(
    `SELECT "id", "topSiteId"
     FROM "Project"
     WHERE "accountId" = $1
       AND "isActive" = true
     ORDER BY "createdAt" ASC
     LIMIT 1`,
    [accountId],
  );
  return asProjectPointer(result.rows[0]);
}

async function resolveProjectPointerForAccountFrom(
  queryable: { query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  requestedProjectId: number,
  fallbackProjectId: number | null,
  accountId?: string,
) {
  if (!accountId) {
    return (await findProjectPointerFrom(queryable, requestedProjectId)) ?? { id: requestedProjectId, topSiteId: null };
  }

  const candidateIds = Array.from(
    new Set(
      [requestedProjectId, fallbackProjectId].filter(
        (value): value is number => Number.isInteger(value) && Number(value) > 0,
      ),
    ),
  );

  for (const projectId of candidateIds) {
    const owned = await findOwnedProjectPointerFrom(queryable, projectId, accountId);
    if (owned) return owned;
  }

  return (await findFirstOwnedProjectPointerFrom(queryable, accountId)) ?? { id: requestedProjectId, topSiteId: null };
}

export async function readWorkspace(opts?: { accountId?: string }): Promise<WorkspacePayload> {
  const projectPointers = await getActiveProjectPointersFromCookies();
  const accountId =
    opts?.accountId ||
    (await inferAccountIdFromSessionCookie().catch(() => null)) ||
    undefined;

  let resolvedProject: ProjectPointer;
  let sites: SiteDTO[] = [];
  let tierStr: string | null = null;
  try {
    if (accountId) {
      const workspaceState = await withDedicatedAuthClient(async (authClient) => {
        const resolvedProject = await resolveProjectPointerForAccountFrom(
          authClient,
          projectPointers.requestedProjectId,
          projectPointers.fallbackProjectId,
          accountId,
        );
        const siteResult = await authClient.query<RawWorkspaceSiteRow>(
          `SELECT "id", "label", "origin", "notes", "createdAt"
           FROM "Site"
           WHERE "projectId" = $1
             AND "isActive" = true
           ORDER BY "createdAt" DESC`,
          [resolvedProject.id],
        );
        const tierResult = await authClient.query<RawAccountTierRow>(
          `SELECT "tier", "trialSeatActive", "trialEndsAt"
           FROM "Account"
           WHERE "id" = $1
           LIMIT 1`,
          [accountId],
        );
        const subscriptionResult = await authClient.query<RawSubscriptionTierRow>(
          `SELECT "tier", "status", "currentPeriodEnd"
           FROM "Subscription"
           WHERE "accountId" = $1
             AND "status" IN ('ACTIVE', 'TRIALING', 'PAST_DUE')
           ORDER BY "currentPeriodEnd" DESC NULLS LAST, "updatedAt" DESC, "createdAt" DESC
           LIMIT 1`,
          [accountId],
        ).catch(() => ({ rows: [] as RawSubscriptionTierRow[] }));
        const accountPlan = tierResult.rows[0] || null;
        const subscriptionPlan = subscriptionResult.rows[0] || null;
        const effectivePlanId = resolveEffectivePlanId({
          account: accountPlan,
          subscription: subscriptionPlan,
        });
        return {
          resolvedProject,
          sites: siteResult.rows.map((row) => ({
            id: row.id,
            label: row.label,
            origin: row.origin,
            createdAt: new Date(row.createdAt).getTime(),
            notes: row.notes ?? undefined,
          })),
          tier: planTierTokenFromPlanId(effectivePlanId),
        };
      });
      resolvedProject = workspaceState.resolvedProject;
      sites = workspaceState.sites;
      tierStr = workspaceState.tier;
    } else {
      resolvedProject =
        (await findProjectPointer(projectPointers.requestedProjectId).catch(() => null)) ?? {
          id: projectPointers.requestedProjectId,
          topSiteId: null,
        };
    }
  } catch {
    resolvedProject =
      (await findProjectPointer(projectPointers.requestedProjectId).catch(() => null)) ?? {
        id: projectPointers.requestedProjectId,
        topSiteId: null,
      };
    sites = [];
    tierStr = null;
  }

  const projectId = resolvedProject.id;
  const projectIdStr = String(projectId);

  if (projectIdStr !== projectPointers.requestedProjectIdStr) {
    try {
      await cookieSetOrDelete(KEY_ACTIVE_PROJECT_ID, projectIdStr);
      await cookieSetOrDelete(KEY_LEGACY_PROJECT_ID, projectIdStr);
    } catch {}
  }

  const activeSiteOriginHint = await cookieGetDecoded(`${KEY_ACTIVE_SITE_ORIGIN_PREFIX}${projectIdStr}`);
  const topSiteOriginHint = await cookieGetDecoded(`${KEY_TOP_SITE_ORIGIN_PREFIX}${projectIdStr}`);
  const activeSiteIdHint = await cookieGetDecoded(`${KEY_ACTIVE_SITE_ID_PREFIX}${projectIdStr}`);

  const firstSite = sites[0] ?? null;
  const topSiteByProject = resolvedProject.topSiteId
    ? sites.find((site) => site.id === resolvedProject.topSiteId) ?? null
    : null;
  const topSiteByOrigin = !topSiteByProject && topSiteOriginHint
    ? sites.find((site) => originsShareWebsiteContext(site.origin, topSiteOriginHint)) ?? null
    : null;
  const topSite = topSiteByProject || topSiteByOrigin || firstSite;

  const activeSiteById = activeSiteIdHint
    ? sites.find((site) => site.id === activeSiteIdHint) ?? null
    : null;
  const activeSiteByOrigin = !activeSiteById && activeSiteOriginHint
    ? sites.find((site) => originsShareWebsiteContext(site.origin, activeSiteOriginHint)) ?? null
    : null;
  const activeSite = activeSiteById || activeSiteByOrigin || topSite || firstSite;

  const topSiteId = topSite?.id ?? "";
  const activeSiteId = activeSite?.id ?? "";
  const topSiteOrigin = topSite?.origin ?? "";
  const activeSiteOrigin = activeSite?.origin ?? topSiteOrigin;

  return {
    projectId,
    sites,
    topSiteId,
    activeSiteId,
    activeSiteOrigin: activeSiteOrigin || undefined,
    topSiteOrigin: topSiteOrigin || undefined,
    activeSite: activeSite
      ? {
          id: activeSite.id,
          origin: activeSite.origin,
          label: activeSite.label,
        }
      : undefined,
    account: accountId ? { id: accountId, tier: tierStr, projectId } : undefined,
    workspace: accountId
      ? { activeSiteOrigin: activeSiteOrigin || null, account: { id: accountId, tier: tierStr, projectId } }
      : { activeSiteOrigin: activeSiteOrigin || null },
    tier: tierStr,
  };
}

export async function writeWorkspace(payload: WorkspacePayload) {
  const projectIdStr = String(payload?.projectId ?? 1).trim() || "1";
  const sites = Array.isArray(payload?.sites) ? payload.sites : [];
  const byId = new Map<string, SiteDTO>();
  for (const site of sites) byId.set(site.id, site);

  const topSiteId = String(payload?.topSiteId ?? "").trim();
  const activeSiteId = String(payload?.activeSiteId ?? "").trim();
  const topOrigin = topSiteId ? (byId.get(topSiteId)?.origin ?? "") : "";
  const activeOrigin = activeSiteId ? (byId.get(activeSiteId)?.origin ?? "") : "";

  await cookieSetOrDelete(KEY_ACTIVE_PROJECT_ID, projectIdStr);
  await cookieSetOrDelete(KEY_LEGACY_PROJECT_ID, projectIdStr);
  await cookieSetOrDelete(`${KEY_TOP_SITE_ORIGIN_PREFIX}${projectIdStr}`, topOrigin);
  await cookieSetOrDelete(`${KEY_ACTIVE_SITE_ORIGIN_PREFIX}${projectIdStr}`, activeOrigin);
  await cookieSetOrDelete(`${KEY_ACTIVE_SITE_ID_PREFIX}${projectIdStr}`, activeSiteId);
}
