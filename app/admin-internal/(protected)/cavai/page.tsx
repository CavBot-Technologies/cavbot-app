import { Prisma } from "@prisma/client";

import {
  AdminPage,
  Badge,
  MetricCard,
  Panel,
  PlanSharePanel,
  TrendChart,
} from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
  buildAdminTrendPoints,
  formatDateTime,
  formatInt,
  formatPercent,
  parseAdminMonth,
  parseAdminRange,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { INSTALLABLE_AGENT_CATALOG } from "@/lib/cavai/agentCatalog";
import { prisma } from "@/lib/prisma";
import {
  ALIBABA_QWEN_CHARACTER_MODEL_ID,
  ALIBABA_QWEN_FLASH_MODEL_ID,
  ALIBABA_QWEN_MAX_MODEL_ID,
  ALIBABA_QWEN_PLUS_MODEL_ID,
  CAVAI_AUTO_MODEL_ID,
  DEEPSEEK_CHAT_MODEL_ID,
  DEEPSEEK_REASONER_MODEL_ID,
  resolveAiModelCanonicalId,
  resolveAiModelLabel,
  resolveAiTextModelMetadata,
} from "@/src/lib/ai/model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY_IMAGE_SUMMARY = {
  jobs: 0,
  completed: 0,
  generated: 0,
  edited: 0,
  assets: 0,
  savedAssets: 0,
  installedAgents: 0,
};

