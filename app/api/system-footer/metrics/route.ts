import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { EmbedInstallKind } from "@prisma/client";
import { getSession } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { fetchEmbedUsage } from "@/lib/security/embedMetrics.server";
import { readWorkspace } from "@/lib/workspaceStore.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(payload: unknown, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

function safeCount(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function isoOrNull(value: Date | null | undefined) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

async function readApiActivity(params: {
  accountId: string;
  projectId: number;
  siteId: string | null;
}) {
  try {
    const usage = await fetchEmbedUsage({
      accountId: params.accountId,
      projectId: params.projectId,
      siteId: params.siteId,
      rateLimitLabel: "Today (UTC)",
    });

    const verifiedToday = safeCount(usage?.verifiedToday);
    const deniedToday = safeCount(usage?.deniedToday);
    return {
      totalRequests: verifiedToday + deniedToday,
      failedRequests: deniedToday,
      periodLabel: "Today (UTC)",
      deniedOrigins: Array.isArray(usage?.topDeniedOrigins) ? usage.topDeniedOrigins : [],
    };
  } catch {
    return {
      totalRequests: 0,
      failedRequests: 0,
      periodLabel: "Today (UTC)",
      deniedOrigins: [],
    };
  }
}

async function readEventDestinationActivity(params: {
  accountId: string;
  projectId: number;
  siteId: string | null;
  siteIds: string[];
  twentyFourHoursAgo: Date;
}) {
  try {
    const [installs, recentEventCount, latestEvent] = await Promise.all([
      prisma.embedInstall.findMany({
        where: {
          accountId: params.accountId,
          projectId: params.projectId,
          siteId: params.siteId ?? undefined,
          kind: {
            in: [
              EmbedInstallKind.WIDGET,
              EmbedInstallKind.ANALYTICS,
              EmbedInstallKind.ARCADE,
              EmbedInstallKind.BRAIN,
            ],
          },
        },
        select: {
          kind: true,
          status: true,
          lastSeenAt: true,
        },
      }),
      params.siteIds.length
        ? prisma.siteEvent.count({
            where: {
              siteId: { in: params.siteIds },
              createdAt: { gte: params.twentyFourHoursAgo },
            },
          })
        : Promise.resolve(0),
      params.siteIds.length
        ? prisma.siteEvent.findFirst({
            where: {
              siteId: { in: params.siteIds },
            },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          })
        : Promise.resolve(null),
    ]);

    const activeInstalls = installs.filter((install) => install.status === "ACTIVE");
    const activeDestinations = activeInstalls.length;
    const recentDestinations = activeInstalls.reduce((count, install) => {
      if (!(install.lastSeenAt instanceof Date)) return count;
      if (install.lastSeenAt.getTime() >= params.twentyFourHoursAgo.getTime()) return count + 1;
      return count;
    }, 0);

    const latestInstallSeenAt = activeInstalls.reduce<Date | null>((latest, install) => {
      if (!(install.lastSeenAt instanceof Date)) return latest;
      if (!latest) return install.lastSeenAt;
      return install.lastSeenAt.getTime() > latest.getTime() ? install.lastSeenAt : latest;
    }, null);

    const lastActivityDate = (() => {
      const eventDate = latestEvent?.createdAt instanceof Date ? latestEvent.createdAt : null;
      if (latestInstallSeenAt && eventDate) {
        return latestInstallSeenAt.getTime() >= eventDate.getTime() ? latestInstallSeenAt : eventDate;
      }
      return latestInstallSeenAt || eventDate;
    })();

    const activeKinds = Array.from(
      new Set(activeInstalls.map((install) => String(install.kind || "").trim().toLowerCase()).filter(Boolean))
    );

    return {
      activeDestinations,
      recentDestinations,
      recentEvents: safeCount(recentEventCount),
      recentActivity: recentDestinations + safeCount(recentEventCount),
      periodLabel: "Last 24h",
      lastActivityAt: isoOrNull(lastActivityDate),
      activeKinds,
    };
  } catch {
    return {
      activeDestinations: 0,
      recentDestinations: 0,
      recentEvents: 0,
      recentActivity: 0,
      periodLabel: "Last 24h",
      lastActivityAt: null,
      activeKinds: [],
    };
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || session.systemRole !== "user" || !session.accountId) {
      return json(
        {
          ok: false,
          reason: "UNAUTHENTICATED",
          message: "Sign in to view workspace metrics.",
        },
        200
      );
    }

    const workspace = await readWorkspace({ accountId: session.accountId });
    const site =
      workspace.sites.find((row) => row.id === workspace.activeSiteId) ??
      workspace.sites[0] ??
      null;

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const siteIds = site?.id
      ? [site.id]
      : workspace.sites.map((row) => String(row.id || "").trim()).filter(Boolean);

    const [apiActivity, eventDestinationActivity] = await Promise.all([
      readApiActivity({
        accountId: session.accountId,
        projectId: workspace.projectId,
        siteId: site?.id ?? null,
      }),
      readEventDestinationActivity({
        accountId: session.accountId,
        projectId: workspace.projectId,
        siteId: site?.id ?? null,
        siteIds,
        twentyFourHoursAgo,
      }),
    ]);

    return json(
      {
        ok: true,
        generatedAt: now.toISOString(),
        workspace: {
          projectId: workspace.projectId,
          siteId: site?.id ?? null,
          siteOrigin: site?.origin ?? null,
        },
        apiActivity,
        eventDestinationActivity,
      },
      200
    );
  } catch {
    return json(
      {
        ok: false,
        reason: "SERVER_ERROR",
        message: "Footer metrics are warming up.",
      },
      200
    );
  }
}
