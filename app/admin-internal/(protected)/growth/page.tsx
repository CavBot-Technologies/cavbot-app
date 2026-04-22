import { AdminPage, Badge, MetricCard, Panel, TrendChart } from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
  buildAdminTrendPoints,
  formatInt,
  formatPercent,
  parseAdminMonth,
  parseAdminRange,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";
import { readGeoFromMeta } from "@/lib/requestGeo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function GrowthPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/growth", { scopes: ["growth.read"] });

  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range);
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const [users, trialStarts, accounts, sessions, deletedAccounts] = await Promise.all([
    prisma.user.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: {
        id: true,
        createdAt: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        country: true,
        region: true,
        memberships: {
          select: {
            account: {
              select: {
                id: true,
                tier: true,
                projects: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    sites: {
                      where: { isActive: true },
                      select: { id: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.account.findMany({
      where: {
        trialStartedAt: { gte: start, lt: end },
      },
      select: {
        id: true,
        trialStartedAt: true,
        tier: true,
        trialEverUsed: true,
      },
    }),
    prisma.account.findMany({
      select: {
        id: true,
        tier: true,
        trialEverUsed: true,
      },
    }),
    prisma.cavAiSession.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { createdAt: true, userId: true },
    }),
    prisma.auditLog.findMany({
      where: {
        action: "ACCOUNT_DELETED",
        createdAt: { gte: start, lt: end },
      },
      select: { createdAt: true },
    }),
  ]);

  const signups = users.length;
  const verified = users.filter((user) => user.emailVerifiedAt).length;
  const active = users.filter((user) => user.lastLoginAt).length;
  const withMembership = users.filter((user) => user.memberships.length > 0).length;
  const withProject = users.filter((user) => user.memberships.some((membership) => membership.account.projects.length > 0)).length;
  const withSite = users.filter((user) => user.memberships.some((membership) => membership.account.projects.some((project) => project.sites.length > 0))).length;
  const sessionUsers = new Set(sessions.map((session) => session.userId)).size;
  const conversionBase = accounts.filter((account) => account.trialEverUsed).length;
  const convertedAccounts = accounts.filter((account) => account.trialEverUsed && account.tier !== "FREE").length;
  const conversionRate = conversionBase > 0 ? (convertedAccounts / conversionBase) * 100 : 0;

  const signupTrend = buildAdminTrendPoints(users.map((user) => ({ date: user.createdAt, value: 1 })), range, month);
  const deletedTrend = buildAdminTrendPoints(
    deletedAccounts.map((entry) => ({ date: entry.createdAt, value: 1 })),
    range,
    month,
  );

  const cohortUserIds = users.map((user) => user.id).filter(Boolean);
  const authGeoLogs = cohortUserIds.length
    ? await prisma.auditLog.findMany({
        where: {
          operatorUserId: { in: cohortUserIds },
          action: { in: ["ACCOUNT_CREATED", "AUTH_SIGNED_IN"] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          operatorUserId: true,
          metaJson: true,
        },
      })
    : [];

  const networkGeoByUserId = new Map<string, string>();
  for (const entry of authGeoLogs) {
    const userId = String(entry.operatorUserId || "").trim();
    if (!userId || networkGeoByUserId.has(userId)) continue;
    const geo = readGeoFromMeta(entry.metaJson);
    const key = geo.country || geo.region || "";
    if (key) networkGeoByUserId.set(userId, key);
  }

  const geography = new Map<string, number>();
  for (const user of users) {
    const key = networkGeoByUserId.get(user.id) || user.country || user.region || "No geo captured";
    geography.set(key, (geography.get(key) || 0) + 1);
  }
  const topRegions = [...geography.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8);
  const activationSteps = [
    ["Signed up", signups],
    ["Verified email", verified],
    ["Logged in", active],
    ["Joined a workspace", withMembership],
    ["Created a project", withProject],
    ["Created a site", withSite],
    ["Produced sessions", sessionUsers],
  ] as const;

  return (
    <AdminPage
      title="Growth"
      subtitle="Signup, activation, workspace setup, trial, and conversion visibility from the existing CavBot dataset."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Signups" value={formatInt(signups)} meta={`Users created in ${rangeLabel}`} />
        <MetricCard label="Verified" value={formatInt(verified)} meta="Users with verified email" />
        <MetricCard label="Activated" value={formatInt(active)} meta="Users with at least one login" />
        <MetricCard label="With workspace" value={formatInt(withMembership)} meta="Users attached to an account" />
        <MetricCard label="With project" value={formatInt(withProject)} meta="Users whose account created a project" />
        <MetricCard label="With site" value={formatInt(withSite)} meta="Users whose account created an active site" />
        <MetricCard label="Session adoption" value={formatInt(sessionUsers)} meta={`Users with CavBot sessions in ${rangeLabel}`} />
        <MetricCard label="Trials started" value={formatInt(trialStarts.length)} meta={`${formatInt(convertedAccounts)} converted accounts · ${formatPercent(conversionRate)} trial-to-paid`} />
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Signup trend"
          subtitle={`New CavBot users created versus deleted accounts across ${rangeLabel}.`}
          labels={signupTrend.map((point) => point.label)}
          primary={signupTrend.map((point) => point.value)}
          secondary={deletedTrend.map((point) => point.value)}
          primaryLabel="Signups"
          secondaryLabel="Deleted accounts"
          secondaryTone="bad"
        />

        <Panel title="Geography" subtitle="Top countries or regions represented in the current 30-day signup cohort.">
          <div className="hq-list">
            {topRegions.map(([label, value]) => (
              <div key={label} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{label}</div>
                  <div className="hq-listMeta">Signup cohort geography</div>
                </div>
                <Badge tone="watch" className="hq-badgeCorporate">
                  {formatInt(value)}
                </Badge>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="hq-grid">
        <Panel title="Activation funnel" subtitle="From signup to verified identity, login, workspace creation, project setup, site setup, and session adoption.">
          <div className="hq-grid hq-gridMetrics hq-growthActivationGrid">
            {activationSteps.map(([label, value]) => (
              <MetricCard
                key={label}
                label={label}
                value={
                  <Badge tone="watch" className="hq-badgeCorporate">
                    {formatInt(value)}
                  </Badge>
                }
                meta={signups > 0 ? `${((Number(value) / signups) * 100).toFixed(1)}% of signups` : "No signups in range"}
              />
            ))}
          </div>
        </Panel>
      </section>

      <Panel title="Attribution status">
        <div className="hq-growthAttributionStack">
          <p className="hq-sectionLead">Marketing attribution is not currently modeled in the existing CavBot dataset. CavBot HQ surfaces the operational funnel now and is ready for campaign/source dimensions as soon as they are persisted.</p>
          <p className="hq-sectionLead">Add persisted acquisition source, campaign, referral, or signup attribution fields and this page can extend straight into source-level funnel reporting.</p>
        </div>
      </Panel>
    </AdminPage>
  );
}