function s(value: unknown) {
  return String(value || "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeAction(action: string) {
  const normalized = s(action).toLowerCase();
  if (!normalized) return "Unknown action";
  if (normalized === "companion_chat") return "CavBot Companion";
  if (normalized === "technical_recap") return "Technical recap";
  if (normalized === "explain_code") return "Explain code";
  if (normalized === "image_studio") return "Image Studio";
  if (normalized === "image_edit") return "Image edit";
  return titleCase(normalized);
}

function humanizeSurfaceMeta(surface: string) {
  const normalized = s(surface).toLowerCase();
  if (normalized === "general") return "Open-ended AI Center usage";
  if (normalized === "cavcode") return "Coding-focused Caven usage";
  if (normalized === "workspace") return "Workspace-bound AI usage";
  if (normalized === "console") return "Console-linked AI usage";
  if (normalized === "cavcloud") return "CavCloud AI usage";
  if (normalized === "cavsafe") return "CavSafe AI usage";
  if (normalized === "cavpad") return "CavPad AI usage";
  return `${humanizeAction(surface)} usage`;
}

function humanizeModel(model: string) {
  const normalized = s(model);
  if (!normalized) return "No model";
  return resolveAiModelLabel(normalized) || titleCase(normalized.replace(/\./g, " "));
}

function providerLabelForModel(model: string) {
  const canonical = resolveAiModelCanonicalId(model);
  if (!canonical || canonical === CAVAI_AUTO_MODEL_ID) return "CavBot routing";
  const providerId = String(resolveAiTextModelMetadata(canonical).provider || "");
  if (providerId === "alibaba_qwen") return "Alibaba Qwen";
  if (providerId === "deepseek") return "DeepSeek";
  return titleCase(providerId.replace(/_/g, " "));
}

const FRONT_FACING_CAVAI_MODEL_IDS = [
  CAVAI_AUTO_MODEL_ID,
  ALIBABA_QWEN_CHARACTER_MODEL_ID,
  DEEPSEEK_CHAT_MODEL_ID,
  ALIBABA_QWEN_FLASH_MODEL_ID,
  DEEPSEEK_REASONER_MODEL_ID,
  ALIBABA_QWEN_PLUS_MODEL_ID,
  ALIBABA_QWEN_MAX_MODEL_ID,
];

type PersistedCustomAgent = {
  accountId: string;
  userId: string;
  id: string;
  name: string;
  actionKey: string;
  createdAt: string | null;
};

type ResolvedTrackedAgent = {
  key: string;
  label: string;
  kind: "built_in" | "custom";
};

const TRACKED_BUILT_IN_AGENT_BY_ID = new Map(
  INSTALLABLE_AGENT_CATALOG.map((row) => [row.id, row]),
);
const TRACKED_BUILT_IN_AGENT_BY_ACTION_KEY = new Map(
  INSTALLABLE_AGENT_CATALOG.map((row) => [row.actionKey, row]),
);

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseDate(value: unknown) {
  const raw = s(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function scopedAgentId(accountId: string, userId: string, agentId: string) {
  return `${accountId}:${userId}:${agentId}`;
}

function scopedAgentActionKey(accountId: string, userId: string, actionKey: string) {
  return `${accountId}:${userId}:${actionKey}`;
}

function parseCustomAgentsForOwner(args: {
  accountId: string;
  userId: string;
  customAgents: unknown;
}) {
  const rows: PersistedCustomAgent[] = [];

  for (const row of asArray(args.customAgents)) {
    const record = asRecord(row);
    const id = s(record.id).toLowerCase();
    const actionKey = s(record.actionKey).toLowerCase();
    if (!id || !actionKey) continue;
    rows.push({
      accountId: args.accountId,
      userId: args.userId,
      id,
      name: s(record.name) || titleCase(id.replace(/^custom_/, "").replace(/[_-]+/g, " ")),
      actionKey,
      createdAt: s(record.createdAt) || null,
    });
  }

  return rows;
}

function resolveTrackedAgent(args: {
  accountId: string;
  userId: string;
  contentJson: unknown;
  customAgentsByScopedId: ReadonlyMap<string, PersistedCustomAgent>;
  customAgentsByScopedActionKey: ReadonlyMap<string, PersistedCustomAgent>;
}) {
  const payload = asRecord(args.contentJson);
  const agentId = s(payload.agentId).toLowerCase();
  const agentActionKey = s(payload.agentActionKey).toLowerCase();

  if (agentId) {
    const builtIn = TRACKED_BUILT_IN_AGENT_BY_ID.get(agentId);
    if (builtIn) {
      return {
        key: `built_in:${builtIn.id}`,
        label: builtIn.name,
        kind: "built_in",
      } satisfies ResolvedTrackedAgent;
    }
    const custom = args.customAgentsByScopedId.get(scopedAgentId(args.accountId, args.userId, agentId));
    if (custom) {
      return {
        key: `custom:${args.accountId}:${args.userId}:${custom.id}`,
        label: custom.name,
        kind: "custom",
      } satisfies ResolvedTrackedAgent;
    }
  }

  if (agentActionKey) {
    const builtIn = TRACKED_BUILT_IN_AGENT_BY_ACTION_KEY.get(agentActionKey);
    if (builtIn) {
      return {
        key: `built_in:${builtIn.id}`,
        label: builtIn.name,
        kind: "built_in",
      } satisfies ResolvedTrackedAgent;
    }
    const custom = args.customAgentsByScopedActionKey.get(
      scopedAgentActionKey(args.accountId, args.userId, agentActionKey),
    );
    if (custom) {
      return {
        key: `custom:${args.accountId}:${args.userId}:${custom.id}`,
        label: custom.name,
        kind: "custom",
      } satisfies ResolvedTrackedAgent;
    }
  }

  return null;
}

async function hasImageStudioTable(tableName: "image_jobs" | "image_assets" | "user_image_history" | "agent_install_state") {
  try {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = ${tableName}
      ) AS "exists"
    `);
    return Boolean(rows[0]?.exists);
  } catch {
    return false;
  }
}

async function readImageStudioSummary(start: Date, end: Date) {
  const [jobsAvailable, assetsAvailable, historyAvailable, installsAvailable] = await Promise.all([
    hasImageStudioTable("image_jobs"),
    hasImageStudioTable("image_assets"),
    hasImageStudioTable("user_image_history"),
    hasImageStudioTable("agent_install_state"),
  ]);

  if (!jobsAvailable && !assetsAvailable && !historyAvailable && !installsAvailable) {
    return {
      summary: EMPTY_IMAGE_SUMMARY,
      trend: [] as Array<{ createdAt: Date; count: number }>,
    };
  }

  try {
    const [jobSummaryRows, jobTrendRows, assetSummaryRows, historySummaryRows, installSummaryRows] = await Promise.all([
      jobsAvailable
        ? prisma.$queryRaw<Array<{ jobs: number; completed: number; generated: number; edited: number }>>(Prisma.sql`
            SELECT
              COUNT(*)::int AS "jobs",
              COUNT(*) FILTER (WHERE status = 'completed')::int AS "completed",
              COUNT(*) FILTER (WHERE mode = 'generate')::int AS "generated",
              COUNT(*) FILTER (WHERE mode = 'edit')::int AS "edited"
            FROM image_jobs
            WHERE created_at >= ${start}
              AND created_at < ${end}
          `)
        : Promise.resolve([]),
      jobsAvailable
        ? prisma.$queryRaw<Array<{ createdAt: Date; count: number }>>(Prisma.sql`
            SELECT
              DATE_TRUNC('day', created_at)::timestamp AS "createdAt",
              COUNT(*)::int AS "count"
            FROM image_jobs
            WHERE created_at >= ${start}
              AND created_at < ${end}
            GROUP BY 1
            ORDER BY 1 ASC
          `)
        : Promise.resolve([]),
      assetsAvailable
        ? prisma.$queryRaw<Array<{ assets: number }>>(Prisma.sql`
            SELECT COUNT(*)::int AS "assets"
            FROM image_assets
            WHERE created_at >= ${start}
              AND created_at < ${end}
          `)
        : Promise.resolve([]),
      historyAvailable
        ? prisma.$queryRaw<Array<{ savedEntries: number }>>(Prisma.sql`
            SELECT COUNT(*) FILTER (WHERE saved = true)::int AS "savedEntries"
            FROM user_image_history
            WHERE created_at >= ${start}
              AND created_at < ${end}
          `)
        : Promise.resolve([]),
      installsAvailable
        ? prisma.$queryRaw<Array<{ installs: number }>>(Prisma.sql`
            SELECT COUNT(*) FILTER (WHERE installed = true)::int AS "installs"
            FROM agent_install_state
            WHERE updated_at >= ${start}
              AND updated_at < ${end}
          `)
        : Promise.resolve([]),
    ]);

    return {
      summary: {
        jobs: Number(jobSummaryRows[0]?.jobs || 0),
        completed: Number(jobSummaryRows[0]?.completed || 0),
        generated: Number(jobSummaryRows[0]?.generated || 0),
        edited: Number(jobSummaryRows[0]?.edited || 0),
        assets: Number(assetSummaryRows[0]?.assets || 0),
        savedAssets: Number(historySummaryRows[0]?.savedEntries || 0),
        installedAgents: Number(installSummaryRows[0]?.installs || 0),
      },
      trend: jobTrendRows.map((row) => ({
        createdAt: new Date(row.createdAt),
        count: Number(row.count || 0),
      })),
    };
  } catch {
    return {
      summary: EMPTY_IMAGE_SUMMARY,
      trend: [] as Array<{ createdAt: Date; count: number }>,
    };
  }
}

export default async function CavAiPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/cavai", { scopes: ["platform.read"] });

  const rawRange = Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range;
  const rawMonth = Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month;
  const range = parseAdminRange(rawRange);
  const month = parseAdminMonth(rawMonth);
  const window = resolveAdminWindow(range, month);
  const start = window.start;
  const end = window.end;
  const rangeLabel = window.label;

  const [sessions, assistantMessages, userMessages, retryCount, agentJobs, imageStudio, cavenSettingsRows] = await Promise.all([
    prisma.cavAiSession.findMany({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        surface: true,
        title: true,
        contextLabel: true,
        contextJson: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.cavAiMessage.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        role: "assistant",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        sessionId: true,
        action: true,
        model: true,
        provider: true,
        createdAt: true,
      },
    }),
    prisma.cavAiMessage.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        role: "user",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        accountId: true,
        createdAt: true,
        contentJson: true,
        session: {
          select: {
            userId: true,
          },
        },
      },
    }),
    prisma.cavAiRetryEvent.count({
      where: { createdAt: { gte: start, lt: end } },
    }),
    prisma.cavAiAgentJob.findMany({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        jobType: true,
        status: true,
        state: true,
        createdAt: true,
        completedAt: true,
      },
    }),
    readImageStudioSummary(start, end),
    prisma.cavenSettings.findMany({
      select: {
        accountId: true,
        userId: true,
        customAgents: true,
      },
    }),
  ]);

  const assistantActionsBySession = new Map<string, Set<string>>();
  const actionCounts = new Map<string, number>();
  const modelCounts = new Map<string, { count: number; provider: string | null }>();

  for (const row of assistantMessages) {
    const action = s(row.action).toLowerCase() || "unknown";
    const model = resolveAiModelCanonicalId(s(row.model)) || s(row.model);
    if (row.sessionId) {
      const bucket = assistantActionsBySession.get(row.sessionId) || new Set<string>();
      bucket.add(action);
      assistantActionsBySession.set(row.sessionId, bucket);
    }
    actionCounts.set(action, (actionCounts.get(action) || 0) + 1);
    if (model) {
      const bucket = modelCounts.get(model) || { count: 0, provider: s(row.provider) || null };
      bucket.count += 1;
      if (!bucket.provider && s(row.provider)) bucket.provider = s(row.provider);
      modelCounts.set(model, bucket);
    }
  }

  const pathCounts = {
    chatBox: 0,
    aiCenter: 0,
    caven: 0,
  };
  const surfaceCounts = new Map<string, number>();

  for (const session of sessions) {
    const surface = s(session.surface).toLowerCase() || "unknown";
    const context = asRecord(session.contextJson);
    const routePathname = s(context.routePathname).toLowerCase();
    const launchSurface = s(context.launchSurface || context.surface).toLowerCase();
    const actions = assistantActionsBySession.get(session.id) || new Set<string>();

    surfaceCounts.set(surface, (surfaceCounts.get(surface) || 0) + 1);

    if (surface === "cavcode") {
      pathCounts.caven += 1;
      continue;
    }
    if (actions.has("companion_chat")) {
      pathCounts.chatBox += 1;
      continue;
    }
    if (routePathname.startsWith("/cavai") || launchSurface === "general" || launchSurface === "workspace" || launchSurface === "console" || surface !== "unknown") {
      pathCounts.aiCenter += 1;
      continue;
    }
    pathCounts.aiCenter += 1;
  }

  const topActions = Array.from(actionCounts.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 8);

  const topModels = Array.from(modelCounts.entries())
    .map(([model, value]) => ({
      model,
      count: value.count,
      provider: value.provider,
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 8);
  const selectableModels = FRONT_FACING_CAVAI_MODEL_IDS.map((modelId) => {
    const usage = modelCounts.get(modelId);
    return {
      model: modelId,
      count: usage?.count || 0,
      provider: providerLabelForModel(modelId),
    };
  });

  const leadModel = topModels[0] || null;
  const customAgents = cavenSettingsRows.flatMap((row) =>
    parseCustomAgentsForOwner({
      accountId: row.accountId,
      userId: row.userId,
      customAgents: row.customAgents,
    }),
  );
  const customAgentsByScopedId = new Map(
    customAgents.map((agent) => [scopedAgentId(agent.accountId, agent.userId, agent.id), agent]),
  );
  const customAgentsByScopedActionKey = new Map(
    customAgents.map((agent) => [scopedAgentActionKey(agent.accountId, agent.userId, agent.actionKey), agent]),
  );
  const agentsCreatedCount = customAgents.filter((agent) => {
    const createdAt = parseDate(agent.createdAt);
    return createdAt ? createdAt >= start && createdAt < end : false;
  }).length;
  const agentUsageCounts = new Map<string, { label: string; kind: "built_in" | "custom"; count: number }>();
  let agentPromptCount = 0;

  for (const row of userMessages) {
    const resolved = resolveTrackedAgent({
      accountId: row.accountId,
      userId: s(row.session?.userId),
      contentJson: row.contentJson,
      customAgentsByScopedId,
      customAgentsByScopedActionKey,
    });
    if (!resolved) continue;
    agentPromptCount += 1;
    const bucket = agentUsageCounts.get(resolved.key) || {
      label: resolved.label,
      kind: resolved.kind,
      count: 0,
    };
    bucket.count += 1;
    agentUsageCounts.set(resolved.key, bucket);
  }

  const topAgent = Array.from(agentUsageCounts.entries())
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => right.count - left.count)[0] || null;
  const agentUsePercent = userMessages.length > 0 ? (agentPromptCount / userMessages.length) * 100 : 0;
  const companionUseCount = actionCounts.get("companion_chat") || 0;
  const promptTrend = buildAdminTrendPoints(
    userMessages.map((row) => ({ date: row.createdAt, value: 1 })),
    range,
    month,
  );
  const imageTrend = buildAdminTrendPoints(
    imageStudio.trend.map((row) => ({ date: row.createdAt, value: row.count })),
    range,
    month,
  );
  const surfaceBuckets = Array.from(surfaceCounts.entries())
    .map(([surface, count]) => ({
      id: surface,
      label: humanizeAction(surface),
      count,
    }))
    .sort((left, right) => right.count - left.count);

  return (
    <AdminPage
      title="CavAi"
      subtitle="Real CavBot tracking across prompts, sessions, model usage, image studio activity, companion traffic, and Caven adoption."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Prompts" value={formatInt(userMessages.length)} meta={`${formatInt(assistantMessages.length)} assistant turns in ${rangeLabel}`} />
        <MetricCard label="Sessions" value={formatInt(sessions.length)} meta={`${formatInt(retryCount)} retries recorded`} />
        <MetricCard label="Most popular model" value={leadModel ? humanizeModel(leadModel.model) : "No model yet"} meta={leadModel ? `${formatInt(leadModel.count)} responses recorded` : "No model selections persisted yet"} />
        <MetricCard label="Images generated" value={formatInt(imageStudio.summary.generated)} meta={`${formatInt(imageStudio.summary.completed)} completed image jobs`} />
        <MetricCard label="Photos edited" value={formatInt(imageStudio.summary.edited)} meta={`${formatInt(imageStudio.summary.assets)} image assets persisted`} />
        <MetricCard label="Companion uses" value={formatInt(companionUseCount)} meta="Assistant turns classified as CavBot Companion" />
        <MetricCard label="AI Center sessions" value={formatInt(pathCounts.aiCenter)} meta="General and workspace CavAi sessions" />
        <MetricCard label="Caven sessions" value={formatInt(pathCounts.caven)} meta="Persisted CavCode session starts" />
      </section>

      <section className="hq-grid hq-gridThree">
        <MetricCard
          label="Agents created"
          value={formatInt(agentsCreatedCount)}
          meta={`${formatInt(customAgents.length)} live custom agents currently persisted in Caven settings`}
        />
        <MetricCard
          label="Agent use"
          value={formatPercent(agentUsePercent, 1)}
          meta={`${formatInt(agentPromptCount)} of ${formatInt(userMessages.length)} prompts routed through a real agent`}
        />
        <MetricCard
          label="Most popular agent"
          value={topAgent?.label || "No agent yet"}
          meta={topAgent ? `${formatInt(topAgent.count)} prompts routed through ${topAgent.kind === "custom" ? "a custom agent" : "a built-in agent"}` : "No tracked agent usage has been persisted yet"}
        />
      </section>

      <section className="hq-grid hq-gridTwo">
        <PlanSharePanel
          title="Use path split"
          subtitle="Real session comparison across the chat box, the dedicated AI center, and Caven."
          items={[
            { label: "Chat box", value: pathCounts.chatBox, tone: "trialing" },
            { label: "AI Center", value: pathCounts.aiCenter, tone: "premium" },
            { label: "Caven", value: pathCounts.caven, tone: "enterprise" },
          ]}
          emptyTitle="No CavAi sessions yet."
          emptySubtitle="As soon as CavBot persists session starts, the comparison chart will render here."
        />

        <Panel
          title="Available models"
          subtitle="Front-facing CavAi models users can choose from right now."
        >
          {selectableModels.length ? (
            <div className="hq-list">
              {selectableModels.map((row) => (
                <div key={row.model} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{humanizeModel(row.model)}</div>
                    <div className="hq-listMeta">{row.provider}</div>
                  </div>
                  <div className="hq-listMeta">{row.model === CAVAI_AUTO_MODEL_ID ? "Router" : `${formatInt(row.count)} turns`}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="hq-empty">
              <p className="hq-emptyTitle">No model rows yet.</p>
              <p className="hq-emptySub">CavAi message models will appear here as soon as assistant turns are persisted with model IDs.</p>
            </div>
          )}
        </Panel>
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Prompt and image traffic"
          subtitle={`Persisted prompt turns versus image studio jobs across ${rangeLabel}.`}
          labels={promptTrend.map((row) => row.label)}
          primary={promptTrend.map((row) => row.value)}
          secondary={imageTrend.map((row) => row.value)}
          primaryLabel="Prompts"
          secondaryLabel="Image jobs"
        />

        <Panel
          title="Action mix"
          subtitle="Assistant actions CavBot is actually serving from the current CavAi dataset."
        >
          {topActions.length ? (
            <div className="hq-list">
              {topActions.map((row) => (
                <div key={row.action} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{humanizeAction(row.action)}</div>
                    <div className="hq-listMeta">{row.action}</div>
                  </div>
                  <div className="hq-listMeta">{formatInt(row.count)} turns</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="hq-empty">
              <p className="hq-emptyTitle">No assistant actions yet.</p>
              <p className="hq-emptySub">Action mix populates as soon as persisted assistant turns reach the CavAi message table.</p>
            </div>
          )}
        </Panel>
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel
          title="Image studio footprint"
          subtitle="Generation, edit, save, and install telemetry captured by the current Image Studio tables."
        >
          <div className="hq-opsSurfaceGrid hq-cavaiSurfaceGrid hq-cavaiImageFootprintGrid">
            <article className="hq-opsSurfaceCard">
              <div className="hq-opsSurfaceLabel">Generated</div>
              <div className="hq-opsSurfaceValue">{formatInt(imageStudio.summary.generated)}</div>
              <p className="hq-opsSurfaceMeta">Image jobs completed in generate mode</p>
            </article>
            <article className="hq-opsSurfaceCard">
              <div className="hq-opsSurfaceLabel">Edited</div>
              <div className="hq-opsSurfaceValue">{formatInt(imageStudio.summary.edited)}</div>
              <p className="hq-opsSurfaceMeta">Image jobs completed in edit mode</p>
            </article>
            <article className="hq-opsSurfaceCard">
              <div className="hq-opsSurfaceLabel">Saved assets</div>
              <div className="hq-opsSurfaceValue">{formatInt(imageStudio.summary.savedAssets)}</div>
              <p className="hq-opsSurfaceMeta">History entries marked as saved</p>
            </article>
            <article className="hq-opsSurfaceCard">
              <div className="hq-opsSurfaceLabel">Installed agents</div>
              <div className="hq-opsSurfaceValue">{formatInt(imageStudio.summary.installedAgents)}</div>
              <p className="hq-opsSurfaceMeta">Image agents actively installed in the window</p>
            </article>
          </div>
        </Panel>

        <Panel
          title="Surface footprint"
          subtitle="Persisted CavAi session surfaces currently active in the monitored window."
        >
          {surfaceBuckets.length ? (
            <div className="hq-opsSurfaceGrid hq-cavaiSurfaceGrid hq-cavaiSurfaceGridStacked">
              {surfaceBuckets.map((row) => (
                <article key={row.id} className="hq-opsSurfaceCard">
                  <div className="hq-opsSurfaceLabel">{row.label}</div>
                  <div className="hq-opsSurfaceValue">
                    <Badge className="hq-badgeCorporate hq-badgeCompact" tone="watch">
                      {formatInt(row.count)}
                    </Badge>
                  </div>
                  <p className="hq-opsSurfaceMeta">{humanizeSurfaceMeta(row.id)}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="hq-empty">
              <p className="hq-emptyTitle">No CavAi session surfaces yet.</p>
              <p className="hq-emptySub">Persisted CavAi sessions will break out by surface here as soon as real traffic is captured.</p>
            </div>
          )}
        </Panel>
      </section>

      <Panel
        title="Latest agent jobs"
        subtitle="Persisted CavAi agent jobs, including status progression and completion timing."
      >
        <div className="hq-cavaiJobsBlock">
          {agentJobs.length ? (
            <div className="hq-list">
              {agentJobs.map((job) => (
                <div key={job.id} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{titleCase(s(job.jobType).replace(/_/g, " "))}</div>
                    <div className="hq-listMeta">{titleCase(s(job.state).replace(/_/g, " "))} · {job.completedAt ? `Completed ${formatDateTime(job.completedAt)}` : `Created ${formatDateTime(job.createdAt)}`}</div>
                  </div>
                  <div className="hq-inlineStart">
                    <span
                      className="hq-opsLifecycleDot"
                      data-tone={job.status === "completed" ? "good" : job.status === "failed" ? "bad" : "watch"}
                      aria-hidden="true"
                    />
                    <span className="hq-listMeta">{titleCase(s(job.status).replace(/_/g, " "))}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="hq-empty">
              <p className="hq-emptyTitle">No agent jobs yet.</p>
              <p className="hq-emptySub">Long-running CavAi jobs will render here as soon as the platform starts persisting them.</p>
            </div>
          )}
        </div>
      </Panel>
    </AdminPage>
  );
}
