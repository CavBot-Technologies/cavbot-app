import { EmbedInstallKind } from "@prisma/client";

import {
  AdminPage,
  MetricCard,
  Panel,
  TrendChart,
} from "@/components/admin/AdminPrimitives";
import {
  NotFoundGamePassportGrid,
  type NotFoundGamePassportCardData,
  type NotFoundRecoverySiteSnapshot,
} from "@/components/admin/NotFoundGamePassportGrid";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
  buildAdminTrendPoints,
  formatDateTime,
  formatInt,
  formatPercent,
  formatUserHandle,
  getAccountOwners,
  parseAdminMonth,
  parseAdminRange,
  resolveAdminWindow,
  safeNumber,
} from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { getArcadeGames } from "@/lib/arcade/catalog";
import { buildArcadeThumbnailUrl, ARCADE_KIND_404 } from "@/lib/arcade/settings";
import type { SummaryRange } from "@/lib/cavbotApi.server";
import { getTenantProjectSummary } from "@/lib/projectSummary.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SummaryGameRow = {
  gameId: string | null;
  name: string | null;
  sessions: number | null;
  plays: number | null;
  highScore: number | null;
  completionPct: number | null;
};

type SummaryLeaderboardRow = {
  label: string | null;
  score: number | null;
  gameId: string | null;
};

type ControlRoomSummary = {
  views404Total: number | null;
  trend: Array<{ date: Date; value: number }>;
  games: SummaryGameRow[];
  leaderboard: SummaryLeaderboardRow[];
};

type GameAggregate = {
  configuredSiteIds: Set<string>;
  liveSiteIds: Set<string>;
  workspaceIds: Set<string>;
  liveOrigins: Set<string>;
  players: Set<string>;
  configuredTargets: Array<{
    siteId: string;
    label: string;
    origin: string;
    accountId: string;
    projectId: number;
    projectLabel: string;
    accountLabel: string;
    lastSeenAt: Date | null;
  }>;
  installs: number;
  recovered: number;
  views404: number;
  sessions: number;
  plays: number;
  topScore: number | null;
  completionWeightedTotal: number;
  completionWeight: number;
  lastSeenAt: Date | null;
  hasSummary: boolean;
};

type GameMetricsSummary = {
  id: string;
  name: string;
  sessions: number;
  liveOrigins: number;
  configuredSites: number;
  topScore: number | null;
  views404: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickArray(...values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) {
      return value.filter((entry) => !!entry && typeof entry === "object") as Record<string, unknown>[];
    }
  }
  return [] as Record<string, unknown>[];
}

