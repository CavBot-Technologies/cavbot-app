import {
  AdminPage,
  EmptyState,
  MetricCard,
  Panel,
  TrendChart,
} from "@/components/admin/AdminPrimitives";
import {
  AiAgentsDirectory,
  type AiAgentAccountCardData,
  type AiAgentDirectoryRow,
} from "@/components/admin/AiAgentsDirectory";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
  getAccountDisciplineMap,
} from "@/lib/admin/accountDiscipline.server";
import {
  getPublishedOperatorAgentMap,
  listAdminTrackedAgents,
} from "@/lib/admin/agentIntelligence.server";
import {
  buildAdminTrendPoints,
  formatDateTime,
  formatInt,
  formatUserHandle,
  formatUserName,
  getAccountOwners,
  getLatestSubscriptions,
  parseAdminMonth,
  parseAdminRange,
  resolveAdminPlanDisplay,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { AGENT_CATALOG } from "@/lib/cavai/agentCatalog";
import { prisma } from "@/lib/prisma";
import { buildCanonicalPublicProfileHref } from "@/lib/publicProfile/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function s(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeSurface(value: unknown): "cavcode" | "center" | "all" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "cavcode" || raw === "center" || raw === "all") return raw;
  return "all";
}

function surfaceLabel(surface: "cavcode" | "center" | "all") {
  if (surface === "cavcode") return "Caven";
  if (surface === "center") return "CavAi";
  return "All surfaces";
}

function creationSourceLabel(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "generate_with_cavai") return "Generated with CavAi";
  if (normalized === "help_write_with_cavai") return "Drafted with CavAi";
  if (normalized === "manual") return "Manual build";
  return "Tracked build";
}

function usageSurfaceBucket(surface: string) {
  return String(surface || "").trim().toLowerCase() === "cavcode" ? "caven" : "cavai";
}

function matchesSurfaceFilter(surface: "cavcode" | "center" | "all", filter: string) {
  if (!filter) return true;
  if (filter === "caven") return surface === "cavcode" || surface === "all";
  if (filter === "cavai") return surface === "center" || surface === "all";
  if (filter === "everywhere") return surface === "all";
  return true;
}

function isReviewQueueRow(row: Pick<AiAgentDirectoryRow, "kind" | "publicationRequested" | "isPublished">) {
  return row.kind === "created" && row.publicationRequested && !row.isPublished;
}

function scopedAgentId(accountId: string, userId: string, agentId: string) {
  return `${accountId}:${userId}:${agentId}`;
}

function scopedActionKey(accountId: string, userId: string, actionKey: string) {
  return `${accountId}:${userId}:${actionKey}`;
}

type BuiltAgentUsage = {
  total: number;
  cavai: number;
  caven: number;
};

function formatCompactCount(value: number) {
  return `${formatInt(value)} use${value === 1 ? "" : "s"}`;
}

