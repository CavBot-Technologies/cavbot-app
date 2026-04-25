import "server-only";

import { withDedicatedAuthClient } from "@/lib/authDb";
import {
  getEnv,
  getProjectSummaryForTenant,
  type RequestAuthOverride,
  type SummaryRange,
} from "@/lib/cavbotApi.server";
import {
  enrichProjectSummaryWithLatestPack,
  enrichProjectSummaryWithLocalWebVitals,
  harmonizeProjectSummarySignals,
  suppressPlaceholderWebVitals,
} from "@/lib/projectSummaryEnrichment.server";
import type { ProjectSummary } from "@/lib/cavbotTypes";
import { decryptAesGcm } from "@/lib/cryptoAesGcm.server";
import { resolveEffectiveAccountIdFromHeaders } from "@/lib/effectiveSessionAccount.server";
import { getLatestPackWithHistory, normalizeOriginStrict } from "@/lib/cavai/packs.server";
import {
  findActiveWorkspaceSite,
  findActiveWorkspaceSiteByOrigin,
  findOwnedWorkspaceProjectForSites,
} from "@/lib/workspaceSites.server";
import { fetchSiteWebVitalsRollup } from "@/lib/webVitals.server";

type TenantProjectSummaryInput = {
  accountId?: string | null;
  projectId?: string | number | null;
  projectSlug?: string | null;
  range?: SummaryRange;
  siteId?: string;
  siteOrigin?: string;
  requestId?: string;
};

type TenantProjectSummaryResult = {
  project: {
    id: number;
    slug: string;
    name: string | null;
  };
  summary: ProjectSummary;
};

type TenantProjectAccess = {
  accountId: string;
  project: {
    id: number;
    slug: string;
    name: string | null;
  };
  summaryAuth: RequestAuthOverride;
};

type ResolvedSummarySite = {
  id: string;
  origin: string;
};

const SUMMARY_SITE_RESOLUTION_TIMEOUT_MS = 1_200;
const SUMMARY_REMOTE_FETCH_TIMEOUT_MS = 3_500;
const SUMMARY_PACK_ENRICH_TIMEOUT_MS = 2_000;
const SUMMARY_VITALS_ROLLUP_TIMEOUT_MS = 1_500;