function asString(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function nOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeGameKey(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function safeDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function readSummaryControlRoom(summary: unknown, fallbackGameSlug?: string | null): ControlRoomSummary {
  const summaryRecord = asRecord(summary) || {};
  const metricsRecord = asRecord(summaryRecord.metrics);
  const diagnosticsRecord = asRecord(summaryRecord.diagnostics);
  const cr =
    asRecord(summaryRecord.controlRoom)
    || asRecord(summaryRecord.controlRoomGames)
    || asRecord(summaryRecord.arcade)
    || asRecord(summaryRecord.games)
    || asRecord(metricsRecord?.controlRoom)
    || asRecord(diagnosticsRecord?.controlRoom)
    || null;
  const errorsRecord =
    asRecord(summaryRecord.errors)
    || asRecord(summaryRecord.errorIntelligence)
    || asRecord(diagnosticsRecord?.errors)
    || null;

  const views404Total = nOrNull(
    cr?.views404Total
    ?? cr?.views404
    ?? asRecord(cr?.totals)?.views404
    ?? asRecord(errorsRecord?.totals)?.views404
    ?? errorsRecord?.views404
    ?? asRecord(errorsRecord?.rollup)?.views404,
  );

  const trend = pickArray(
    cr?.trend,
    cr?.trend404,
    errorsRecord?.trend,
    errorsRecord?.trend404,
    summaryRecord.trend7d,
    summaryRecord.trend30d,
    metricsRecord?.trend,
  )
    .map((row) => {
      const date = safeDate(asString(row.day) || asString(row.date) || asString(row.t));
      const value = nOrNull(row.views404 ?? row.views_404 ?? row.v404 ?? row.notFound ?? row.not_found);
      if (!date || value == null) return null;
      return { date, value };
    })
    .filter((row): row is { date: Date; value: number } => Boolean(row));

  const games = pickArray(cr?.games, cr?.gameStats, cr?.arcadeGames)
    .map((row) => ({
      gameId: asString(row.gameId) || asString(row.gameSlug) || asString(row.slug) || asString(row.id),
      name: asString(row.name) || asString(row.title) || asString(row.gameName) || asString(row.displayName),
      sessions: nOrNull(row.sessions ?? row.gameSessions),
      plays: nOrNull(row.plays ?? row.kicks ?? row.runs),
      highScore: nOrNull(row.highScore ?? row.scoreMax),
      completionPct: nOrNull(row.completionPct ?? row.completePct),
    }))
    .filter((row) => row.gameId || row.name);

  const leaderboard = pickArray(cr?.leaderboard, cr?.leaders)
    .map((row) => ({
      label: asString(row.label) || asString(row.player) || asString(row.name),
      score: nOrNull(row.score ?? row.points),
      gameId: asString(row.gameId) || asString(row.gameSlug) || asString(row.slug),
    }))
    .filter((row) => row.score != null);

  const normalizedFallbackSlug = normalizeGameKey(fallbackGameSlug);
  const metricControlRoom = asRecord(metricsRecord?.controlRoom);
  const diagnosticControlRoom = asRecord(diagnosticsRecord?.controlRoom);
  const arcadeSessions = nOrNull(
    cr?.arcadeSessions
    ?? metricControlRoom?.arcadeSessions
    ?? diagnosticControlRoom?.arcadeSessions,
  );
  const arcadeCompletions = nOrNull(
    cr?.arcadeCompletions
    ?? metricControlRoom?.arcadeCompletions
    ?? diagnosticControlRoom?.arcadeCompletions,
  );

  const patchedGames = games.map((row) => {
    if (row.gameId) return row;
    if (!normalizedFallbackSlug) return row;
    return { ...row, gameId: normalizedFallbackSlug };
  });
  const patchedLeaderboard = leaderboard.map((row) => {
    if (row.gameId) return row;
    if (!normalizedFallbackSlug) return row;
    return { ...row, gameId: normalizedFallbackSlug };
  });

  if (!patchedGames.length && normalizedFallbackSlug && (arcadeSessions != null || arcadeCompletions != null)) {
    patchedGames.push({
      gameId: normalizedFallbackSlug,
      name: null,
      sessions: arcadeSessions,
      plays: null,
      highScore: null,
      completionPct:
        arcadeSessions && arcadeCompletions != null
          ? (arcadeCompletions / Math.max(1, arcadeSessions)) * 100
          : null,
    });
  }

  return {
    views404Total,
    trend,
    games: patchedGames,
    leaderboard: patchedLeaderboard,
  };
}

function chooseMostPopularGame(games: Array<{
  name: string;
  sessions: number;
  liveOrigins: number;
  configuredSites: number;
}>) {
  const ranked = games
    .slice()
    .sort((left, right) => {
      if (right.sessions !== left.sessions) return right.sessions - left.sessions;
      if (right.liveOrigins !== left.liveOrigins) return right.liveOrigins - left.liveOrigins;
      return right.configuredSites - left.configuredSites;
    });
  const lead = ranked[0] || null;
  if (!lead) return null;
  if (lead.sessions <= 0 && lead.liveOrigins <= 0 && lead.configuredSites <= 0) return null;
  return lead;
}

function summaryRangeForAdminRange(range: "24h" | "7d" | "30d"): SummaryRange {
  if (range === "24h") return "24h";
  if (range === "7d") return "7d";
  return "30d";
}

export default async function NotFoundRecoveryPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/404-recovery", { scopes: ["projects.read"] });

  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range, "30d");
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const summaryRange = summaryRangeForAdminRange(range);

  const [configs, installs, recoveredEvents, connectionEvents] = await Promise.all([
    prisma.siteArcadeConfig.findMany({
      where: {
        enabled: true,
        site: { isActive: true },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        siteId: true,
        gameSlug: true,
        gameVersion: true,
        updatedAt: true,
        site: {
          select: {
            id: true,
            label: true,
            origin: true,
            projectId: true,
            project: {
              select: {
                id: true,
                name: true,
                slug: true,
                account: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.embedInstall.findMany({
      where: {
        kind: EmbedInstallKind.ARCADE,
        status: "ACTIVE",
      },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        siteId: true,
        accountId: true,
        projectId: true,
        origin: true,
        style: true,
        position: true,
        firstSeenAt: true,
        lastSeenAt: true,
        seenCount: true,
        site: {
          select: {
            id: true,
            label: true,
            origin: true,
            projectId: true,
            project: {
              select: {
                id: true,
                name: true,
                slug: true,
                account: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.adminEvent.findMany({
      where: {
        name: "cavbot_session_recovered",
        createdAt: { gte: start, lt: end },
      },
      select: {
        createdAt: true,
        siteId: true,
        projectId: true,
        accountId: true,
      },
    }),
    prisma.siteEvent.findMany({
      where: {
        type: "INTEGRATION_CONNECTED",
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: "desc" },
      select: {
        siteId: true,
        createdAt: true,
        meta: true,
      },
    }),
  ]);

  const accountIds = Array.from(new Set([
    ...configs.map((row) => row.site.project.account.id),
    ...installs.map((row) => row.accountId),
  ]));
  const accountOwners = await getAccountOwners(accountIds);

  const siteTargetMap = new Map<string, {
    siteId: string;
    label: string;
    origin: string;
    accountId: string;
    accountLabel: string;
    projectId: number;
    projectLabel: string;
    gameSlug: string | null;
    gameVersion: string | null;
    lastSeenAt: Date | null;
    installCount: number;
    liveOrigins: Set<string>;
  }>();

  for (const config of configs) {
    const accountId = config.site.project.account.id;
    const owner = accountOwners.get(accountId);
    siteTargetMap.set(config.siteId, {
      siteId: config.siteId,
      label: config.site.label || config.site.origin,
      origin: config.site.origin,
      accountId,
      accountLabel: formatUserHandle(owner, config.site.project.account.name || "No owner"),
      projectId: config.site.projectId,
      projectLabel: config.site.project.name || config.site.project.slug,
      gameSlug: config.gameSlug || null,
      gameVersion: config.gameVersion || null,
      lastSeenAt: config.updatedAt,
      installCount: 0,
      liveOrigins: new Set<string>(),
    });
  }

  for (const install of installs) {
    const existing = siteTargetMap.get(install.siteId);
    const accountId = install.accountId;
    const owner = accountOwners.get(accountId);
    const target = existing || {
      siteId: install.siteId,
      label: install.site.label || install.site.origin,
      origin: install.site.origin,
      accountId,
      accountLabel: formatUserHandle(owner, install.site.project.account.name || "No owner"),
      projectId: install.projectId,
      projectLabel: install.site.project.name || install.site.project.slug,
      gameSlug: install.style || null,
      gameVersion: install.position || null,
      lastSeenAt: install.lastSeenAt,
      installCount: 0,
      liveOrigins: new Set<string>(),
    };
    target.gameSlug = target.gameSlug || install.style || null;
    target.gameVersion = target.gameVersion || install.position || null;
    target.installCount += 1;
    target.liveOrigins.add(install.origin);
    if (!target.lastSeenAt || install.lastSeenAt > target.lastSeenAt) {
      target.lastSeenAt = install.lastSeenAt;
    }
    siteTargetMap.set(install.siteId, target);
  }

  const siteTargets = Array.from(siteTargetMap.values());
  const recoverySiteIds = new Set(siteTargets.map((target) => target.siteId));
  const recoveredWithGameCount = recoveredEvents.filter((event) => event.siteId && recoverySiteIds.has(event.siteId)).length;

  const summaryResults = await Promise.allSettled(
    siteTargets.map(async (target) => ({
      siteId: target.siteId,
      gameSlug: target.gameSlug,
      summary: readSummaryControlRoom(
        (await getTenantProjectSummary({
          accountId: target.accountId,
          projectId: target.projectId,
          range: summaryRange,
          siteOrigin: target.origin,
        })).summary,
        target.gameSlug,
      ),
    })),
  );

  const summaryBySite = new Map<string, ControlRoomSummary>();
  for (const result of summaryResults) {
    if (result.status !== "fulfilled") continue;
    summaryBySite.set(result.value.siteId, result.value.summary);
  }

  const summaryTrendRows: Array<{ date: Date; value: number }> = [];
  const leaderboardEntries = new Set<string>();
  const gameAggregates = new Map<string, GameAggregate>();
  const catalog = getArcadeGames(ARCADE_KIND_404);

  const ensureAggregate = (slug: string) => {
    const key = normalizeGameKey(slug);
    const existing = gameAggregates.get(key);
    if (existing) return existing;
    const created: GameAggregate = {
      configuredSiteIds: new Set<string>(),
      liveSiteIds: new Set<string>(),
      workspaceIds: new Set<string>(),
      liveOrigins: new Set<string>(),
      players: new Set<string>(),
      configuredTargets: [],
      installs: 0,
      recovered: 0,
      views404: 0,
      sessions: 0,
      plays: 0,
      topScore: null,
      completionWeightedTotal: 0,
      completionWeight: 0,
      lastSeenAt: null,
      hasSummary: false,
    };
    gameAggregates.set(key, created);
    return created;
  };

  for (const target of siteTargets) {
    const gameSlug = normalizeGameKey(target.gameSlug);
    if (!gameSlug) continue;
    const aggregate = ensureAggregate(gameSlug);
    aggregate.configuredTargets.push({
      siteId: target.siteId,
      label: target.label,
      origin: target.origin,
      accountId: target.accountId,
      projectId: target.projectId,
      projectLabel: target.projectLabel,
      accountLabel: target.accountLabel,
      lastSeenAt: target.lastSeenAt,
    });
    aggregate.workspaceIds.add(target.accountId);
    if (configs.some((row) => row.siteId === target.siteId && normalizeGameKey(row.gameSlug) === gameSlug)) {
      aggregate.configuredSiteIds.add(target.siteId);
    }
    if (target.installCount > 0) {
      aggregate.liveSiteIds.add(target.siteId);
    }
    for (const origin of target.liveOrigins) {
      aggregate.liveOrigins.add(origin);
    }
    aggregate.installs += target.installCount;
    if (target.lastSeenAt && (!aggregate.lastSeenAt || target.lastSeenAt > aggregate.lastSeenAt)) {
      aggregate.lastSeenAt = target.lastSeenAt;
    }

    const summary = summaryBySite.get(target.siteId);
    if (!summary) continue;
    aggregate.hasSummary = true;
    if (summary.views404Total != null) {
      aggregate.views404 += summary.views404Total;
    }
    for (const point of summary.trend) {
      summaryTrendRows.push(point);
    }
    for (const game of summary.games) {
      const summaryGameKey = normalizeGameKey(game.gameId || target.gameSlug);
      if (summaryGameKey !== gameSlug) continue;
      aggregate.sessions += safeNumber(game.sessions);
      aggregate.plays += safeNumber(game.plays);
      if (game.highScore != null) {
        aggregate.topScore = aggregate.topScore == null ? game.highScore : Math.max(aggregate.topScore, game.highScore);
      }
      if (game.completionPct != null) {
        const weight = Math.max(1, safeNumber(game.sessions));
        aggregate.completionWeightedTotal += game.completionPct * weight;
        aggregate.completionWeight += weight;
      }
    }
    for (const row of summary.leaderboard) {
      const leaderboardGameKey = normalizeGameKey(row.gameId || target.gameSlug);
      if (leaderboardGameKey !== gameSlug) continue;
      const label = asString(row.label);
      if (label) {
        aggregate.players.add(label);
        leaderboardEntries.add(`${leaderboardGameKey}:${label}`);
      }
      if (row.score != null) {
        aggregate.topScore = aggregate.topScore == null ? row.score : Math.max(aggregate.topScore, row.score);
      }
    }
  }

  const recoveredBySite = new Map<string, number>();
  for (const event of recoveredEvents) {
    if (!event.siteId) continue;
    recoveredBySite.set(event.siteId, (recoveredBySite.get(event.siteId) || 0) + 1);
  }

  for (const [slug, aggregate] of gameAggregates) {
    for (const siteId of aggregate.configuredSiteIds) {
      aggregate.recovered += recoveredBySite.get(siteId) || 0;
    }
    for (const siteId of aggregate.liveSiteIds) {
      if (aggregate.configuredSiteIds.has(siteId)) continue;
      aggregate.recovered += recoveredBySite.get(siteId) || 0;
    }
    gameAggregates.set(slug, aggregate);
  }

  for (const game of catalog) {
    ensureAggregate(game.slug);
  }

  const gameMetricSummaries: GameMetricsSummary[] = [];
  const gameCards: NotFoundGamePassportCardData[] = catalog.map((game) => {
    const aggregate = gameAggregates.get(normalizeGameKey(game.slug))!;
    const completion =
      aggregate.completionWeight > 0
        ? aggregate.completionWeightedTotal / aggregate.completionWeight
        : null;
    const snapshots: NotFoundRecoverySiteSnapshot[] = aggregate.configuredTargets
      .sort((left, right) => {
        const leftSeen = left.lastSeenAt?.getTime() || 0;
        const rightSeen = right.lastSeenAt?.getTime() || 0;
        return rightSeen - leftSeen;
      })
      .slice(0, 8)
      .map((target) => ({
        id: target.siteId,
        label: target.label,
        origin: target.origin,
        accountLabel: target.accountLabel,
        projectLabel: target.projectLabel,
        lastSeenLabel: target.lastSeenAt ? formatDateTime(target.lastSeenAt) : "Not seen yet",
        installsLabel: `${formatInt(siteTargetMap.get(target.siteId)?.installCount || 0)} live origins`,
        recoveredLabel: `${formatInt(recoveredBySite.get(target.siteId) || 0)} recovered`,
        views404Label: `${formatInt(summaryBySite.get(target.siteId)?.views404Total || 0)} 404 views`,
        statusLabel: (siteTargetMap.get(target.siteId)?.installCount || 0) > 0 ? "Live" : "Configured",
      }));

    const tone = aggregate.liveOrigins.size > 0 ? "live" : aggregate.configuredSiteIds.size > 0 ? "configured" : "idle";
    const telemetryLabel = aggregate.hasSummary
      ? "Live 404 summary + gameplay telemetry"
      : aggregate.liveOrigins.size > 0
        ? "Install telemetry only"
        : aggregate.configuredSiteIds.size > 0
          ? "Configured but not observed live"
          : "Catalog only";
    const summaryNote = aggregate.hasSummary
      ? "Real 404 summary feeds are active for at least one site running this game."
      : aggregate.liveOrigins.size > 0
        ? "CavBot sees the loader live, but score and leaderboard feeds have not been emitted yet."
        : aggregate.configuredSiteIds.size > 0
          ? "This game is configured on at least one site, but CavBot has not seen a live install in the current dataset."
          : "This game exists in the CavBot 404 catalog and will light up as soon as a live site config or install is captured.";

    gameMetricSummaries.push({
      id: game.slug,
      name: game.displayName,
      sessions: aggregate.sessions,
      liveOrigins: aggregate.liveOrigins.size,
      configuredSites: aggregate.configuredSiteIds.size,
      topScore: aggregate.topScore,
      views404: aggregate.views404,
    });

    return {
      id: game.slug,
      name: game.displayName,
      slug: game.slug,
      version: game.version,
      thumbnailUrl: buildArcadeThumbnailUrl(game.slug, game.version),
      tone,
      configuredSitesLabel: `Configured on ${formatInt(aggregate.configuredSiteIds.size)}`,
      liveOriginsLabel: `Live on ${formatInt(aggregate.liveOrigins.size)}`,
      workspacesLabel: formatInt(aggregate.workspaceIds.size),
      recoveredLabel: formatInt(aggregate.recovered),
      views404Label: formatInt(aggregate.views404),
      sessionsLabel: formatInt(aggregate.sessions),
      playersLabel: `${formatInt(aggregate.players.size)} players`,
      topScoreLabel: aggregate.topScore == null ? "Top score —" : `Top score ${formatInt(aggregate.topScore)}`,
      completionLabel: completion == null ? "—" : formatPercent(completion, 1),
      lastSeenLabel: aggregate.lastSeenAt ? formatDateTime(aggregate.lastSeenAt) : "—",
      telemetryLabel,
      summaryNote,
      siteSnapshots: snapshots,
    };
  });

  const mostPopularGame = chooseMostPopularGame(gameMetricSummaries);
  const highestTopScore = gameMetricSummaries.reduce<number | null>((current, game) => {
    if (game.topScore == null) return current;
    if (current == null) return game.topScore;
    return Math.max(current, game.topScore);
  }, null);
  const total404Views = gameMetricSummaries.reduce((sum, game) => sum + game.views404, 0);

  const summaryViewTrend = buildAdminTrendPoints(
    summaryTrendRows.map((row) => ({ date: row.date, value: row.value })),
    range,
    month,
  );
  const recoveredTrend = buildAdminTrendPoints(
    recoveredEvents.map((row) => ({ date: row.createdAt, value: 1 })),
    range,
    month,
  );
  const connectionTrend = buildAdminTrendPoints(
    connectionEvents
      .filter((row) => {
        const meta = asRecord(row.meta);
        return Boolean(asString(meta?.gameSlug)) || recoverySiteIds.has(row.siteId);
      })
      .map((row) => ({ date: row.createdAt, value: 1 })),
    range,
    month,
  );
  const chartPrimary = summaryTrendRows.length ? summaryViewTrend : recoveredTrend;
  const chartSecondary = summaryTrendRows.length ? recoveredTrend : connectionTrend;

  return (
    <AdminPage
      title="404 Arcade"
      subtitle="Real CavBot 404 operations view for game rollout, live recovery signals, score telemetry, and the current footprint of every shipped arcade surface."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Catalog games" value={formatInt(gameCards.length)} meta="Every shipped 404 arcade title" />
        <MetricCard label="Configured sites" value={formatInt(configs.length)} meta={`404 games enabled in ${rangeLabel}`} />
        <MetricCard label="Live origins" value={formatInt(new Set(installs.map((row) => row.origin)).size)} meta="Observed active 404 arcade origins" />
        <MetricCard label="Recovered with a game" value={formatInt(recoveredWithGameCount)} meta="Recovered sessions attributed to game-enabled sites" />
        <MetricCard
          label="Most popular game"
          value={mostPopularGame?.name || "—"}
          meta={mostPopularGame ? "Ranked by live sessions, then live origins and configured sites" : "No live game telemetry yet"}
        />
        <MetricCard
          label="Players captured"
          value={formatInt(leaderboardEntries.size)}
          meta="Distinct leaderboard/player identities emitted by real 404 game summaries"
        />
        <MetricCard
          label="Top score"
          value={highestTopScore == null ? "—" : formatInt(highestTopScore)}
          meta="Highest recorded score across every live 404 game feed"
        />
        <MetricCard
          label="404 views"
          value={formatInt(total404Views)}
          meta="Summed from real control-room summaries when available"
        />
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="404 signal trend"
          subtitle={`404 view exposure and recovered-session activity across ${rangeLabel}.`}
          labels={chartPrimary.map((row) => row.label)}
          primary={chartPrimary.map((row) => row.value)}
          secondary={chartSecondary.map((row) => row.value)}
          primaryLabel={summaryTrendRows.length ? "404 views" : "Recovered sessions"}
          secondaryLabel={summaryTrendRows.length ? "Recovered sessions" : "Arcade connections"}
          className="hq-chart404Recovery"
          paddingTop={32}
        />

        <Panel
          title="Recovery ranking"
          subtitle="Most active 404 games right now, based on live gameplay sessions first and rollout footprint second."
        >
          <div className="hq-list">
            {gameCards
              .slice()
              .sort((left, right) => {
                const rightSessions = gameMetricSummaries.find((entry) => entry.id === right.id)?.sessions || 0;
                const leftSessions = gameMetricSummaries.find((entry) => entry.id === left.id)?.sessions || 0;
                if (rightSessions !== leftSessions) return rightSessions - leftSessions;
                const rightOrigins = gameMetricSummaries.find((entry) => entry.id === right.id)?.liveOrigins || 0;
                const leftOrigins = gameMetricSummaries.find((entry) => entry.id === left.id)?.liveOrigins || 0;
                return rightOrigins - leftOrigins;
              })
              .slice(0, 6)
              .map((game) => (
                <div key={game.id} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{game.name}</div>
                    <div className="hq-listMeta">{game.configuredSitesLabel} · {game.liveOriginsLabel} · {game.sessionsLabel} sessions</div>
                  </div>
                  <div className="hq-listMeta">{game.topScoreLabel}</div>
                </div>
              ))}
          </div>
        </Panel>
      </section>

      <Panel
        title="404 games"
        subtitle="Click a game to view its live 404 setup, recovery activity, and score signals."
      >
        <NotFoundGamePassportGrid games={gameCards} />
      </Panel>
    </AdminPage>
  );
}
