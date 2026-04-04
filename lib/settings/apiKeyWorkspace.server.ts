import "server-only";

import { prisma } from "@/lib/prisma";

export type ApiKeyWorkspaceSite = {
  id: string;
  origin: string;
};

export type ResolvedApiKeyWorkspace = {
  projectId: number;
  sites: ApiKeyWorkspaceSite[];
  activeSite: ApiKeyWorkspaceSite | null;
  allowedOrigins: string[];
};

export async function resolveApiKeyWorkspace(args: {
  accountId: string;
  requestedSiteId?: string | null;
}): Promise<ResolvedApiKeyWorkspace | null> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) return null;

  const project = await prisma.project.findFirst({
    where: {
      accountId,
      isActive: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      topSiteId: true,
    },
  });

  if (!project) return null;

  const sites = await prisma.site.findMany({
    where: {
      projectId: project.id,
      isActive: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      origin: true,
    },
  });

  const requestedSiteId = String(args.requestedSiteId || "").trim();
  const requestedSite = requestedSiteId ? sites.find((site) => site.id === requestedSiteId) ?? null : null;
  const topSite = project.topSiteId ? sites.find((site) => site.id === project.topSiteId) ?? null : null;
  const activeSite = requestedSite || topSite || sites[0] || null;

  const allowedRows = activeSite
    ? await prisma.siteAllowedOrigin.findMany({
        where: { siteId: activeSite.id },
        orderBy: { createdAt: "asc" },
        select: { origin: true },
      })
    : [];

  const originSet = new Set<string>();
  if (activeSite?.origin) originSet.add(activeSite.origin);
  for (const row of allowedRows) {
    if (row.origin) originSet.add(row.origin);
  }

  return {
    projectId: project.id,
    sites,
    activeSite,
    allowedOrigins: Array.from(originSet),
  };
}
