import Link from "next/link";
import { Prisma } from "@prisma/client";

import {
  AdminPage,
  Badge,
  KeyValueGrid,
  MetricCard,
  Panel,
  TrendChart,
} from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
  buildAdminTrendPoints,
  asRecord,
  formatAdminSubscriptionLabel,
  formatDate,
  formatInt,
  formatMoney,
  formatPercent,
  formatUserName,
  getAccountFootprints,
  getAccountOwners,
  getLatestSubscriptions,
  getPlanDistribution,
  parseAdminMonth,
  parseAdminRange,
  readNumberPath,
  resolveAdminPlanDisplay,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { PLANS, resolvePlanIdFromTier } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function PremiumPlusStarMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.4l2.9 5.87 6.48.94-4.69 4.57 1.11 6.45L12 17.2 6.2 20.23l1.11-6.45L2.62 9.21l6.48-.94L12 2.4z"
      />
    </svg>
  );
}

function estimatedMrr(tier: string, billingCycle: string | null | undefined) {
  const plan = PLANS[resolvePlanIdFromTier(tier)];
  if (!plan) return 0;
  if (billingCycle === "annual") {
    const annual = plan.pricing.annual?.price || 0;
    return annual / 12;
  }
  return plan.pricing.monthly?.price || 0;
}