async function withSummaryStageDeadline<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeProjectId(input: string | number | null | undefined) {
  const raw = String(input ?? "").trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

type ProjectAccessRow = {
  id: number | string;
  slug: string;
  name: string | null;
  serverKeyEnc: string | null;
  serverKeyEncIv: string | null;
};

async function findProjectForAccount(input: {
  accountId: string;
  projectId?: number;
  projectSlug?: string;
}) {
  return withDedicatedAuthClient(async (authClient) => {
    const byId = input.projectId
      ? await authClient.query<ProjectAccessRow>(
          `SELECT "id", "slug", "name", "serverKeyEnc", "serverKeyEncIv"
           FROM "Project"
           WHERE "id" = $1
             AND "accountId" = $2
             AND "isActive" = true
           LIMIT 1`,
          [input.projectId, input.accountId],
        )
      : null;
    if (byId?.rows[0]) return byId.rows[0];

    const projectSlug = String(input.projectSlug || "").trim();
    const bySlug = projectSlug
      ? await authClient.query<ProjectAccessRow>(
          `SELECT "id", "slug", "name", "serverKeyEnc", "serverKeyEncIv"
           FROM "Project"
           WHERE "slug" = $1
             AND "accountId" = $2
             AND "isActive" = true
           LIMIT 1`,
          [projectSlug, input.accountId],
        )
      : null;
    if (bySlug?.rows[0]) return bySlug.rows[0];

    const first = await authClient.query<ProjectAccessRow>(
      `SELECT "id", "slug", "name", "serverKeyEnc", "serverKeyEncIv"
       FROM "Project"
       WHERE "accountId" = $1
         AND "isActive" = true
       ORDER BY "createdAt" ASC
       LIMIT 1`,
      [input.accountId],
    );
    return first.rows[0] ?? null;
  });
}

export async function resolveTenantProjectAccess(input: {
  accountId?: string | null;
  projectId?: string | number | null;
  projectSlug?: string | null;
}): Promise<TenantProjectAccess> {
  const accountId =
    (await resolveEffectiveAccountIdFromHeaders().catch(() => null)) ||
    String(input.accountId || "").trim() ||
    "";
  if (!accountId) throw new Error("ACCOUNT_CONTEXT_REQUIRED");

  const project = await findProjectForAccount({
    accountId,
    projectId: normalizeProjectId(input.projectId),
    projectSlug: String(input.projectSlug || "").trim() || undefined,
  });
  if (!project) throw new Error("PROJECT_NOT_FOUND");

  let summaryAuth: RequestAuthOverride | null = null;

  if (project.serverKeyEnc && project.serverKeyEncIv) {
    const projectKey = String(
      await decryptAesGcm({
        enc: String(project.serverKeyEnc),
        iv: String(project.serverKeyEncIv),
      }),
    ).trim();

    if (!projectKey) throw new Error("PROJECT_KEY_DECRYPT_FAILED");
    summaryAuth = { projectKey };
  } else {
    const adminToken = String(getEnv().adminToken || "").trim();
    if (!adminToken) throw new Error("PROJECT_SUMMARY_AUTH_UNAVAILABLE");
    summaryAuth = { adminToken };
  }

  return {
    accountId,
    project: {
      id: Number(project.id),
      slug: String(project.slug),
      name: project.name ?? null,
    },
    summaryAuth,
  };
}

export async function getTenantProjectSummary(
  input: TenantProjectSummaryInput,
): Promise<TenantProjectSummaryResult> {
  const access = await resolveTenantProjectAccess({
    accountId: input.accountId,
    projectId: input.projectId,
    projectSlug: input.projectSlug,
  });

  const normalizedOrigin = normalizeOriginStrict(input.siteOrigin);
  const selectedSite = await withSummaryStageDeadline(
    resolveSummarySite({
      accountId: access.accountId,
      projectId: access.project.id,
      siteId: input.siteId,
      siteOrigin: normalizedOrigin,
    }).catch(() => null),
    SUMMARY_SITE_RESOLUTION_TIMEOUT_MS,
    "SUMMARY_SITE_RESOLUTION_TIMEOUT",
  ).catch(() => null);
  const effectiveSiteId = selectedSite?.id;
  const effectiveSiteOrigin = selectedSite?.origin ?? normalizedOrigin ?? undefined;

  const [summary, latestPackWithHistory, localWebVitalsRollup] = await Promise.all([
    withSummaryStageDeadline(
      getProjectSummaryForTenant({
        projectId: access.project.id,
        range: input.range,
        siteId: effectiveSiteId,
        siteOrigin: effectiveSiteOrigin,
        projectKey: access.summaryAuth.projectKey,
        adminToken: access.summaryAuth.adminToken,
        requestId: input.requestId,
      }),
      SUMMARY_REMOTE_FETCH_TIMEOUT_MS,
      "PROJECT_SUMMARY_TIMEOUT",
    ),
    effectiveSiteOrigin
      ? withSummaryStageDeadline(
          getLatestPackWithHistory({
            accountId: access.accountId,
            origin: effectiveSiteOrigin,
            limit: 7,
          }).catch(() => null),
          SUMMARY_PACK_ENRICH_TIMEOUT_MS,
          "SUMMARY_PACK_TIMEOUT",
        ).catch(() => null)
      : Promise.resolve(null),
    effectiveSiteId
      ? withSummaryStageDeadline(
          fetchSiteWebVitalsRollup({
            siteId: effectiveSiteId,
            range: input.range,
          }).catch(() => null),
          SUMMARY_VITALS_ROLLUP_TIMEOUT_MS,
          "SUMMARY_WEB_VITALS_TIMEOUT",
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  const enrichedSummary = harmonizeProjectSummarySignals(
    enrichProjectSummaryWithLatestPack(
      suppressPlaceholderWebVitals(enrichProjectSummaryWithLocalWebVitals(summary, localWebVitalsRollup)),
      latestPackWithHistory,
    ),
  );

  return {
    project: access.project,
    summary: enrichedSummary,
  };
}

async function resolveSummarySite(input: {
  accountId: string;
  projectId: number;
  siteId?: string | null;
  siteOrigin?: string | null;
}): Promise<ResolvedSummarySite | null> {
  const requestedSiteId = String(input.siteId || "").trim();
  if (requestedSiteId) {
    const byId = await findActiveWorkspaceSite(input.projectId, requestedSiteId).catch(() => null);
    if (byId) return { id: byId.id, origin: byId.origin };
  }

  const normalizedOrigin = normalizeOriginStrict(input.siteOrigin);
  if (normalizedOrigin) {
    const byOrigin = await findActiveWorkspaceSiteByOrigin(input.projectId, normalizedOrigin).catch(() => null);
    if (byOrigin) return { id: byOrigin.id, origin: byOrigin.origin };
  }

  const project = await findOwnedWorkspaceProjectForSites(input.accountId, input.projectId).catch(() => null);
  const topSiteId = String(project?.topSiteId || "").trim();
  if (!topSiteId) return null;

  const topSite = await findActiveWorkspaceSite(input.projectId, topSiteId).catch(() => null);
  return topSite ? { id: topSite.id, origin: topSite.origin } : null;
}
