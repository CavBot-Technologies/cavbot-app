import Link from "next/link";
import { Prisma } from "@prisma/client";

import {
  AdminPage,
  AvatarBadge,
  MetricCard,
  PaginationNav,
  Panel,
  PlanSharePanel,
} from "@/components/admin/AdminPrimitives";
import { ClientDirectoryGrid, type ClientDirectoryCardData } from "@/components/admin/ClientDirectoryGrid";
import { isPrimaryCavBotAdminIdentity, pinPrimaryItemFirst } from "@/lib/admin/pinning";
import {
  formatBytes,
  formatAdminSubscriptionLabel,
  futureDate,
  formatDate,
  formatDateTime,
  formatInt,
  formatUserHandle,
  getAccountFootprints,
  getAccountOwners,
  offsetForPage,
  pageCount,
  parseAdminMonth,
  parseAdminRange,
  parsePage,
  parseRangeDays,
  resolveAdminPlanDisplay,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { getAccountStorageMap, getUserStorageActivityMap, sumAccountStorageSummaries } from "@/lib/admin/storage";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import { buildCanonicalPublicProfileHref } from "@/lib/publicProfile/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const clientUserSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  email: true,
  username: true,
  displayName: true,
  fullName: true,
  avatarImage: true,
  avatarTone: true,
  country: true,
  region: true,
  createdAt: true,
  lastLoginAt: true,
  staffProfile: {
    select: {
      status: true,
      onboardingStatus: true,
    },
  },
  memberships: {
    select: {
      accountId: true,
      role: true,
      account: {
        select: {
          id: true,
          name: true,
          slug: true,
          tier: true,
          trialSeatActive: true,
          trialStartedAt: true,
          trialEndsAt: true,
          subscriptions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              status: true,
              tier: true,
              currentPeriodEnd: true,
            },
          },
        },
      },
    },
  },
});

const clientChartUserSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  memberships: {
    select: {
      account: {
        select: {
          tier: true,
          trialSeatActive: true,
          trialEndsAt: true,
          subscriptions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              status: true,
              tier: true,
              currentPeriodEnd: true,
            },
          },
        },
      },
    },
  },
});