export default async function PlansPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/plans", { scopes: ["plans.read"] });

  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range);
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const now = new Date();
  const distribution = await getPlanDistribution();
  const accounts = await prisma.account.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      tier: true,
      trialSeatActive: true,
      trialEndsAt: true,
      trialEverUsed: true,
      pendingDowngradePlanId: true,
      pendingDowngradeEffectiveAt: true,
      lastUpgradeAt: true,
    },
  });
  const accountIds = accounts.map((account) => account.id);

  const [latestSubs, footprints, recentSubs, stripeEvents, billingAuditRows, lifetimeBillingAuditRows, activePaidAccounts, canceledAccounts, failedAccounts, accountOwners] = await Promise.all([
    getLatestSubscriptions(accountIds),
    getAccountFootprints(accountIds),
    prisma.subscription.findMany({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "asc" },
      select: {
        accountId: true,
        createdAt: true,
        status: true,
        tier: true,
        billingCycle: true,
      },
    }),
    prisma.stripeEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        type: true,
        accountId: true,
        livemode: true,
        createdAt: true,
        processedAt: true,
      },
    }),
    prisma.auditLog.findMany({
      where: {
        action: "BILLING_UPDATED",
        createdAt: { gte: start, lt: end },
        metaJson: {
          path: ["billing_event"],
          not: Prisma.JsonNull,
        },
      },
      orderBy: { createdAt: "asc" },
      select: {
        accountId: true,
        createdAt: true,
        metaJson: true,
      },
    }),
    prisma.auditLog.findMany({
      where: {
        action: "BILLING_UPDATED",
        metaJson: {
          path: ["billing_event"],
          not: Prisma.JsonNull,
        },
      },
      orderBy: { createdAt: "asc" },
      select: {
        accountId: true,
        createdAt: true,
        metaJson: true,
      },
    }),
    prisma.account.count({
      where: {
        tier: { in: ["PREMIUM", "ENTERPRISE"] },
      },
    }),
    prisma.subscription.count({
      where: {
        status: "CANCELED",
      },
    }),
    prisma.subscription.count({
      where: {
        status: "PAST_DUE",
      },
    }),
    getAccountOwners(accountIds),
  ]);

  const rows = accounts.map((account) => {
    const latest = latestSubs.get(account.id);
    const planDisplay = resolveAdminPlanDisplay({
      tier: account.tier,
      status: latest?.status,
      subscriptionTier: latest?.tier,
      currentPeriodEnd: latest?.currentPeriodEnd,
      trialSeatActive: account.trialSeatActive,
      trialEndsAt: account.trialEndsAt,
      now,
    });
    const footprint = footprints.get(account.id) || {
      projects: 0,
      sites: 0,
      members: 0,
      notices: 0,
      scans: 0,
      notifications: 0,
    };
    const planId = planDisplay.planId;
    const plan = PLANS[planId];
    const mrr = latest?.status === "ACTIVE" || latest?.status === "PAST_DUE"
      ? estimatedMrr(planDisplay.planTier, latest?.billingCycle)
      : 0;
    const seatLimit = plan.limits.seats;
    const siteLimit = typeof plan.limits.websites === "number" ? plan.limits.websites : null;
    const seatUtilization = seatLimit > 0 ? Math.min(100, (footprint.members / seatLimit) * 100) : 0;
    const siteUtilization = siteLimit && siteLimit > 0 ? Math.min(100, (footprint.sites / siteLimit) * 100) : 0;
    return {
      ...account,
      latest,
      footprint,
      planDisplay,
      mrr,
      seatUtilization,
      siteUtilization,
      plan,
    };
  });

  const mrr = rows.reduce((sum, row) => sum + row.mrr, 0);
  const arr = mrr * 12;
  const trialAccounts = rows.filter((row) => row.planDisplay.isTrialing).length;
  const trialToPaidCandidates = rows.filter((row) => row.trialEverUsed).length;
  const trialToPaidConverted = rows.filter((row) => row.trialEverUsed && row.tier !== "FREE").length;
  const trialToPaidRate = trialToPaidCandidates > 0 ? (trialToPaidConverted / trialToPaidCandidates) * 100 : 0;
  const expansionCandidates = rows.filter((row) => row.tier !== "FREE" && (row.seatUtilization >= 75 || row.siteUtilization >= 75));
  const collectedRevenueWindowCents = billingAuditRows.reduce((sum, row) => {
    const meta = asRecord(row.metaJson);
    if (String(meta?.billing_event || "").trim().toLowerCase() !== "stripe_invoice_paid") return sum;
    return sum + Math.max(0, readNumberPath(meta, ["amountPaid", "total", "amountDue"]) ?? 0);
  }, 0);
  const collectedRevenueLifetimeCents = lifetimeBillingAuditRows.reduce((sum, row) => {
    const meta = asRecord(row.metaJson);
    if (String(meta?.billing_event || "").trim().toLowerCase() !== "stripe_invoice_paid") return sum;
    return sum + Math.max(0, readNumberPath(meta, ["amountPaid", "total", "amountDue"]) ?? 0);
  }, 0);
  const failedRevenueCents = billingAuditRows.reduce((sum, row) => {
    const meta = asRecord(row.metaJson);
    if (String(meta?.billing_event || "").trim().toLowerCase() !== "stripe_invoice_payment_failed") return sum;
    return sum + Math.max(0, readNumberPath(meta, ["amountDue", "total", "amountPaid"]) ?? 0);
  }, 0);
  const paidInvoiceCount = billingAuditRows.filter((row) => {
    const meta = asRecord(row.metaJson);
    return String(meta?.billing_event || "").trim().toLowerCase() === "stripe_invoice_paid";
  }).length;
  const lifetimePaidInvoiceCount = lifetimeBillingAuditRows.filter((row) => {
    const meta = asRecord(row.metaJson);
    return String(meta?.billing_event || "").trim().toLowerCase() === "stripe_invoice_paid";
  }).length;
  const failedInvoiceCount = billingAuditRows.filter((row) => {
    const meta = asRecord(row.metaJson);
    return String(meta?.billing_event || "").trim().toLowerCase() === "stripe_invoice_payment_failed";
  }).length;
  const currentRevenue = collectedRevenueLifetimeCents / 100;
  const windowRevenue = collectedRevenueWindowCents / 100;
  const failedRevenue = failedRevenueCents / 100;
  const averagePaidInvoice = lifetimePaidInvoiceCount > 0 ? currentRevenue / lifetimePaidInvoiceCount : 0;
  const paymentSuccessRate = paidInvoiceCount + failedInvoiceCount > 0
    ? (paidInvoiceCount / (paidInvoiceCount + failedInvoiceCount)) * 100
    : 0;
  const trend = buildAdminTrendPoints(
    recentSubs.map((row) => ({
      date: row.createdAt,
      value: row.tier === "FREE" ? 0 : 1,
      secondaryValue: row.status === "CANCELED" ? 1 : 0,
    })),
    range,
    month,
  );
  const revenueTrend = buildAdminTrendPoints(
    billingAuditRows.map((row) => {
      const meta = asRecord(row.metaJson);
      const billingEvent = String(meta?.billing_event || "").trim().toLowerCase();
      const paidValue = billingEvent === "stripe_invoice_paid"
        ? Math.max(0, (readNumberPath(meta, ["amountPaid", "total", "amountDue"]) ?? 0) / 100)
        : 0;
      const failedValue = billingEvent === "stripe_invoice_payment_failed"
        ? Math.max(0, (readNumberPath(meta, ["amountDue", "total", "amountPaid"]) ?? 0) / 100)
        : 0;

      return {
        date: row.createdAt,
        value: paidValue,
        secondaryValue: failedValue,
      };
    }),
    range,
    month,
  );

  return (
    <AdminPage
      title="Financials"
      subtitle="Commercial control plane for subscription mix, trial conversion, estimated recurring revenue, utilization, renewals, and billing risk."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Free accounts" value={formatInt(distribution.FREE || 0)} meta="Current workspace distribution" />
        <MetricCard label="Paid accounts" value={formatInt(activePaidAccounts)} meta={`${formatInt(distribution.PREMIUM || 0)} premium · ${formatInt(distribution.ENTERPRISE || 0)} premium+`} />
        <MetricCard label="MRR" value={formatMoney(mrr)} meta={`${formatInt(rows.filter((row) => row.mrr > 0).length)} revenue-carrying accounts`} />
        <MetricCard label="ARR" value={formatMoney(arr)} meta="Annualized from current active MRR" />
        <MetricCard label="Trial-to-paid" value={formatPercent(trialToPaidRate)} meta={`${formatInt(trialToPaidConverted)} converted of ${formatInt(trialToPaidCandidates)}`} />
        <MetricCard label="Cancellations" value={formatInt(canceledAccounts)} meta="Historical canceled subscriptions" />
        <MetricCard label="Payment failures" value={formatInt(failedAccounts)} meta="Accounts currently marked past due" />
        <MetricCard label="Expansion candidates" value={formatInt(expansionCandidates.length)} meta="Seat or site utilization above 75%" />
        <MetricCard label="Pending downgrades" value={formatInt(rows.filter((row) => row.pendingDowngradePlanId).length)} meta="Scheduled plan reduction" />
        <MetricCard label="Current revenue" value={formatMoney(currentRevenue)} meta="Net subscription revenue" className="hq-cardRevenue" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Revenue movement"
          subtitle={`Collected invoice revenue versus failed payment exposure across ${rangeLabel}.`}
          labels={revenueTrend.map((point) => point.label)}
          primary={revenueTrend.map((point) => point.value)}
          secondary={revenueTrend.map((point) => point.secondaryValue || 0)}
          primaryLabel="Collected"
          secondaryLabel="Failed exposure"
          secondaryTone="bad"
          formatValue={(value) => formatMoney(value)}
        />

        <Panel title="Revenue signals" subtitle="Live money movement from persisted Stripe invoice payments and failures.">
          <KeyValueGrid
            items={[
              { label: "Current revenue", value: formatMoney(currentRevenue) },
              { label: "Revenue in window", value: formatMoney(windowRevenue) },
              { label: "ARR", value: formatMoney(arr) },
              { label: "Paid invoices", value: formatInt(lifetimePaidInvoiceCount) },
              { label: "Average payment", value: formatMoney(averagePaidInvoice) },
              { label: "Invoice success rate", value: formatPercent(paymentSuccessRate) },
              { label: "Failed invoice exposure", value: formatMoney(failedRevenue) },
              { label: "Failed invoices", value: formatInt(failedInvoiceCount) },
              { label: "Window", value: rangeLabel },
            ]}
          />
        </Panel>
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Commercial movement"
          subtitle={`Paid subscription starts versus canceled subscriptions across ${rangeLabel}.`}
          labels={trend.map((point) => point.label)}
          primary={trend.map((point) => point.value)}
          secondary={trend.map((point) => point.secondaryValue || 0)}
          primaryLabel="Paid starts"
          secondaryLabel="Cancellations"
        />

        <Panel title="Distribution" subtitle="Current workspace mix by plan tier.">
          <div className="hq-list">
            <div className="hq-statRow">
              <div>
                <div className="hq-statLabel">14 days trial</div>
                <div className="hq-statMeta">Active trial workspaces</div>
              </div>
              <Badge className="hq-planDistributionBadge hq-planDistributionBadgeTrial">{formatInt(trialAccounts)}</Badge>
            </div>
            <div className="hq-statRow">
              <div>
                <div className="hq-statLabel">Free</div>
                <div className="hq-statMeta">CavTower workspaces</div>
              </div>
              <Badge className="hq-planDistributionBadge hq-planDistributionBadgeFree">{formatInt(distribution.FREE || 0)}</Badge>
            </div>
            <div className="hq-statRow">
              <div>
                <div className="hq-statLabel">Premium</div>
                <div className="hq-statMeta">CavControl workspaces</div>
              </div>
              <Badge className="hq-planDistributionBadge hq-planDistributionBadgePremium">{formatInt(distribution.PREMIUM || 0)}</Badge>
            </div>
            <div className="hq-statRow">
              <div>
                <div className="hq-statLabel">Premium+</div>
                <div className="hq-statMeta">CavElite workspaces</div>
              </div>
              <div className="hq-planDistributionValue">
                <span className="hq-planDistributionMark" aria-hidden="true">
                  <PremiumPlusStarMark />
                </span>
                <Badge className="hq-planDistributionBadge hq-planDistributionBadgeEnterprise">{formatInt(distribution.ENTERPRISE || 0)}</Badge>
              </div>
            </div>
          </div>
        </Panel>
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel title="Top revenue accounts" subtitle="Estimated recurring revenue from current plan tier and billing cycle.">
          <div className="hq-list">
            {rows
              .slice()
              .sort((left, right) => right.mrr - left.mrr)
              .slice(0, 10)
              .map((row) => (
                <div key={row.id} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">
                      <Link href={`/accounts/${row.id}`}>{formatUserName(accountOwners.get(row.id), row.name)}</Link>
                    </div>
                  <div className="hq-listMeta">
                      {formatAdminSubscriptionLabel({
                        status: row.latest?.status,
                        tier: row.tier,
                        subscriptionTier: row.latest?.tier,
                        currentPeriodEnd: row.latest?.currentPeriodEnd,
                        trialSeatActive: row.trialSeatActive,
                        trialEndsAt: row.trialEndsAt,
                      })} · {formatInt(row.footprint.members)} seats · {formatInt(row.footprint.sites)} sites
                    </div>
                  </div>
                  <Badge className="hq-revenueBadge">{formatMoney(row.mrr)}</Badge>
                </div>
              ))}
          </div>
        </Panel>

        <Panel title="Renewal and billing activity" subtitle="Latest billing-adjacent events captured through Stripe webhook ingest.">
          <div className="hq-list">
            {stripeEvents.map((event) => (
              <div key={event.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{event.type}</div>
                  <div className="hq-listMeta">
                    {event.accountId || "No account mapping"} · {formatDate(event.createdAt)}
                  </div>
                </div>
                <Badge tone={event.type.includes("failed") ? "bad" : event.processedAt ? "good" : "watch"}>
                  {event.livemode ? "Live" : "Test"}
                </Badge>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </AdminPage>
  );
}
