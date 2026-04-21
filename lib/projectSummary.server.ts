import "server-only";

import { getProjectSummaryForTenant, type SummaryRange } from "@/lib/cavbotApi.server";
import type { ProjectSummary } from "@/lib/cavbotTypes";
import { decryptAesGcm } from "@/lib/cryptoAesGcm.server";
import { resolveEffectiveAccountIdFromHeaders } from "@/lib/effectiveSessionAccount.server";
import { resolveProjectForAccount } from "@/lib/projectAuth.server";

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

function normalizeProjectId(input: string | number | null | undefined) {
  const raw = String(input ?? "").trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function resolveTenantProjectAccess(input: {
  accountId?: string | null;
  projectId?: string | number | null;
  projectSlug?: string | null;
}) {
  const accountId =
    (await resolveEffectiveAccountIdFromHeaders().catch(() => null)) ||
    String(input.accountId || "").trim() ||
    "";
  if (!accountId) throw new Error("ACCOUNT_CONTEXT_REQUIRED");

  const project = await resolveProjectForAccount({
    accountId,
    projectId: normalizeProjectId(input.projectId),
    projectSlug: String(input.projectSlug || "").trim() || undefined,
  });

  const projectKey = String(
    await decryptAesGcm({
      enc: String(project.serverKeyEnc),
      iv: String(project.serverKeyEncIv),
    }),
  ).trim();

  if (!projectKey) throw new Error("PROJECT_KEY_DECRYPT_FAILED");

  return {
    accountId,
    project: {
      id: Number(project.id),
      slug: String(project.slug),
      name: project.name ?? null,
    },
    projectKey,
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

  const summary = await getProjectSummaryForTenant({
    projectId: access.project.id,
    range: input.range,
    siteId: input.siteId,
    siteOrigin: input.siteOrigin,
    projectKey: access.projectKey,
    requestId: input.requestId,
  });

  return {
    project: access.project,
    summary,
  };
}