function s(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function rankTier(tier: string) {
  if (tier === "ENTERPRISE") return 3;
  if (tier === "PREMIUM") return 2;
  return 1;
}

type ClientPlanMembershipLike = {
  account: {
    tier: string;
    trialSeatActive?: boolean | null;
    trialEndsAt?: Date | null;
    subscriptions?: Array<{
      status?: string | null;
      tier?: string | null;
      currentPeriodEnd?: Date | null;
    }>;
  };
};

type ClientPlanFilter = "" | "TRIALING" | "FREE" | "PREMIUM" | "ENTERPRISE";

function resolveMembershipPlanDisplay<T extends ClientPlanMembershipLike>(membership: T | null | undefined, now: Date) {
  const latestSubscription = membership?.account.subscriptions?.[0];
  return resolveAdminPlanDisplay({
    tier: membership?.account.tier,
    status: latestSubscription?.status,
    subscriptionTier: latestSubscription?.tier,
    currentPeriodEnd: latestSubscription?.currentPeriodEnd,
    trialSeatActive: membership?.account.trialSeatActive,
    trialEndsAt: membership?.account.trialEndsAt,
    now,
  });
}

function resolveUserTier<T extends ClientPlanMembershipLike>(memberships: readonly T[], now: Date) {
  return memberships
    .map((membership) => resolveMembershipPlanDisplay(membership, now).planTier)
    .sort((left, right) => rankTier(right) - rankTier(left))[0] || "FREE";
}

function resolvePrimaryMembership<T extends ClientPlanMembershipLike>(memberships: readonly T[], now: Date) {
  return [...memberships].sort((left, right) => {
    const leftPlan = resolveMembershipPlanDisplay(left, now);
    const rightPlan = resolveMembershipPlanDisplay(right, now);
    const leftTrialing = leftPlan.isTrialing ? 1 : 0;
    const rightTrialing = rightPlan.isTrialing ? 1 : 0;
    if (leftTrialing !== rightTrialing) return rightTrialing - leftTrialing;
    return rankTier(rightPlan.planTier) - rankTier(leftPlan.planTier);
  })[0];
}

function resolveClientPlanState<T extends ClientPlanMembershipLike>(memberships: readonly T[], now: Date) {
  const primaryMembership = resolvePrimaryMembership(memberships, now);
  const primarySubscriptionStatus = primaryMembership?.account.subscriptions?.[0]?.status || null;
  const primaryPlan = resolveMembershipPlanDisplay(primaryMembership, now);
  return {
    primaryMembership,
    primarySubscriptionStatus,
    primaryIsTrialing: primaryPlan.isTrialing,
    primaryPlanLabel: primaryPlan.planLabel,
    resolvedTier: resolveUserTier(memberships, now),
  };
}

function normalizeClientPlanFilter(value: string): ClientPlanFilter {
  const token = String(value || "").trim().toUpperCase();
  if (token === "TRIALING" || token === "FREE" || token === "PREMIUM" || token === "ENTERPRISE") return token;
  return "";
}

function matchesClientPlanFilter<T extends ClientPlanMembershipLike>(memberships: readonly T[], now: Date, plan: ClientPlanFilter) {
  if (!plan) return true;

  const state = resolveClientPlanState(memberships, now);
  if (plan === "TRIALING") return state.primaryIsTrialing;
  if (plan === "FREE") return !state.primaryIsTrialing && state.resolvedTier === "FREE";
  if (plan === "PREMIUM") return !state.primaryIsTrialing && state.resolvedTier === "PREMIUM";
  if (plan === "ENTERPRISE") return !state.primaryIsTrialing && state.resolvedTier === "ENTERPRISE";
  return true;
}

function formatMemberRole(role: string) {
  const value = String(role || "").trim().toLowerCase();
  if (!value) return "Member";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeAuditPlan(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function resolveClientHealth(input: {
  lastLoginAt: Date | null;
  sessionCount: number;
  sites: number;
  subscriptionStatus?: string | null;
  activeSince: Date;
}) {
  if (String(input.subscriptionStatus || "").toUpperCase() === "PAST_DUE") {
    return { label: "At risk", tone: "bad" as const };
  }
  if (!input.lastLoginAt) {
    return { label: "Dormant", tone: "bad" as const };
  }
  if (input.lastLoginAt < input.activeSince || input.sessionCount === 0 || input.sites === 0) {
    return { label: "Watching", tone: "watch" as const };
  }
  return { label: "Healthy", tone: "good" as const };
}

export default async function ClientsPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/clients", { scopes: ["customers.read"] });

  const q = s(props.searchParams?.q).trim();
  const rawPlan = s(props.searchParams?.plan).trim().toUpperCase();
  const plan = normalizeClientPlanFilter(rawPlan);
  const status = s(props.searchParams?.status).trim().toLowerCase();
  const accountId = s(props.searchParams?.accountId).trim();
  const region = s(props.searchParams?.region).trim();
  const legacyDays = parseRangeDays(s(props.searchParams?.days), 30);
  const fallbackRange = legacyDays <= 1 ? "24h" : legacyDays <= 7 ? "7d" : "30d";
  const range = parseAdminRange(s(props.searchParams?.range), fallbackRange);
  const month = parseAdminMonth(s(props.searchParams?.month));
  const window = resolveAdminWindow(range, month);
  const page = parsePage(s(props.searchParams?.page), 1);
  const start = window.start;
  const end = window.end;
  const sevenDays = resolveAdminWindow("7d").start;
  const thirtyDays = resolveAdminWindow("30d").start;
  const now = new Date();
  const trialWindowEnd = futureDate(14);
  const filters: Prisma.UserWhereInput[] = [];
  if (q) {
    filters.push({
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { username: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
        { fullName: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (region) {
    filters.push({
      OR: [
        { country: { contains: region, mode: "insensitive" } },
        { region: { contains: region, mode: "insensitive" } },
      ],
    });
  }
  if (status === "active") {
    filters.push({ lastLoginAt: { gte: start, lt: end } });
  } else if (status === "inactive") {
    filters.push({
      OR: [
        { lastLoginAt: null },
        { lastLoginAt: { lt: start } },
      ],
    });
  }
  if (accountId) filters.push({ memberships: { some: { accountId } } });
  const where: Prisma.UserWhereInput = filters.length ? { AND: filters } : {};
  const shouldResolvePlanFilter = Boolean(plan);

  const [accounts, filteredUsersCount, dau, wau, mau, paidUsers, trialEndingSoonUsers, failedPaymentUsers, chartUsers, candidateUsers, planChangeAuditRows, adminPlanChangeAuditRows] =
    await Promise.all([
      prisma.account.findMany({
        orderBy: { name: "asc" },
        take: 40,
        select: {
          id: true,
          name: true,
          slug: true,
        },
      }),
      shouldResolvePlanFilter ? Promise.resolve(0) : prisma.user.count({ where }),
      prisma.user.count({ where: { lastLoginAt: { gte: resolveAdminWindow("24h").start } } }),
      prisma.user.count({ where: { lastLoginAt: { gte: sevenDays } } }),
      prisma.user.count({ where: { lastLoginAt: { gte: thirtyDays } } }),
      prisma.membership.count({
        where: {
          account: {
            tier: { in: ["PREMIUM", "ENTERPRISE"] },
          },
        },
      }),
      prisma.membership.findMany({
        where: {
          account: {
            trialSeatActive: true,
            trialEndsAt: {
              gt: now,
              lte: trialWindowEnd,
            },
          },
        },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.membership.findMany({
        where: {
          account: {
            subscriptions: {
              some: {
                status: "PAST_DUE",
              },
            },
          },
        },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.user.findMany({
        select: clientChartUserSelect,
      }),
      prisma.user.findMany({
        where,
        orderBy: [{ lastLoginAt: "desc" }, { createdAt: "desc" }],
        ...(shouldResolvePlanFilter ? {} : {
          skip: offsetForPage(page, PAGE_SIZE),
          take: PAGE_SIZE,
        }),
        select: clientUserSelect,
      }),
      prisma.auditLog.findMany({
        where: {
          action: { in: ["PLAN_UPGRADED", "PLAN_DOWNGRADED"] },
          createdAt: { gte: start, lt: end },
        },
        select: {
          accountId: true,
          action: true,
          metaJson: true,
        },
      }),
      prisma.adminAuditLog.findMany({
        where: {
          action: "ACCOUNT_PLAN_CHANGED",
          createdAt: { gte: start, lt: end },
          entityType: "account",
        },
        select: {
          entityId: true,
          beforeJson: true,
          afterJson: true,
        },
      }),
    ]);

  const filteredCandidateUsers = shouldResolvePlanFilter
    ? candidateUsers.filter((user) => matchesClientPlanFilter(user.memberships, now, plan))
    : candidateUsers;
  const filteredUsers = shouldResolvePlanFilter ? filteredCandidateUsers.length : filteredUsersCount;
  const pageStart = offsetForPage(page, PAGE_SIZE);
  const users = shouldResolvePlanFilter
    ? filteredCandidateUsers.slice(pageStart, pageStart + PAGE_SIZE)
    : filteredCandidateUsers;
  const totalPages = pageCount(filteredUsers, PAGE_SIZE);
  const planFilteredUserIds = shouldResolvePlanFilter
    ? new Set(filteredCandidateUsers.map((user) => user.id))
    : null;
  const userIds = users.map((user) => user.id);
  const accountIds = Array.from(new Set(users.flatMap((user) => user.memberships.map((membership) => membership.accountId))));
  const upgradedFromFreeAccountIds = new Set<string>();
  const downgradedToFreeAccountIds = new Set<string>();

  for (const row of planChangeAuditRows) {
    if (!row.accountId) continue;
    const meta = row.metaJson && typeof row.metaJson === "object" ? row.metaJson as Record<string, unknown> : {};
    const oldPlan = normalizeAuditPlan(meta.oldPlan);
    const newPlan = normalizeAuditPlan(meta.newPlan);
    if (row.action === "PLAN_UPGRADED" && oldPlan === "FREE" && newPlan && newPlan !== "FREE") {
      upgradedFromFreeAccountIds.add(row.accountId);
    }
    if (row.action === "PLAN_DOWNGRADED" && newPlan === "FREE") {
      downgradedToFreeAccountIds.add(row.accountId);
    }
  }

  for (const row of adminPlanChangeAuditRows) {
    if (!row.entityId) continue;
    const before = row.beforeJson && typeof row.beforeJson === "object" ? row.beforeJson as Record<string, unknown> : {};
    const after = row.afterJson && typeof row.afterJson === "object" ? row.afterJson as Record<string, unknown> : {};
    const oldPlan = normalizeAuditPlan(before.tier);
    const newPlan = normalizeAuditPlan(after.tier);
    if (oldPlan === "FREE" && newPlan && newPlan !== "FREE") {
      upgradedFromFreeAccountIds.add(row.entityId);
    }
    if (oldPlan && oldPlan !== "FREE" && newPlan === "FREE") {
      downgradedToFreeAccountIds.add(row.entityId);
    }
  }

  const changedPlanAccountIds = Array.from(new Set([...upgradedFromFreeAccountIds, ...downgradedToFreeAccountIds]));

  const allAccountIds = Array.from(new Set([...accountIds, ...accounts.map((account) => account.id)]));
  const [sessionCounts, securityEvents, footprints, accountOwners, accountStorageMap, userStorageActivityMap, changedPlanMemberships] = await Promise.all([
    userIds.length
      ? prisma.cavAiSession.groupBy({
          by: ["userId"],
          where: { userId: { in: userIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    userIds.length
      ? prisma.adminEvent.groupBy({
          by: ["actorUserId", "name"],
          where: {
            actorUserId: { in: userIds },
            name: { in: ["cavverify_rendered", "cavguard_rendered"] },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    getAccountFootprints(accountIds),
    getAccountOwners(allAccountIds),
    getAccountStorageMap(accountIds),
    getUserStorageActivityMap(userIds),
    changedPlanAccountIds.length
      ? prisma.membership.findMany({
          where: {
            accountId: { in: changedPlanAccountIds },
            user: where,
          },
          distinct: ["userId", "accountId"],
          select: {
            userId: true,
            accountId: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const sessionMap = new Map(sessionCounts.map((row) => [row.userId, row._count._all]));
  const verifyMap = new Map<string, number>();
  const guardMap = new Map<string, number>();
  for (const row of securityEvents) {
    if (!row.actorUserId) continue;
    if (row.name === "cavverify_rendered") verifyMap.set(row.actorUserId, row._count._all);
    if (row.name === "cavguard_rendered") guardMap.set(row.actorUserId, row._count._all);
  }
  const upgradedFromFreeUsers = new Set<string>();
  const downgradedToFreeUsers = new Set<string>();
  for (const membership of changedPlanMemberships) {
    if (planFilteredUserIds && !planFilteredUserIds.has(membership.userId)) continue;
    if (upgradedFromFreeAccountIds.has(membership.accountId)) upgradedFromFreeUsers.add(membership.userId);
    if (downgradedToFreeAccountIds.has(membership.accountId)) downgradedToFreeUsers.add(membership.userId);
  }

  const clientRows = users.map((user) => {
    const { primaryMembership, resolvedTier } = resolveClientPlanState(user.memberships, now);
    const sites = user.memberships.reduce((sum, membership) => sum + (footprints.get(membership.accountId)?.sites || 0), 0);
    const activeTrial = user.memberships.find((membership) => resolveMembershipPlanDisplay(membership, now).isTrialing);
    const activeTrialSubscription = activeTrial?.account.subscriptions?.[0] || null;
    const storage = sumAccountStorageSummaries(
      user.memberships
        .map((membership) => accountStorageMap.get(membership.accountId))
        .filter((value): value is NonNullable<typeof value> => Boolean(value)),
    );
    const storageActivity = userStorageActivityMap.get(user.id) || {
      userId: user.id,
      uploadedFiles: 0,
      deletedFiles: 0,
    };
    return {
      ...user,
      memberships: user.memberships,
      primaryMembership,
      resolvedTier,
      sites,
      sessionCount: sessionMap.get(user.id) || 0,
      cavverifyCount: verifyMap.get(user.id) || 0,
      cavguardCount: guardMap.get(user.id) || 0,
      storage,
      storageActivity,
      activeTrialStartedAt: activeTrial?.account.trialStartedAt || null,
      activeTrialEndsAt: activeTrial?.account.trialEndsAt || activeTrialSubscription?.currentPeriodEnd || null,
    };
  });

  const prioritizedClientRows = pinPrimaryItemFirst(clientRows, (user) =>
    isPrimaryCavBotAdminIdentity({
      email: user.email,
      username: user.username,
      name: user.displayName || user.fullName || user.username || user.email,
    }),
  );

  const directoryCards: ClientDirectoryCardData[] = prioritizedClientRows.map((user) => {
    const orderedMemberships = [...user.memberships].sort((left, right) => {
      const leftPlan = resolveMembershipPlanDisplay(left, now);
      const rightPlan = resolveMembershipPlanDisplay(right, now);
      return rankTier(rightPlan.planTier) - rankTier(leftPlan.planTier);
    });
    const { primarySubscriptionStatus, primaryIsTrialing, primaryPlanLabel } = resolveClientPlanState(user.memberships, now);
    const health = resolveClientHealth({
      lastLoginAt: user.lastLoginAt,
      sessionCount: user.sessionCount,
      sites: user.sites,
      subscriptionStatus: primarySubscriptionStatus,
      activeSince: sevenDays,
    });
    return {
      id: user.id,
      name: user.displayName || user.fullName || user.username || user.email,
      email: user.email,
      planTier: user.resolvedTier,
      isTrialing: primaryIsTrialing,
      hasCavBotAdminIdentity: user.staffProfile?.status === "ACTIVE" && user.staffProfile?.onboardingStatus !== "PENDING",
      planLabel: primaryPlanLabel,
      usernameLabel: user.username ? `@${user.username}` : "No username set",
      regionLabel: user.country || user.region || "No geo captured",
      joinedLabel: formatDate(user.createdAt),
      lastActiveLabel: formatDateTime(user.lastLoginAt),
      trialLabel: user.activeTrialStartedAt && user.activeTrialEndsAt
        ? `${formatDate(user.activeTrialStartedAt)} → ${formatDate(user.activeTrialEndsAt)}`
        : "No active trial",
      sitesLabel: formatInt(user.sites),
      sessionsLabel: formatInt(user.sessionCount),
      cavverifyLabel: formatInt(user.cavverifyCount),
      cavguardLabel: formatInt(user.cavguardCount),
      cloudStorageLabel: `${formatInt(user.storage.cloudFiles)} files · ${formatBytes(user.storage.cloudBytes)}`,
      safeStorageLabel: `${formatInt(user.storage.safeFiles)} files · ${formatBytes(user.storage.safeBytes)}`,
      uploadedFilesLabel: formatInt(user.storageActivity.uploadedFiles),
      deletedFilesLabel: formatInt(user.storageActivity.deletedFiles),
      workspaceCountLabel: formatInt(orderedMemberships.length),
      primaryOwnerLabel: user.primaryMembership ? formatUserHandle(accountOwners.get(user.primaryMembership.accountId), "No owner") : "No owner",
      primaryWorkspaceLabel: user.primaryMembership?.account.name || "Not attached",
      healthLabel: health.label,
      healthTone: health.tone,
      sessionCountValue: user.sessionCount,
      avatarImage: user.avatarImage || null,
      avatarTone: user.avatarTone || null,
      publicProfileHref: user.username ? buildCanonicalPublicProfileHref(user.username) : null,
      detailHref: `/clients/${user.id}`,
      workspaceSummaries: orderedMemberships.map((membership) => {
        const latestSubscription = membership.account.subscriptions[0] || null;
        const membershipPlan = resolveMembershipPlanDisplay(membership, now);
        const trialEndsAt = membership.account.trialEndsAt || latestSubscription?.currentPeriodEnd || null;
        return {
          id: membership.accountId,
          name: membership.account.name,
          ownerLabel: formatUserHandle(accountOwners.get(membership.accountId), "No owner"),
          roleLabel: formatMemberRole(membership.role),
          planLabel: membershipPlan.planLabel,
          statusLabel: formatAdminSubscriptionLabel({
            status: latestSubscription?.status || null,
            tier: membership.account.tier,
            subscriptionTier: latestSubscription?.tier,
            currentPeriodEnd: latestSubscription?.currentPeriodEnd,
            trialSeatActive: membership.account.trialSeatActive,
            trialEndsAt: membership.account.trialEndsAt,
          }),
          trialLabel: membershipPlan.isTrialing
            ? membership.account.trialStartedAt && trialEndsAt
              ? `${formatDate(membership.account.trialStartedAt)} → ${formatDate(trialEndsAt)}`
              : trialEndsAt
                ? `Active until ${formatDate(trialEndsAt)}`
                : "Active trial"
            : "No active trial",
        };
      }),
    };
  });
  const chartSourceCards = chartUsers.map((user) => resolveClientPlanState(user.memberships, now));
  const activityCards = directoryCards
    .slice()
    .sort((left, right) => (right.sessionCountValue || 0) - (left.sessionCountValue || 0))
    .slice(0, 6);
  const premiumClientCount = chartSourceCards.filter((card) => !card.primaryIsTrialing && card.resolvedTier === "PREMIUM").length;
  const premiumPlusClientCount = chartSourceCards.filter((card) => !card.primaryIsTrialing && card.resolvedTier === "ENTERPRISE").length;

  return (
    <AdminPage
      title="Clients"
      subtitle="User operations across signups, activation, plan mix, account coverage, activity health, and security load."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Upgraded from free" value={formatInt(upgradedFromFreeUsers.size)} meta={`${formatInt(upgradedFromFreeAccountIds.size)} upgrades in ${window.label}`} />
        <MetricCard label="Downgraded to free" value={formatInt(downgradedToFreeUsers.size)} meta={`${formatInt(downgradedToFreeAccountIds.size)} downgrades in ${window.label}`} />
        <MetricCard label="Paid users" value={formatInt(paidUsers)} meta="Membership-level paid footprint" />
        <MetricCard label="Trial ending soon" value={formatInt(trialEndingSoonUsers.length)} meta="Users on trial seats ending within 14 days" />
        <MetricCard label="Past due" value={formatInt(failedPaymentUsers.length)} meta="Subscription intervention required" />
        <MetricCard label="DAU" value={formatInt(dau)} meta="Daily persisted last-login activity" />
        <MetricCard label="WAU" value={formatInt(wau)} meta="Weekly persisted last-login activity" />
        <MetricCard label="MAU" value={formatInt(mau)} meta="Monthly persisted last-login activity" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <PlanSharePanel
          title="Premium client split"
          subtitle="All-client paid split across Premium and Premium+ so operator teams can see which paid client tier is leading adoption."
          items={[
            { label: "Premium", value: premiumClientCount, tone: "premium", meta: `${premiumClientCount} clients in Premium` },
            { label: "Premium+", value: premiumPlusClientCount, tone: "enterprise", meta: `${premiumPlusClientCount} clients in Premium+` },
          ]}
          emptyTitle="No Premium or Premium+ clients in this slice."
          emptySubtitle="Add paid clients and the bar chart will render here."
        />

        <Panel title="Highest activity" subtitle="Most active clients in the current result set, surfaced as a cleaner operator shortlist.">
          <div className="hq-list">
            {activityCards.map((user) => (
              <div key={user.id} className="hq-listRow">
                <div className="hq-inlineStart">
                  <AvatarBadge name={user.name} email={user.email} image={user.avatarImage} tone={user.avatarTone} />
                  <div>
                    <div className="hq-listLabel">
                      {user.detailHref ? <Link href={user.detailHref}>{user.name}</Link> : user.name}
                    </div>
                    <div className="hq-listMeta">
                      {user.usernameLabel} · {user.sessionsLabel} sessions · {user.sitesLabel} sites
                    </div>
                  </div>
                </div>
                <span
                  className="hq-platformServiceState hq-clientActivityState"
                  data-status={(user.healthTone || "watch") === "good" ? "healthy" : (user.healthTone || "watch") === "bad" ? "incident" : "at-risk"}
                >
                  <span className="hq-platformServiceStateDot" aria-hidden="true" />
                  <span className="hq-platformServiceStateText">{user.healthLabel || "Watching"}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <Panel
        title="Client directory"
        subtitle="Centered client cards with click-through detail modals so the full client record stays elegant, readable, and off the main grid."
      >
        <section className="hq-filterShell">
          <form className="hq-filterRail">
            <input type="hidden" name="range" value={range} />
            <input type="hidden" name="month" value={month || ""} />
            <label className="hq-filterField hq-filterFieldSearch">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <input className="hq-filterInput" type="search" name="q" placeholder="Search email, name, username" defaultValue={q} aria-label="Client search" />
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="plan" defaultValue={plan || ""} aria-label="Plan">
                <option value="">All plans</option>
                <option value="TRIALING">Trialing</option>
                <option value="FREE">Free</option>
                <option value="PREMIUM">Premium</option>
                <option value="ENTERPRISE">Premium+</option>
              </select>
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="status" defaultValue={status || ""} aria-label="Activity">
                <option value="">All activity states</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <input className="hq-filterInput" type="search" name="region" placeholder="Country or region" defaultValue={region} aria-label="Region" />
            </label>
            <div className="hq-filterActions">
              <button className="hq-button" type="submit">Apply</button>
            </div>
          </form>
        </section>
        <ClientDirectoryGrid clients={directoryCards} />
        <PaginationNav
          page={page}
          pageCount={totalPages}
          pathname="/clients"
          searchParams={props.searchParams || {}}
        />
      </Panel>
    </AdminPage>
  );
}
