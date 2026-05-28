import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAppOrigin, isApiAuthError } from "@/lib/apiAuth";
import { gateModuleAccess } from "@/lib/moduleGate.server";
import { prisma } from "@/lib/prisma";
import {
  createSeoScanAndRun,
  normalizeSeoScanOrigin,
  SeoScanError,
} from "@/lib/seo/seoScan.server";
import { requireWorkspaceSession } from "@/lib/workspaceAuth.server";
import { expandRelatedExactOrigins } from "@/originMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function parseProjectId(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanSource(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "").slice(0, 40) || null;
}

function buildSeoStartPath(origin: string, source: string | null, projectId: number | null) {
  const params = new URLSearchParams();
  params.set("origin", origin);
  if (source) params.set("source", source);
  if (projectId) params.set("projectId", String(projectId));
  return `/seo/start?${params.toString()}`;
}

function buildAddSiteRedirect(origin: string, nextPath: string, projectId: number | null) {
  const params = new URLSearchParams();
  params.set("addSite", "1");
  params.set("origin", origin);
  params.set("next", nextPath);
  params.set("source", "seo");
  if (projectId) params.set("projectId", String(projectId));
  return `/?${params.toString()}`;
}

export default async function SeoStartPage({ searchParams }: PageProps) {
  noStore();

  const sp = await searchParams;
  let origin: string | null = null;
  try {
    origin = normalizeSeoScanOrigin(firstString(sp.origin));
  } catch {
    origin = null;
  }

  if (!origin) redirect("/seo?error=invalid_origin");

  const source = cleanSource(firstString(sp.source));
  const requestedProjectId = parseProjectId(firstString(sp.projectId));
  const nextPath = buildSeoStartPath(origin, source, requestedProjectId);
  const requestHeaders = await headers();
  const req = new Request(`${getAppOrigin()}${nextPath}`, {
    headers: new Headers(requestHeaders),
  });

  let session: Awaited<ReturnType<typeof requireWorkspaceSession>>;
  try {
    session = await requireWorkspaceSession(req);
  } catch (error) {
    if (isApiAuthError(error) && error.status === 401) {
      redirect(`/auth?next=${encodeURIComponent(nextPath)}`);
    }
    throw error;
  }

  await gateModuleAccess(req, "seo", "redirect");

  const candidateOrigins = expandRelatedExactOrigins(origin);
  const site = await prisma.site.findFirst({
    where: {
      origin: { in: candidateOrigins },
      isActive: true,
      status: "VERIFIED",
      project: {
        accountId: session.accountId,
        isActive: true,
        ...(requestedProjectId ? { id: requestedProjectId } : {}),
      },
    },
    include: {
      project: {
        select: {
          id: true,
          accountId: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!site) {
    const project = requestedProjectId
      ? await prisma.project.findFirst({
          where: {
            id: requestedProjectId,
            accountId: session.accountId,
            isActive: true,
          },
          select: { id: true },
        })
      : await prisma.project.findFirst({
          where: {
            accountId: session.accountId,
            isActive: true,
          },
          select: { id: true },
          orderBy: { updatedAt: "desc" },
        });

    redirect(buildAddSiteRedirect(origin, nextPath, project?.id ?? requestedProjectId ?? null));
  }

  try {
    const scan = await createSeoScanAndRun({
      accountId: session.accountId,
      operatorUserId: session.sub,
      projectId: site.project.id,
      siteId: site.id,
      origin: site.origin,
      source,
      request: req,
    });

    redirect(`/seo/report/${scan.id}`);
  } catch (error) {
    if (error instanceof SeoScanError && error.code === "RATE_LIMITED") {
      redirect(`/seo?error=rate_limited&retryAfter=${error.retryAfterSec || 60}`);
    }
    redirect("/seo?error=scan_failed");
  }
}