export default async function AiAgentsPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/ai-agents", { scopes: ["platform.read", "accounts.read"] });

  const q = s(props.searchParams?.q).trim().toLowerCase();
  const catalog = s(props.searchParams?.catalog).trim().toLowerCase();
  const surfaceFilter = s(props.searchParams?.surface).trim().toLowerCase();
  const accountFilter = s(props.searchParams?.accountId).trim();
  const range = parseAdminRange(s(props.searchParams?.range), "30d");
  const month = parseAdminMonth(s(props.searchParams?.month));
  const window = resolveAdminWindow(range, month);
  const start = window.start;
  const end = window.end;
  const rangeLabel = window.label;

  const trackedAgents = await listAdminTrackedAgents({ limit: 240 });
  const liveTrackedAgents = trackedAgents.filter((row) => row.isActive);
  const trackedAccountIds = Array.from(new Set(liveTrackedAgents.map((row) => row.accountId)));
  const trackedUserIds = Array.from(new Set(liveTrackedAgents.map((row) => row.userId)));

  const [
    accounts,
    creators,
    ownerMap,
    subscriptionMap,
    disciplineMap,
    publishedMap,
    usageByAccount,
    userMessages,
  ] = await Promise.all([
    trackedAccountIds.length
      ? prisma.account.findMany({
          where: { id: { in: trackedAccountIds } },
          select: {
            id: true,
            name: true,
            slug: true,
            tier: true,
            trialSeatActive: true,
            trialEndsAt: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    trackedUserIds.length
      ? prisma.user.findMany({
          where: { id: { in: trackedUserIds } },
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            fullName: true,
            avatarImage: true,
            avatarTone: true,
          },
        })
      : Promise.resolve([]),
    getAccountOwners(trackedAccountIds),
    getLatestSubscriptions(trackedAccountIds),
    getAccountDisciplineMap(trackedAccountIds),
    getPublishedOperatorAgentMap(),
    trackedAccountIds.length
      ? prisma.cavAiUsageLog.groupBy({
          by: ["accountId"],
          where: {
            accountId: { in: trackedAccountIds },
            createdAt: { gte: start, lt: end },
          },
          _sum: {
            totalTokens: true,
          },
        })
      : Promise.resolve([]),
    prisma.cavAiMessage.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        role: "user",
      },
      select: {
        accountId: true,
        createdAt: true,
        contentJson: true,
        session: {
          select: {
            userId: true,
            surface: true,
          },
        },
      },
    }),
  ]);

  const accountMap = new Map(accounts.map((row) => [row.id, row]));
  const creatorMap = new Map(creators.map((row) => [row.id, row]));
  const tokenUsageByAccountId = new Map(
    usageByAccount.map((row) => [row.accountId, Number(row._sum.totalTokens || 0)]),
  );

  const trackedByScopedId = new Map(
    liveTrackedAgents.map((row) => [scopedAgentId(row.accountId, row.userId, row.agentId), row]),
  );
  const trackedByScopedAction = new Map(
    liveTrackedAgents.map((row) => [scopedActionKey(row.accountId, row.userId, row.actionKey), row]),
  );

  const hqBuiltInCatalog = AGENT_CATALOG
    .filter((row) => row.visibility !== "hidden_mode_feature")
    .sort((left, right) => left.displayOrder - right.displayOrder);
  const builtInById = new Map(
    hqBuiltInCatalog.map((row) => [row.id, row]),
  );
  const builtInByAction = new Map(
    hqBuiltInCatalog.map((row) => [row.actionKey, row]),
  );

  const customUsageByTrackingId = new Map<string, BuiltAgentUsage>();
  const builtInUsageById = new Map<string, BuiltAgentUsage>();
  const accountUsageSurfaceByAccountId = new Map<string, { cavai: number; caven: number }>();
  const customUsageTrendInput: Array<{ date: Date; value: number; secondaryValue: number }> = [];

  for (const row of userMessages) {
    const payload = asRecord(row.contentJson);
    const agentId = String(payload.agentId || "").trim().toLowerCase();
    const actionKey = String(payload.agentActionKey || "").trim().toLowerCase();
    const sessionUserId = String(row.session?.userId || "").trim();
    const bucketKey = usageSurfaceBucket(String(row.session?.surface || ""));
    const accountSurface = accountUsageSurfaceByAccountId.get(row.accountId) || { cavai: 0, caven: 0 };
    accountSurface[bucketKey] += 1;
    accountUsageSurfaceByAccountId.set(row.accountId, accountSurface);

    const custom = agentId
      ? trackedByScopedId.get(scopedAgentId(row.accountId, sessionUserId, agentId))
      : trackedByScopedAction.get(scopedActionKey(row.accountId, sessionUserId, actionKey));
    if (custom) {
      const bucket = customUsageByTrackingId.get(custom.trackingId) || { total: 0, cavai: 0, caven: 0 };
      bucket.total += 1;
      bucket[bucketKey] += 1;
      customUsageByTrackingId.set(custom.trackingId, bucket);
      customUsageTrendInput.push({
        date: row.createdAt,
        value: bucketKey === "caven" ? 1 : 0,
        secondaryValue: bucketKey === "cavai" ? 1 : 0,
      });
      continue;
    }

    const builtIn = agentId ? builtInById.get(agentId) : builtInByAction.get(actionKey);
    if (!builtIn) continue;
    const bucket = builtInUsageById.get(builtIn.id) || { total: 0, cavai: 0, caven: 0 };
    bucket.total += 1;
    bucket[bucketKey] += 1;
    builtInUsageById.set(builtIn.id, bucket);
  }

  const liveCreatedCountByAccount = new Map<string, number>();
  for (const row of liveTrackedAgents) {
    liveCreatedCountByAccount.set(row.accountId, (liveCreatedCountByAccount.get(row.accountId) || 0) + 1);
  }

  const creationTrendInput = liveTrackedAgents.flatMap((row) => {
    const createdAt = parseDate(row.createdAt);
    if (!createdAt || createdAt < start || createdAt >= end) return [];
    return [{
      date: createdAt,
      value: row.surface === "cavcode" || row.surface === "all" ? 1 : 0,
      secondaryValue: row.surface === "center" || row.surface === "all" ? 1 : 0,
    }];
  });

  const windowCreatedAgents = liveTrackedAgents.filter((row) => {
    const createdAt = parseDate(row.createdAt);
    return createdAt ? createdAt >= start && createdAt < end : false;
  });
  const cavaiPlacementCount = windowCreatedAgents.filter((row) => row.surface === "center" || row.surface === "all").length;
  const cavenPlacementCount = windowCreatedAgents.filter((row) => row.surface === "cavcode" || row.surface === "all").length;
  const generatedWithCavAiCount = windowCreatedAgents.filter((row) => row.generatedWithCavAi).length;
  const publishedLiveCount = liveTrackedAgents.filter((row) =>
    publishedMap.has(`${row.accountId}:${row.userId}:${row.agentId}`),
  ).length;

  const topCustomUsage = Array.from(customUsageByTrackingId.entries())
    .map(([trackingId, usage]) => ({
      trackingId,
      usage,
      row: liveTrackedAgents.find((agent) => agent.trackingId === trackingId) || null,
    }))
    .filter((row) => row.row)
    .sort((left, right) => right.usage.total - left.usage.total)[0] || null;

  const topCreatorAccount = Array.from(liveCreatedCountByAccount.entries())
    .map(([accountId, count]) => ({
      accountId,
      count,
      account: accountMap.get(accountId) || null,
    }))
    .sort((left, right) => right.count - left.count)[0] || null;

  const topTokenAccount = Array.from(tokenUsageByAccountId.entries())
    .map(([accountId, totalTokens]) => ({
      accountId,
      totalTokens,
      account: accountMap.get(accountId) || null,
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)[0] || null;

  const creationTrend = buildAdminTrendPoints(creationTrendInput, range, month);
  const usageTrend = buildAdminTrendPoints(customUsageTrendInput, range, month);

  const realCreatedRows: AiAgentDirectoryRow[] = liveTrackedAgents.map((row) => {
    const creator = creatorMap.get(row.userId);
    const owner = ownerMap.get(row.accountId);
    const account = accountMap.get(row.accountId);
    const subscription = subscriptionMap.get(row.accountId);
    const planDisplay = resolveAdminPlanDisplay({
      tier: account?.tier,
      status: subscription?.status,
      subscriptionTier: subscription?.tier,
      currentPeriodEnd: subscription?.currentPeriodEnd,
      trialSeatActive: account?.trialSeatActive,
      trialEndsAt: account?.trialEndsAt,
    });
    const usage = customUsageByTrackingId.get(row.trackingId) || { total: 0, cavai: 0, caven: 0 };
    const tokenUsage = tokenUsageByAccountId.get(row.accountId) || 0;
    const accountSurfaceUsage = accountUsageSurfaceByAccountId.get(row.accountId) || { cavai: 0, caven: 0 };
    const published = publishedMap.get(`${row.accountId}:${row.userId}:${row.agentId}`) || null;
    const discipline = disciplineMap.get(row.accountId) || null;
    const creatorName = formatUserName(creator, "Workspace member");
    const creatorHandle = formatUserHandle(creator, "No creator handle");
    const accountCard: AiAgentAccountCardData | null = account ? {
      accountId: account.id,
      accountName: account.name,
      accountHandle: `@${account.slug}`,
      planLabel: planDisplay.planLabel,
      ownerName: formatUserName(owner, "No owner"),
      ownerHandle: formatUserHandle(owner, "No owner"),
      creatorName,
      creatorHandle,
      creatorEmail: String(creator?.email || owner?.email || "unknown@cavbot.local"),
      avatarImage: creator?.avatarImage || owner?.avatarImage || null,
      avatarTone: creator?.avatarTone || owner?.avatarTone || "lime",
      publicProfileHref: creator?.username ? buildCanonicalPublicProfileHref(creator.username) : null,
      clientDetailHref: creator?.id ? `/clients/${creator.id}` : null,
      accountDetailHref: `/accounts/${account.id}`,
      createdAgentsLabel: formatInt(liveCreatedCountByAccount.get(row.accountId) || 0),
      tokensLabel: formatInt(tokenUsage),
      cavaiUsageLabel: formatInt(accountSurfaceUsage.cavai),
      cavenUsageLabel: formatInt(accountSurfaceUsage.caven),
      disciplineStatusLabel: discipline?.status === "REVOKED" ? "Revoked" : discipline?.status === "SUSPENDED" ? "Suspended" : "Active",
      disciplineTone: discipline?.status === "REVOKED" ? "bad" : discipline?.status === "SUSPENDED" ? "watch" : "good",
      violationCountLabel: formatInt(discipline?.violationCount || 0),
      updatedLabel: formatDateTime(discipline?.updatedAtISO ? new Date(discipline.updatedAtISO) : account.updatedAt),
      manageable: true,
    } : null;

    return {
      id: `tracked:${row.trackingId}`,
      kind: "created",
      name: row.name,
      summary: row.summary,
      iconSvg: row.iconSvg,
      iconBackground: row.iconBackground,
      agentIdValue: row.agentId,
      actionKey: row.actionKey,
      surface: row.surface,
      surfaceLabel: surfaceLabel(row.surface),
      createdAtLabel: formatDateTime(new Date(row.createdAt)),
      createdAtISO: row.createdAt,
      usageCountLabel: formatCompactCount(usage.total),
      cavaiUsageLabel: formatCompactCount(usage.cavai),
      cavenUsageLabel: formatCompactCount(usage.caven),
      creationSourceLabel: creationSourceLabel(row.creationSource),
      creationPromptLabel: row.creationPrompt || "No typed prompt captured for this agent.",
      instructions: row.instructions,
      triggers: row.triggers,
      publicationLabel: published ? `Published ${formatDateTime(new Date(published.publishedAt))}` : row.publicationRequested ? "Queued for review" : "Private to creator",
      publicationRequested: row.publicationRequested,
      isPublished: Boolean(published),
      creatorHandleLabel: creatorHandle,
      creatorNameLabel: creatorName,
      creatorUserId: row.userId,
      accountNameLabel: account ? `${account.name} · ${planDisplay.planLabel}` : row.accountId,
      accountId: row.accountId,
      account: accountCard,
    };
  });

  const cavbotRows: AiAgentDirectoryRow[] = hqBuiltInCatalog
    .map((row) => ({
      row,
      usage: builtInUsageById.get(row.id) || { total: 0, cavai: 0, caven: 0 },
    }))
    .sort((left, right) => right.usage.total - left.usage.total || left.row.name.localeCompare(right.row.name))
    .map(({ row, usage }) => ({
      id: `cavbot:${row.id}`,
      kind: "cavbot",
      name: row.name,
      summary: row.summary,
      iconSrc: row.iconSrc || null,
      agentIdValue: row.id,
      actionKey: row.actionKey,
      surface: normalizeSurface(row.surface),
      surfaceLabel: surfaceLabel(normalizeSurface(row.surface)),
      createdAtLabel: "CavBot catalog",
      createdAtISO: "2026-01-01T00:00:00.000Z",
      usageCountLabel: formatCompactCount(usage.total),
      cavaiUsageLabel: formatCompactCount(usage.cavai),
      cavenUsageLabel: formatCompactCount(usage.caven),
      creationSourceLabel: "CavBot built-in",
      creationPromptLabel: "CavBot built-in catalog agent.",
      instructions: row.summary,
      triggers: [row.actionKey],
      publicationLabel: "Live CavBot agent",
      publicationRequested: false,
      isPublished: true,
      creatorHandleLabel: "@cavbot",
      creatorNameLabel: "CavBot",
      creatorUserId: null,
      accountNameLabel: "CavBot operator catalog",
      accountId: null,
      account: null,
    }));

  const accountOptions = Array.from(
    new Map(
      realCreatedRows
        .filter((row) => row.account)
        .map((row) => [row.account!.accountId, { value: row.account!.accountId, label: row.account!.accountName }]),
    ).values(),
  ).sort((left, right) => left.label.localeCompare(right.label));

  const reviewRows = realCreatedRows.filter((row) => isReviewQueueRow(row));

  const filteredRows = [...realCreatedRows, ...cavbotRows]
    .filter((row) => {
      if (catalog === "review" && !isReviewQueueRow(row)) return false;
      if (catalog === "created" && (row.kind !== "created" || isReviewQueueRow(row))) return false;
      if (catalog === "cavbot" && row.kind !== "cavbot") return false;
      if (!matchesSurfaceFilter(row.surface, surfaceFilter)) return false;
      if (accountFilter && row.account?.accountId !== accountFilter) return false;
      if (!q) return true;
      const haystack = [
        row.name,
        row.summary,
        row.creatorHandleLabel,
        row.creatorNameLabel,
        row.accountNameLabel,
        row.actionKey,
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    })
    .sort((left, right) => {
      const leftTs = parseDate(left.createdAtISO)?.getTime() || 0;
      const rightTs = parseDate(right.createdAtISO)?.getTime() || 0;
      return rightTs - leftTs || left.name.localeCompare(right.name);
    });

  const topCreatorRows = Array.from(liveCreatedCountByAccount.entries())
    .map(([accountId, count]) => ({
      accountId,
      count,
      account: accountMap.get(accountId) || null,
      owner: ownerMap.get(accountId) || null,
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 8);

  const tokenRows = Array.from(tokenUsageByAccountId.entries())
    .map(([accountId, totalTokens]) => ({
      accountId,
      totalTokens,
      account: accountMap.get(accountId) || null,
      owner: ownerMap.get(accountId) || null,
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
    .slice(0, 8);

  const builtInUsageRows = cavbotRows.slice(0, 8);

  return (
    <AdminPage
      title="Ai Agents"
      subtitle="Separate HQ intelligence for created operator agents, CavBot agent usage, publication control, prompts, tokens, and account-level intervention."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard
          label="Created agents"
          value={formatInt(windowCreatedAgents.length)}
          meta={`${formatInt(liveTrackedAgents.length)} live created agents currently tracked`}
        />
        <MetricCard
          label="CavAi placements"
          value={formatInt(cavaiPlacementCount)}
          meta={`Created for CavAi or all surfaces in ${rangeLabel}`}
        />
        <MetricCard
          label="Caven placements"
          value={formatInt(cavenPlacementCount)}
          meta={`Created for Caven or all surfaces in ${rangeLabel}`}
        />
        <MetricCard
          label="Generated with CavAi"
          value={formatInt(generatedWithCavAiCount)}
          meta="Created with CavAi generation or draft assistance"
        />
        <MetricCard
          label="Published live"
          value={formatInt(publishedLiveCount)}
          meta="Created agents already pushed to operator-wide availability"
        />
        <MetricCard
          label="Most popular agent"
          value={topCustomUsage?.row?.name || "No agent yet"}
          meta={topCustomUsage ? `${formatInt(topCustomUsage.usage.total)} prompts routed through this agent` : "No created-agent usage in the selected window"}
        />
        <MetricCard
          label="Top creator account"
          value={topCreatorAccount?.account?.name || "No account yet"}
          meta={topCreatorAccount ? `${formatInt(topCreatorAccount.count)} live created agents attached` : "No tracked created agents yet"}
        />
        <MetricCard
          label="Top token account"
          value={topTokenAccount?.account?.name || "No token data yet"}
          meta={topTokenAccount ? `${formatInt(topTokenAccount.totalTokens)} CavAi tokens used in ${rangeLabel}` : "No token usage captured in this window"}
        />
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Creation comparison"
          subtitle="Created-agent placements split between Caven and CavAi."
          labels={creationTrend.map((row) => row.label)}
          primary={creationTrend.map((row) => row.value)}
          secondary={creationTrend.map((row) => row.secondaryValue || 0)}
          primaryLabel="Caven placements"
          secondaryLabel="CavAi placements"
          primaryTone="primary"
          secondaryTone="lime"
        />
        <TrendChart
          title="Usage comparison"
          subtitle="Created-agent prompts split by where users actually invoked them."
          labels={usageTrend.map((row) => row.label)}
          primary={usageTrend.map((row) => row.value)}
          secondary={usageTrend.map((row) => row.secondaryValue || 0)}
          primaryLabel="Caven usage"
          secondaryLabel="CavAi usage"
          primaryTone="orange"
          secondaryTone="lime"
        />
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel
          title="Top creator accounts"
          subtitle="Accounts currently holding the deepest created-agent footprint."
        >
          {topCreatorRows.length ? (
            <div className="hq-list">
              {topCreatorRows.map((row) => (
                <div key={row.accountId} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{row.account?.name || row.accountId}</div>
                    <div className="hq-listMeta">{formatUserHandle(row.owner)} · {resolveAdminPlanDisplay({ tier: row.account?.tier }).planLabel}</div>
                  </div>
                  <div className="hq-listMeta">{formatInt(row.count)} agents</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No creator accounts yet." subtitle="Created-agent accounts will appear here as soon as operators save custom agents." />
          )}
        </Panel>

        <Panel
          title="CavBot agent use"
          subtitle="Built-in CavBot agents separated from created agents so they never collapse into the same lane."
        >
          {builtInUsageRows.length ? (
            <div className="hq-list">
              {builtInUsageRows.map((row) => (
                <div key={row.id} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{row.name}</div>
                    <div className="hq-listMeta">{row.surfaceLabel} · {row.actionKey}</div>
                  </div>
                  <div className="hq-listMeta">{row.usageCountLabel}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No CavBot agent usage yet." subtitle="Built-in CavBot agent traffic will render here once usage is persisted." />
          )}
        </Panel>
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel
          title="Token burn by account"
          subtitle="Monthly CavAi token usage so HQ can see who is pulling the heaviest AI load."
        >
          {tokenRows.length ? (
            <div className="hq-list">
              {tokenRows.map((row) => (
                <div key={row.accountId} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{row.account?.name || row.accountId}</div>
                    <div className="hq-listMeta">{formatUserHandle(row.owner)} · {resolveAdminPlanDisplay({ tier: row.account?.tier }).planLabel}</div>
                  </div>
                  <div className="hq-listMeta">{formatInt(row.totalTokens)} tokens</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No token usage yet." subtitle="CavAi usage logs will surface token totals here once traffic is captured." />
          )}
        </Panel>

        <Panel
          title="For review"
          subtitle="All newly submitted agents land here before they move into the main created-agent catalog."
        >
          {reviewRows.length ? (
            <div className="hq-list">
              {reviewRows
                .slice(0, 8)
                .map((row) => (
                  <div key={row.id} className="hq-listRow">
                    <div>
                      <div className="hq-listLabel">{row.name}</div>
                      <div className="hq-listMeta">{row.creatorHandleLabel} · {row.accountNameLabel}</div>
                    </div>
                    <div className="hq-listMeta">{row.surfaceLabel}</div>
                  </div>
                ))}
            </div>
          ) : (
            <EmptyState title="No agents queued right now." subtitle="When operators ask for publication review, the queue shows here immediately." />
          )}
        </Panel>
      </section>

      <Panel
        title="Agent directory"
        subtitle="Toggle between created agents and CavBot agents, drill into prompt provenance, and manage accounts behind each created agent."
      >
        <section className="hq-filterShell">
          <form className="hq-filterRail">
            <input type="hidden" name="range" value={range} />
            <input type="hidden" name="month" value={month || ""} />
            <label className="hq-filterField hq-filterFieldSearch">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <input
                className="hq-filterInput"
                type="search"
                name="q"
                placeholder="Search agent, creator, account, action key"
                defaultValue={s(props.searchParams?.q)}
                aria-label="Agent search"
              />
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="catalog" defaultValue={catalog} aria-label="Catalog filter">
                <option value="">All catalogs</option>
                <option value="review">For review</option>
                <option value="created">Created agents</option>
                <option value="cavbot">CavBot agents</option>
              </select>
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="surface" defaultValue={surfaceFilter} aria-label="Surface filter">
                <option value="">All surfaces</option>
                <option value="caven">Caven</option>
                <option value="cavai">CavAi</option>
                <option value="everywhere">All surfaces only</option>
              </select>
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="accountId" defaultValue={accountFilter} aria-label="Account filter">
                <option value="">All accounts</option>
                {accountOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="hq-filterActions">
              <button className="hq-button" type="submit">Apply</button>
            </div>
          </form>
        </section>

        {filteredRows.length ? (
          <AiAgentsDirectory rows={filteredRows} />
        ) : (
          <EmptyState
            title="No agents match these filters."
            subtitle="Adjust the catalog, surface, account, or search filters to widen the agent intelligence view."
          />
        )}
      </Panel>
    </AdminPage>
  );
}
