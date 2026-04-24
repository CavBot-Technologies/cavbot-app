import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/apiAuth";
import { getAuthPool } from "@/lib/authDb";
import { fetchEmbedUsage } from "@/lib/security/embedMetrics.server";
import { readWorkspace } from "@/lib/workspaceStore.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOOTER_METRICS_TIMEOUT_MS = 3_500;

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

async function withFooterDeadline<T>(promise: Promise<T>, timeoutMs = FOOTER_METRICS_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("FOOTER_METRICS_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

type RawInstallActivityRow = {
  kind: string | null;
  status: string | null;
  lastSeenAt: Date | string | null;
};

type RawCountRow = {
  count: number | string | null;
};

type RawLatestEventRow = {
  createdAt: Date | string | null;
};

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
    const installValues: unknown[] = [params.accountId, params.projectId];
    let installSiteClause = "";
    if (params.siteId) {
      installValues.push(params.siteId);
      installSiteClause = ` AND "siteId" = $3`;
    }

    const [installsResult, recentEventCount, latestEventResult] = await Promise.all([
      getAuthPool().query<RawInstallActivityRow>(
        `SELECT "kind", "status", "lastSeenAt"
         FROM "EmbedInstall"
         WHERE "accountId" = $1
           AND "projectId" = $2${installSiteClause}
           AND "kind" = ANY(ARRAY['WIDGET', 'ANALYTICS', 'ARCADE', 'BRAIN']::"EmbedInstallKind"[])`,
        installValues
      ),
      params.siteIds.length
        ? getAuthPool()
            .query<RawCountRow>(
              `SELECT COUNT(*)::int AS "count"
               FROM "SiteEvent"
               WHERE "siteId" = ANY($1::text[])
                 AND "createdAt" >= $2`,
              [params.siteIds, params.twentyFourHoursAgo]
            )
            .then((result) => safeCount(result.rows[0]?.count))
        : Promise.resolve(0),
      params.siteIds.length
        ? getAuthPool().query<RawLatestEventRow>(
            `SELECT "createdAt"
             FROM "SiteEvent"
             WHERE "siteId" = ANY($1::text[])
             ORDER BY "createdAt" DESC
             LIMIT 1`,
            [params.siteIds]
          )
        : Promise.resolve({ rows: [] as RawLatestEventRow[] }),
    ]);

    const installs = installsResult.rows;
    const latestEvent = latestEventResult.rows[0] ?? null;

    const activeInstalls = installs.filter((install) => String(install.status || "").toUpperCase() === "ACTIVE");
    const activeDestinations = activeInstalls.length;
    const recentDestinations = activeInstalls.reduce((count, install) => {
      const lastSeenAt = asDate(install.lastSeenAt);
      if (!lastSeenAt) return count;
      if (lastSeenAt.getTime() >= params.twentyFourHoursAgo.getTime()) return count + 1;
      return count;
    }, 0);

    const latestInstallSeenAt = activeInstalls.reduce<Date | null>((latest, install) => {
      const lastSeenAt = asDate(install.lastSeenAt);
      if (!lastSeenAt) return latest;
      if (!latest) return lastSeenAt;
      return lastSeenAt.getTime() > latest.getTime() ? lastSeenAt : latest;
    }, null);

    const lastActivityDate = (() => {
      const eventDate = asDate(latestEvent?.createdAt);
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
    const accountId = String(session.accountId);

    const payload = await withFooterDeadline((async () => {
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
          accountId,
          projectId: workspace.projectId,
          siteId: site?.id ?? null,
        }),
        readEventDestinationActivity({
          accountId,
          projectId: workspace.projectId,
          siteId: site?.id ?? null,
          siteIds,
          twentyFourHoursAgo,
        }),
      ]);

      return {
        ok: true,
        generatedAt: now.toISOString(),
        workspace: {
          projectId: workspace.projectId,
          siteId: site?.id ?? null,
          siteOrigin: site?.origin ?? null,
        },
        apiActivity,
        eventDestinationActivity,
      };
    })());

    return json(payload, 200);
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
