import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAppOrigin, isApiAuthError } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
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

function normalizeRouteOrigin(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!parsed.hostname || parsed.username || parsed.password) return null;

  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!hostname || hostname.includes("..")) return null;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return null;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan")) return null;
  if (hostname.endsWith(".home") || hostname.endsWith(".corp") || hostname.endsWith(".intranet")) return null;
  if (!hostname.includes(".") && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;

  const port =
    !parsed.port ||
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80")
      ? ""
      : `:${parsed.port}`;
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;

  return `${parsed.protocol}//${host}${port}`;
}

function buildRoutesStartPath(origin: string, source: string | null, projectId: number | null) {
  const params = new URLSearchParams();
  params.set("origin", origin);
  if (source) params.set("source", source);
  if (projectId) params.set("projectId", String(projectId));
  return `/routes/start?${params.toString()}`;
}

function buildAddSiteRedirect(origin: string, nextPath: string, projectId: number | null) {
  const params = new URLSearchParams();
  params.set("addSite", "1");
  params.set("origin", origin);
  params.set("next", nextPath);
  params.set("source", "routes");
  if (projectId) params.set("projectId", String(projectId));
  return `/?${params.toString()}`;
}

function buildRoutesRedirect(origin: string, projectId: number, siteId: string, source: string | null) {
  const params = new URLSearchParams();
  params.set("origin", origin);
  params.set("projectId", String(projectId));
  params.set("siteId", siteId);
  params.set("range", "7d");
  if (source) params.set("source", source);
  return `/routes?${params.toString()}`;
}

export default async function RoutesStartPage({ searchParams }: PageProps) {
  noStore();

  const sp = await searchParams;
  const origin = normalizeRouteOrigin(firstString(sp.origin));
  if (!origin) redirect("/routes?error=invalid_origin");

  const source = cleanSource(firstString(sp.source));
  const requestedProjectId = parseProjectId(firstString(sp.projectId));
  const nextPath = buildRoutesStartPath(origin, source, requestedProjectId);
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

  redirect(buildRoutesRedirect(site.origin, site.project.id, site.id, source));
}
