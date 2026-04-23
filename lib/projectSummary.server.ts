import "server-only";

import { getAuthPool } from "@/lib/authDb";
import {
  getEnv,
  getProjectSummaryForTenant,
  type RequestAuthOverride,
  type SummaryRange,
} from "@/lib/cavbotApi.server";
import { enrichProjectSummaryWithLatestPack } from "@/lib/projectSummaryEnrichment.server";
import type { ProjectSummary } from "@/lib/cavbotTypes";
import { decryptAesGcm } from "@/lib/cryptoAesGcm.server";
import { resolveEffectiveAccountIdFromHeaders } from "@/lib/effectiveSessionAccount.server";
import { getLatestPackWithHistory, normalizeOriginStrict } from "@/lib/cavai/packs.server";

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
  const pool = getAuthPool();

  const byId = input.projectId
    ? await pool.query<ProjectAccessRow>(
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
    ? await pool.query<ProjectAccessRow>(
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

  const first = await pool.query<ProjectAccessRow>(
    `SELECT "id", "slug", "name", "serverKeyEnc", "serverKeyEncIv"
     FROM "Project"
     WHERE "accountId" = $1
       AND "isActive" = true
     ORDER BY "createdAt" ASC
     LIMIT 1`,
    [input.accountId],
  );
  return first.rows[0] ?? null;
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

  const [summary, latestPackWithHistory] = await Promise.all([
    getProjectSummaryForTenant({
      projectId: access.project.id,
      range: input.range,
      siteId: input.siteId,
      siteOrigin: input.siteOrigin,
      projectKey: access.summaryAuth.projectKey,
      adminToken: access.summaryAuth.adminToken,
      requestId: input.requestId,
    }),
    normalizedOrigin
      ? getLatestPackWithHistory({
          accountId: access.accountId,
          origin: normalizedOrigin,
          limit: 7,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    project: access.project,
    summary: enrichProjectSummaryWithLatestPack(summary, latestPackWithHistory),
  };
}
