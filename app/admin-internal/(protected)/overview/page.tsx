import { prisma } from "@/lib/prisma";
import { AdminPage, Badge, MetricCard, Panel, TrendChart } from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import {
  buildAdminTrendPoints,
  formatDateTime,
  formatInt,
  formatUserHandle,
  formatUserName,
  getAccountFootprints,
  getAccountOwners,
  parseAdminMonth,
  parseAdminRange,
  resolveAdminWindow,
} from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PUBLIC_APP_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.CAVBOT_APP_ORIGIN ||
  process.env.APP_URL ||
  "https://app.cavbot.io";

function formatAuditEntityLabel(entityType: string) {
  const value = String(entityType || "").trim();
  if (!value) return "HQ record";
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index > 0 && lower.length <= 3) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function buildPublicProfileHref(owner?: { username?: string | null }) {
  const username = String(owner?.username || "").trim();
  if (!username) return "";
  const base = PUBLIC_APP_ORIGIN.replace(/\/+$/, "");
  return `${base}/${encodeURIComponent(username)}`;
}

export default async function OverviewPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/overview", { scopes: ["overview.read"] });
  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range);
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;

  const [
    totalUsers,
    activeUsers,
    paidMemberships,
    trialAccounts,
    activeAccounts,
    activeProjects,
    activeSites,
    monitoredSessions,
    recoveredSessions,
    cavverifyRenders,
    cavguardRenders,
    openAlerts,
    resolvedAlerts,
    serviceStatuses,
    recentNotices,
    recentIncidents,
    recentStaffActivity,
    usersForTrend,
    subsForTrend,
    topAccounts,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lastLoginAt: { gte: start, lt: end } } }),
    prisma.membership.findMany({
      where: { account: { tier: { in: ["PREMIUM", "ENTERPRISE"] } } },
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.account.count({
      where: {
        trialSeatActive: true,
        trialEndsAt: { gt: new Date() },
      },
    }),
    prisma.account.count({
      where: {
        OR: [
          { updatedAt: { gte: start, lt: end } },
          { members: { some: { user: { lastLoginAt: { gte: start, lt: end } } } } },
        ],
      },
    }),
    prisma.project.count({ where: { isActive: true, updatedAt: { gte: start, lt: end } } }),
    prisma.site.count({ where: { isActive: true, updatedAt: { gte: start, lt: end } } }),
    prisma.adminEvent.count({ where: { name: "cavbot_session_observed", createdAt: { gte: start, lt: end } } }),
    prisma.adminEvent.count({ where: { name: "cavbot_session_recovered", createdAt: { gte: start, lt: end } } }),
    prisma.adminEvent.count({ where: { name: "cavverify_rendered", createdAt: { gte: start, lt: end } } }),
    prisma.adminEvent.count({ where: { name: "cavguard_rendered", createdAt: { gte: start, lt: end } } }),
    prisma.workspaceNotice.count({ where: { dismissedAt: null } }),
    prisma.incident.count({ where: { status: "RESOLVED", updatedAt: { gte: start, lt: end } } }),
    prisma.serviceStatus.findMany({
      orderBy: [{ status: "asc" }, { displayName: "asc" }],
      select: { serviceKey: true, displayName: true, status: true, lastCheckedAt: true },
    }),
    prisma.workspaceNotice.findMany({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        title: true,
        body: true,
        tone: true,
        createdAt: true,
        account: { select: { id: true } },
      },
    }),
    prisma.incident.findMany({
      where: { startedAt: { gte: start, lt: end } },
      orderBy: { startedAt: "desc" },
      take: 4,
      select: { id: true, title: true, status: true, impact: true, startedAt: true },
    }),
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.user.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
    prisma.subscription.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { createdAt: true, tier: true },
    }),
    prisma.account.findMany({
      take: 6,
      where: { updatedAt: { gte: start, lt: end } },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        tier: true,
        updatedAt: true,
      },
    }),
  ]);

  const paidUsers = paidMemberships.length;
  const freeUsers = Math.max(0, totalUsers - paidUsers);
  const signupTrend = buildAdminTrendPoints(usersForTrend.map((row) => ({ date: row.createdAt, value: 1 })), range, month);
  const subscriptionTrend = buildAdminTrendPoints(
    subsForTrend.map((row) => ({
      date: row.createdAt,
      value: row.tier === "FREE" ? 0 : 1,
      secondaryValue: row.tier === "ENTERPRISE" ? 1 : 0,
    })),
    range,
    month,
  );

  const accountIds = topAccounts.map((row) => row.id);
  const noticeOwnerIds = recentNotices
    .map((notice) => notice.account?.id)
    .filter((value): value is string => Boolean(value));
  const ownerAccountIds = Array.from(new Set([...accountIds, ...noticeOwnerIds]));
  const [footprints, owners] = await Promise.all([
    getAccountFootprints(accountIds),
    getAccountOwners(ownerAccountIds),
  ]);

  const topUsage = topAccounts
    .map((account) => {
      const footprint = footprints.get(account.id) || {
        projects: 0,
        sites: 0,
        members: 0,
        notices: 0,
        scans: 0,
        notifications: 0,
      };
      return {
        ...account,
        footprint,
        owner: owners.get(account.id),
        score: footprint.projects * 3 + footprint.sites * 2 + footprint.members + footprint.notices + footprint.scans,
      };
    })
    .sort((left, right) => right.score - left.score);

  const healthyServices = serviceStatuses.filter((row) => row.status === "HEALTHY").length;
  const atRiskServices = serviceStatuses.filter((row) => row.status === "AT_RISK").length;
  const incidentServices = serviceStatuses.filter((row) => row.status === "INCIDENT").length;

  return (
    <AdminPage
      title="Overview"
      subtitle="Daily command center for user growth, workspace health, commercial movement, security load, and staff activity across CavBot."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Total Users" value={formatInt(totalUsers)} meta={`${formatInt(activeUsers)} active in ${rangeLabel}`} href="/clients" />
        <MetricCard label="Paid Users" value={formatInt(paidUsers)} meta={`${formatInt(freeUsers)} on free tiers`} href="/plans" />
        <MetricCard label="Trials" value={formatInt(trialAccounts)} meta={`${formatInt(activeAccounts)} active accounts`} href="/plans" />
        <MetricCard label="Projects" value={formatInt(activeProjects)} meta={`${formatInt(activeSites)} active sites and origins`} href="/projects" />
        <MetricCard label="CavBot Sessions" value={formatInt(monitoredSessions)} meta={`${formatInt(recoveredSessions)} recovered sessions`} href="/sessions" />
        <MetricCard label="Caverify Renders" value={formatInt(cavverifyRenders)} meta={`Observed across ${rangeLabel}`} href="/security/cavverify" />
        <MetricCard label="CavGuard Renders" value={formatInt(cavguardRenders)} meta={`Guard surfaces captured in ${rangeLabel}`} href="/security/cavguard" />
        <MetricCard label="Open Alerts" value={formatInt(openAlerts)} meta={`${formatInt(resolvedAlerts)} resolved incidents in the window`} href="/alerts" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Growth Trend"
          subtitle="New user accounts and paid subscription starts across the current reporting window."
          labels={signupTrend.map((row) => row.label)}
          primary={signupTrend.map((row) => row.value)}
          secondary={subscriptionTrend.map((row) => row.value)}
          primaryLabel="Signups"
          secondaryLabel="Paid starts"
        />

        <Panel title="Platform Health" subtitle="Current live service state from the shared CavBot status substrate.">
          <div className="hq-list">
            <div className="hq-statRow hq-statRowSystem hq-statRowHealthy">
              <div>
                <div className="hq-statLabel">Healthy services</div>
                <div className="hq-statMeta">Latest status probes</div>
              </div>
              <Badge tone="good" className="hq-systemBadge">{formatInt(healthyServices)}</Badge>
            </div>
            <div className="hq-statRow hq-statRowSystem hq-statRowWarning">
              <div>
                <div className="hq-statLabel">At-risk services</div>
                <div className="hq-statMeta">Latency or degraded signals</div>
              </div>
              <Badge tone="watch" className="hq-systemBadge">{formatInt(atRiskServices)}</Badge>
            </div>
            <div className="hq-statRow hq-statRowSystem hq-statRowIncident">
              <div>
                <div className="hq-statLabel">Incident services</div>
                <div className="hq-statMeta">Currently reporting incident status</div>
              </div>
              <Badge tone="bad" className="hq-systemBadge">{formatInt(incidentServices)}</Badge>
            </div>
          </div>
        </Panel>
      </section>

      <section className="hq-grid hq-gridThree">
        <Panel title="Top Accounts By Usage" subtitle="Weighted by projects, sites, members, notices, and scan volume.">
          <div className="hq-list">
            {topUsage.map((account) => (
              <div key={account.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">
                    <a href={`/accounts/${account.id}`}>{formatUserHandle(account.owner)}</a>
                  </div>
                  <div className="hq-listMeta">
                    {formatUserName(account.owner)} · {account.footprint.projects} projects · {account.footprint.sites} sites
                  </div>
                </div>
                {buildPublicProfileHref(account.owner) ? (
                  <a
                    className="hq-profileLink"
                    href={buildPublicProfileHref(account.owner)}
                    title={`Open ${formatUserHandle(account.owner)} public profile`}
                    aria-label={`Open ${formatUserHandle(account.owner)} public profile`}
                  >
                    <span className="hq-profileLinkGlyph" aria-hidden="true" />
                  </a>
                ) : (
                  <span
                    className="hq-profileLink"
                    data-disabled="true"
                    title="Public profile unavailable"
                    aria-label="Public profile unavailable"
                  >
                    <span className="hq-profileLinkGlyph" aria-hidden="true" />
                  </span>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent Critical Events" subtitle="Newest cross-platform notices and incidents requiring operator context.">
          <div className="hq-list">
            {recentIncidents.map((incident) => (
              <div key={incident.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{incident.title}</div>
                  <div className="hq-listMeta">
                    {incident.status} · {incident.impact} · {incident.startedAt.toLocaleString()}
                  </div>
                </div>
                <Badge tone={incident.status === "RESOLVED" ? "good" : "bad"}>{incident.status}</Badge>
              </div>
            ))}
            {recentNotices.slice(0, 3).map((notice) => (
              <div key={notice.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{notice.title}</div>
                  <div className="hq-listMeta">
                    {formatUserHandle(notice.account?.id ? owners.get(notice.account.id) : null, "No owner")} · {formatDateTime(notice.createdAt)}
                  </div>
                </div>
                <Badge tone={notice.tone === "GOOD" ? "good" : notice.tone === "WATCH" ? "watch" : "bad"}>{notice.tone}</Badge>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent Staff Activity" subtitle="Latest sensitive actions from the HQ admin audit stream.">
          <div className="hq-list">
            {recentStaffActivity.map((entry) => (
              <div key={entry.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{entry.actionLabel}</div>
                  <div className="hq-listMeta">{formatDateTime(entry.createdAt)}</div>
                </div>
                <span
                  className="hq-infoHint"
                  title={formatAuditEntityLabel(entry.entityType)}
                  aria-label={formatAuditEntityLabel(entry.entityType)}
                >
                  <span className="hq-infoHintGlyph" aria-hidden="true" />
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </AdminPage>
  );
}
