import Link from "next/link";

import {
  AdminPage,
  Badge,
  EmptyState,
  MetricCard,
  PaginationNav,
  Panel,
  PlanSharePanel,
} from "@/components/admin/AdminPrimitives";
import { AdminSignupMethodInline, AdminSignupMethodMark } from "@/components/admin/AdminSignupMethodMark";
import { AccountDirectoryGrid, type AccountDirectoryCardData } from "@/components/admin/AccountDirectoryGrid";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import { isPrimaryCavBotAdminIdentity, pinPrimaryItemFirst } from "@/lib/admin/pinning";
import {
  formatPercent,
  formatAdminSubscriptionLabel,
  formatBytes,
  formatDate,
  formatInt,
  formatUserHandle,
  formatUserName,
  getAccountFootprints,
  getAccountOwners,
  getLatestSubscriptions,
  offsetForPage,
  pageCount,
  parseAdminMonth,
  parseAdminRange,
  parsePage,
  resolveAdminPlanDisplay,
  resolveAdminWindow,
} from "@/lib/admin/server";
import {
  formatAdminSignupMethodLabel,
  normalizeAdminSignupMethod,
  resolveAdminSignupMethod,
  type AdminSignupMethod,
} from "@/lib/admin/signupMethod";
import { getAccountStorageMap } from "@/lib/admin/storage";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";
import { buildCanonicalPublicProfileHref } from "@/lib/publicProfile/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

function s(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function resolveAccountHealth(input: {
  subscriptionStatus?: string | null;
  notices: number;
  sessions: number;
  sites: number;
  trialSeatActive: boolean;
}) {
  if (String(input.subscriptionStatus || "").toUpperCase() === "PAST_DUE" || input.notices >= 3) {
    return { label: "At risk", tone: "bad" as const };
  }
  if (input.trialSeatActive || input.notices > 0 || input.sessions === 0 || input.sites === 0) {
    return { label: "Watching", tone: "watch" as const };
  }
  return { label: "Healthy", tone: "good" as const };
}

function AccountSignupSourcePanel(props: {
  items: Array<{ method: AdminSignupMethod; value: number }>;
}) {
  const total = props.items.reduce((sum, item) => sum + item.value, 0);
  const hasValues = props.items.some((item) => item.value > 0);
  const maxValue = Math.max(1, ...props.items.map((item) => item.value));
  const lead = props.items.slice().sort((left, right) => right.value - left.value)[0] || null;

  return (
    <Panel title="Signup source mix" subtitle="How current workspace owners first came into CavBot through direct signup, Google, or GitHub.">
      {hasValues ? (
        <div className="hq-signupSourceShare">
          <div className="hq-signupSourceLead">
            <div className="hq-signupSourceLeadLabel">Most represented</div>
            {lead ? (
              <>
                <div className="hq-signupSourceLeadValue">
                  <AdminSignupMethodInline method={lead.method} />
                </div>
                <p className="hq-signupSourceLeadMeta">
                  {Math.round((lead.value / Math.max(1, total)) * 100)}% of the current workspace slice
                </p>
              </>
            ) : null}
          </div>
          <div className="hq-signupSourceBubbleGrid">
            {props.items.map((item) => {
              const percent = Math.round((item.value / Math.max(1, total)) * 100);
              const size = item.value > 0 ? 70 + Math.round((item.value / maxValue) * 34) : 62;
              return (
                <article key={item.method} className="hq-signupSourceBubbleCard">
                  <div className="hq-signupSourceBubble" data-method={item.method} style={{ width: `${size}px`, height: `${size}px` }}>
                    <span className="hq-signupSourceBubbleMark" aria-hidden="true">
                      <AdminSignupMethodMark method={item.method} size={18} />
                    </span>
                    <strong className="hq-signupSourceBubbleValue">{formatInt(item.value)}</strong>
                  </div>
                  <div className="hq-signupSourceBubbleLabel">{formatAdminSignupMethodLabel(item.method)}</div>
                  <div className="hq-signupSourceBubbleMeta">{percent}%</div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState title="No signup source data yet." subtitle="As account creation and auth records are captured, the signup mix will render here." />
      )}
    </Panel>
  );
}

export default async function AccountsPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/accounts", { scopes: ["accounts.read"] });

  const q = s(props.searchParams?.q).trim();
  const rawTier = s(props.searchParams?.tier).trim().toUpperCase();
  const tier = rawTier === "TRIALING" || rawTier === "FREE" || rawTier === "PREMIUM" || rawTier === "ENTERPRISE" ? rawTier : "";
  const subscription = s(props.searchParams?.subscription).trim().toUpperCase();
  const signupMethod = normalizeAdminSignupMethod(s(props.searchParams?.signupMethod)) || "";
  const range = parseAdminRange(s(props.searchParams?.range), "30d");
  const month = parseAdminMonth(s(props.searchParams?.month));
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const page = parsePage(s(props.searchParams?.page), 1);
  const now = new Date();
  const today = startOfToday();
  const sevenDays = resolveAdminWindow("7d").start;
  const thirtyDays = resolveAdminWindow("30d").start;
  const accountSliceMemberSelect = {
    userId: true,
    user: {
      select: {
        createdAt: true,
        lastLoginAt: true,
        memberships: {
          select: {
            account: {
              select: {
                projects: {
                  where: { isActive: true },
                  take: 1,
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    },
  } as const;
  const activeTrialingSubscriptionWhere = {
    status: "TRIALING" as const,
    currentPeriodEnd: {
      gt: now,
    },
  };
  const trialingWhere = {
    OR: [
      {
        subscriptions: {
          some: activeTrialingSubscriptionWhere,
        },
      },
      {
        trialSeatActive: true,
        trialEndsAt: {
          gt: now,
        },
      },
    ],
  };

  const baseWhere = {
    AND: [
      q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { slug: { contains: q, mode: "insensitive" as const } },
              { billingEmail: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {},
      { updatedAt: { gte: start, lt: end } },
      tier === "TRIALING"
        ? trialingWhere
        : tier
          ? {
              AND: [
                { tier: tier as "FREE" | "PREMIUM" | "ENTERPRISE" },
                { NOT: trialingWhere },
              ],
            }
          : {},
      subscription
        ? {
            subscriptions: {
              some: subscription === "TRIALING"
                ? activeTrialingSubscriptionWhere
                : {
                    status: subscription as "ACTIVE" | "PAST_DUE" | "CANCELED",
                  },
            },
          }
        : {},
    ],
  };

  const [totalAccounts, baseFilteredAccounts, trialingAccounts, deletedAccounts, signupMethodCandidates] = await Promise.all([
    prisma.account.count(),
    signupMethod ? Promise.resolve(0) : prisma.account.count({ where: baseWhere }),
    prisma.account.count({
      where: trialingWhere,
    }),
    prisma.auditLog.count({
      where: {
        action: "ACCOUNT_DELETED",
        createdAt: { gte: start, lt: end },
      },
    }),
    signupMethod
      ? prisma.account.findMany({
          where: baseWhere,
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            members: {
              orderBy: [{ role: "asc" }, { createdAt: "asc" }],
              select: {
                role: true,
                user: {
                  select: {
                    oauthIdentities: {
                      orderBy: { createdAt: "asc" },
                      take: 3,
                      select: {
                        provider: true,
                        createdAt: true,
                      },
                    },
                  },
                },
              },
            },
            auditLogs: {
              where: {
                action: "ACCOUNT_CREATED",
              },
              orderBy: { createdAt: "asc" },
              take: 1,
              select: {
                metaJson: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const filteredAccountIds = signupMethod
    ? signupMethodCandidates
        .filter((account) => {
          const ownerMembership = account.members.find((member) => member.role === "OWNER") || account.members[0] || null;
          return resolveAdminSignupMethod({
            accountCreatedMeta: account.auditLogs[0]?.metaJson,
            identities: ownerMembership?.user.oauthIdentities || [],
          }) === signupMethod;
        })
        .map((account) => account.id)
    : [];
  const filteredAccounts = signupMethod ? filteredAccountIds.length : baseFilteredAccounts;
  const pagedSignupMethodAccountIds = signupMethod
    ? filteredAccountIds.slice(offsetForPage(page, PAGE_SIZE), offsetForPage(page, PAGE_SIZE) + PAGE_SIZE)
    : [];
  const accountSliceMembers = signupMethod
    ? (filteredAccountIds.length
        ? await prisma.membership.findMany({
            where: {
              accountId: { in: filteredAccountIds },
            },
            distinct: ["userId"],
            select: accountSliceMemberSelect,
          })
        : [])
    : await prisma.membership.findMany({
        where: {
          account: baseWhere,
        },
        distinct: ["userId"],
        select: accountSliceMemberSelect,
      });

  const accounts = await prisma.account.findMany({
      where: signupMethod
        ? (pagedSignupMethodAccountIds.length
            ? { id: { in: pagedSignupMethodAccountIds } }
            : { id: "__no_matching_signup_method__" })
        : baseWhere,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: signupMethod ? undefined : offsetForPage(page, PAGE_SIZE),
      take: signupMethod ? undefined : PAGE_SIZE,
      select: {
        id: true,
        name: true,
        slug: true,
        tier: true,
        billingEmail: true,
        createdAt: true,
        updatedAt: true,
        trialSeatActive: true,
        trialEndsAt: true,
        members: {
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            role: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                email: true,
                username: true,
                displayName: true,
                avatarImage: true,
                avatarTone: true,
                lastLoginAt: true,
                oauthIdentities: {
                  orderBy: { createdAt: "asc" },
                  take: 3,
                  select: {
                    provider: true,
                    createdAt: true,
                  },
                },
                staffProfile: {
                  select: {
                    status: true,
                    onboardingStatus: true,
                  },
                },
              },
            },
          },
        },
      },
    });

  if (signupMethod && pagedSignupMethodAccountIds.length > 1) {
    const signupMethodPosition = new Map(pagedSignupMethodAccountIds.map((accountId, index) => [accountId, index]));
    accounts.sort((left, right) => (signupMethodPosition.get(left.id) ?? 0) - (signupMethodPosition.get(right.id) ?? 0));
  }

  const totalPages = pageCount(filteredAccounts, PAGE_SIZE);
  const accountRetentionRate = totalAccounts > 0 ? (filteredAccounts / totalAccounts) * 100 : 0;
  const accountSliceUserCount = accountSliceMembers.length;
  const accountSliceNewToday = accountSliceMembers.filter((member) => member.user.createdAt >= today).length;
  const accountSliceNew7d = accountSliceMembers.filter((member) => member.user.createdAt >= sevenDays).length;
  const accountSliceNew30d = accountSliceMembers.filter((member) => member.user.createdAt >= thirtyDays).length;
  const accountSliceInactiveUsers = accountSliceMembers.filter((member) => !member.user.lastLoginAt || member.user.lastLoginAt < thirtyDays).length;
  const accountSliceNoSetupUsers = accountSliceMembers.filter((member) =>
    !member.user.memberships.some((membership) => membership.account.projects.length > 0),
  ).length;
  const accountIds = accounts.map((account) => account.id);

  const [footprints, owners, subscriptions, sessionCounts, securityCounts, unresolvedNotices, storageMap, accountCreatedAuditRows] = await Promise.all([
    getAccountFootprints(accountIds),
    getAccountOwners(accountIds),
    getLatestSubscriptions(accountIds),
    accountIds.length
      ? prisma.cavAiSession.groupBy({
          by: ["accountId"],
          where: { accountId: { in: accountIds }, createdAt: { gte: start, lt: end } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    accountIds.length
      ? prisma.adminEvent.groupBy({
          by: ["accountId", "name"],
        where: {
          accountId: { in: accountIds },
          createdAt: { gte: start, lt: end },
          name: { in: ["cavverify_rendered", "cavguard_rendered"] },
        },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    accountIds.length
      ? prisma.workspaceNotice.groupBy({
          by: ["accountId"],
        where: {
          accountId: { in: accountIds },
          createdAt: { gte: start, lt: end },
          dismissedAt: null,
        },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    getAccountStorageMap(accountIds),
    accountIds.length
      ? prisma.auditLog.findMany({
          where: {
            accountId: { in: accountIds },
            action: "ACCOUNT_CREATED",
          },
          orderBy: { createdAt: "asc" },
          select: {
            accountId: true,
            metaJson: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const sessionMap = new Map(sessionCounts.map((row) => [row.accountId, row._count._all]));
  const noticeMap = new Map(unresolvedNotices.map((row) => [row.accountId, row._count._all]));
  const verifyMap = new Map<string, number>();
  const guardMap = new Map<string, number>();
  for (const row of securityCounts) {
    if (!row.accountId) continue;
    if (row.name === "cavverify_rendered") verifyMap.set(row.accountId, row._count._all);
    if (row.name === "cavguard_rendered") guardMap.set(row.accountId, row._count._all);
  }
  const accountCreatedAuditMap = new Map<string, unknown>();
  for (const row of accountCreatedAuditRows) {
    if (!row.accountId || accountCreatedAuditMap.has(row.accountId)) continue;
    accountCreatedAuditMap.set(row.accountId, row.metaJson);
  }

  const rows = accounts.map((account) => {
    const footprint = footprints.get(account.id) || {
      projects: 0,
      sites: 0,
      members: 0,
      notices: 0,
      scans: 0,
      notifications: 0,
    };
    const sub = subscriptions.get(account.id);
    const planDisplay = resolveAdminPlanDisplay({
      tier: account.tier,
      status: sub?.status,
      subscriptionTier: sub?.tier,
      currentPeriodEnd: sub?.currentPeriodEnd,
      trialSeatActive: account.trialSeatActive,
      trialEndsAt: account.trialEndsAt,
      now,
    });
    const health = resolveAccountHealth({
      subscriptionStatus: sub?.status || null,
      notices: noticeMap.get(account.id) || 0,
      sessions: sessionMap.get(account.id) || 0,
      sites: footprint.sites,
      trialSeatActive: planDisplay.isTrialing,
    });
    const ownerMembership = account.members.find((member) => member.role === "OWNER") || account.members[0] || null;
    const signupMethod = resolveAdminSignupMethod({
      accountCreatedMeta: accountCreatedAuditMap.get(account.id),
      identities: ownerMembership?.user.oauthIdentities || [],
    });
    return {
      ...account,
      footprint,
      owner: owners.get(account.id),
      subscription: sub,
      planDisplay,
      sessions: sessionMap.get(account.id) || 0,
      cavverify: verifyMap.get(account.id) || 0,
      cavguard: guardMap.get(account.id) || 0,
      notices: noticeMap.get(account.id) || 0,
      signupMethod,
      signupMethodLabel: formatAdminSignupMethodLabel(signupMethod),
      storage: storageMap.get(account.id) || {
        accountId: account.id,
        cloudFiles: 0,
        safeFiles: 0,
        cloudBytes: BigInt(0),
        safeBytes: BigInt(0),
        totalFiles: 0,
        totalBytes: BigInt(0),
        cloudUploadedFiles: 0,
        safeUploadedFiles: 0,
        uploadedFiles: 0,
        cloudDeletedFiles: 0,
        safeDeletedFiles: 0,
        deletedFiles: 0,
      },
      health,
    };
  });

  const prioritizedAccountRows = pinPrimaryItemFirst(rows, (account) =>
    account.members.some((member) =>
      isPrimaryCavBotAdminIdentity({
        email: member.user.email,
        username: member.user.username,
        name: member.user.displayName || member.user.username || member.user.email,
      }),
    ),
  );

  const accountCards: AccountDirectoryCardData[] = prioritizedAccountRows.map((account) => {
    const { isTrialing, planLabel, planTier } = account.planDisplay;
    return {
      id: account.id,
      name: account.name,
      email: account.billingEmail || account.owner?.email || "No billing email",
      planTier,
      isTrialing,
      hasCavBotAdminIdentity: account.members.some(
        (member) => member.user.staffProfile?.status === "ACTIVE" && member.user.staffProfile?.onboardingStatus !== "PENDING",
      ),
      signupMethod: account.signupMethod,
      signupMethodLabel: account.signupMethodLabel,
      planLabel,
      usernameLabel: formatUserHandle(account.owner, "No owner"),
      publicProfileHref: account.owner?.username ? buildCanonicalPublicProfileHref(account.owner.username) : null,
      healthLabel: account.health.label,
      healthTone: account.health.tone,
      membersLabel: formatInt(account.footprint.members),
      sitesLabel: formatInt(account.footprint.sites),
      sessionsLabel: formatInt(account.sessions),
      noticesLabel: formatInt(account.notices),
      cloudStorageLabel: `${formatInt(account.storage.cloudFiles)} files · ${formatBytes(account.storage.cloudBytes)}`,
      safeStorageLabel: `${formatInt(account.storage.safeFiles)} files · ${formatBytes(account.storage.safeBytes)}`,
      uploadedFilesLabel: formatInt(account.storage.uploadedFiles),
      deletedFilesLabel: formatInt(account.storage.deletedFiles),
      trialLabel: isTrialing
        ? `Active until ${formatDate(account.trialEndsAt || account.subscription?.currentPeriodEnd)}`
        : "No active trial",
      subscriptionLabel: formatAdminSubscriptionLabel({
        status: account.subscription?.status,
        tier: account.tier,
        subscriptionTier: account.subscription?.tier,
        currentPeriodEnd: account.subscription?.currentPeriodEnd,
        trialSeatActive: account.trialSeatActive,
        trialEndsAt: account.trialEndsAt,
      }),
      billingEmailLabel: account.billingEmail || "Not set",
      ownerNameLabel: formatUserName(account.owner),
      ownerHandleLabel: formatUserHandle(account.owner, "No owner"),
      securityLabel: `${formatInt(account.cavverify + account.cavguard)} events · ${formatInt(account.cavguard)} guard escalations`,
      renewalLabel: account.subscription?.currentPeriodEnd ? `Renews ${formatDate(account.subscription.currentPeriodEnd)}` : "No renewal recorded",
      updatedLabel: formatDate(account.updatedAt),
      sessionCountValue: account.sessions,
      avatarImage: account.owner?.avatarImage || null,
      avatarTone: account.owner?.avatarTone || null,
      detailHref: `/accounts/${account.id}`,
      memberSummaries: account.members.map((member) => ({
        id: member.id,
        name: member.user.displayName || member.user.username || member.user.email,
      handle: member.user.username ? `@${member.user.username}` : member.user.email,
      lastActiveLabel: `Last active ${formatDate(member.user.lastLoginAt)}`,
        avatarImage: member.user.avatarImage || null,
        avatarTone: member.user.avatarTone || null,
      })),
    };
  });
  const trialingAccountCount = accountCards.filter((card) => card.isTrialing).length;
  const freeAccountCount = accountCards.filter((card) => !card.isTrialing && card.planTier === "FREE").length;
  const premiumAccountCount = accountCards.filter((card) => !card.isTrialing && card.planTier === "PREMIUM").length;
  const premiumPlusAccountCount = accountCards.filter((card) => !card.isTrialing && card.planTier === "ENTERPRISE").length;
  const signupSourceItems: Array<{ method: AdminSignupMethod; value: number }> = [
    { method: "cavbot", value: rows.filter((account) => account.signupMethod === "cavbot").length },
    { method: "google", value: rows.filter((account) => account.signupMethod === "google").length },
    { method: "github", value: rows.filter((account) => account.signupMethod === "github").length },
  ];

  return (
    <AdminPage
      title="Accounts"
      subtitle="Workspace-level operations view for plan health, owners, seats, projects, monitored sites, notices, and security load."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Total users" value={formatInt(accountSliceUserCount)} meta={`${formatInt(accountSliceUserCount)} in current filter`} />
        <MetricCard label="New users" value={formatInt(accountSliceNew30d)} meta={`${formatInt(accountSliceNewToday)} today · ${formatInt(accountSliceNew7d)} in 7 days`} />
        <MetricCard label="Account retention" value={formatPercent(accountRetentionRate)} meta={`${formatInt(filteredAccounts)} of ${formatInt(totalAccounts)} active in ${rangeLabel}`} />
        <MetricCard label="Trialing" value={formatInt(trialingAccounts)} meta="Active workspace trials" />
        <MetricCard label="Inactive users" value={formatInt(accountSliceInactiveUsers)} meta={`${formatInt(accountSliceNoSetupUsers)} with no active project or site`} />
        <MetricCard label="Projects" value={formatInt(rows.reduce((sum, row) => sum + row.footprint.projects, 0))} meta="Current page footprint" />
        <MetricCard label="Sites" value={formatInt(rows.reduce((sum, row) => sum + row.footprint.sites, 0))} meta="Current page footprint" />
        <MetricCard label="Members" value={formatInt(rows.reduce((sum, row) => sum + row.footprint.members, 0))} meta="Current page seat load" />
        <MetricCard label="Deleted accounts" value={formatInt(deletedAccounts)} meta={`Recorded in ${rangeLabel}`} className="hq-cardDestructiveThin" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <PlanSharePanel
          title="Account plan split"
          subtitle="Workspace distribution across Free, Trialing, Premium, and Premium+ in the current account slice."
          items={[
            { label: "Trialing", value: trialingAccountCount, tone: "trialing" },
            { label: "Free", value: freeAccountCount, tone: "free" },
            { label: "Premium", value: premiumAccountCount, tone: "premium" },
            { label: "Premium+", value: premiumPlusAccountCount, tone: "enterprise" },
          ]}
        />

        <Panel title="Watchlist" subtitle="Accounts carrying the highest intervention load in the current result set.">
          <div className="hq-list">
            {rows
              .slice()
              .sort((left, right) => (right.notices + (right.subscription?.status === "PAST_DUE" ? 5 : 0)) - (left.notices + (left.subscription?.status === "PAST_DUE" ? 5 : 0)))
              .slice(0, 6)
              .map((account) => {
                const watchlistLabel = account.subscription?.status === "PAST_DUE" ? "Past due" : account.planDisplay.planLabel;
                return (
                  <div key={account.id} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">
                      <Link href={`/accounts/${account.id}`}>{formatUserHandle(account.owner)}</Link>
                    </div>
                    <div className="hq-listMeta">
                      {formatUserName(account.owner)} · {account.notices} open notices
                    </div>
                  </div>
                  <Badge className="hq-badgeCompact hq-badgeCorporate hq-watchlistStatusBadge" tone={account.subscription?.status === "PAST_DUE" ? "bad" : account.notices > 0 ? "watch" : "good"}>
                    {watchlistLabel}
                  </Badge>
                  </div>
                );
              })}
          </div>
        </Panel>
      </section>

      <section className="hq-grid hq-gridTwo">
        <AccountSignupSourcePanel items={signupSourceItems} />

        <Panel title="Signup routes" subtitle="Latest account creation paths across the current workspace slice.">
          {rows.length ? (
            <div className="hq-list">
              {rows
                .slice()
                .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
                .slice(0, 6)
                .map((account) => (
                  <div key={account.id} className="hq-listRow">
                    <div>
                      <div className="hq-listLabel">
                        <Link href={`/accounts/${account.id}`}>{account.name}</Link>
                      </div>
                      <div className="hq-listMeta">
                        {formatUserHandle(account.owner, "No owner")} · {formatDate(account.createdAt)}
                      </div>
                    </div>
                    <AdminSignupMethodInline method={account.signupMethod} className="hq-signupMethodInlineCompact" />
                  </div>
                ))}
            </div>
          ) : (
            <EmptyState title="No account signup routes yet." subtitle="As accounts are created in this window, their entry path will render here." />
          )}
        </Panel>
      </section>

      <Panel title="Account directory" subtitle="Centered account cards with full workspace health and membership detail moved into elegant click-through modals.">
        <section className="hq-filterShell">
          <form className="hq-filterRail">
            <input type="hidden" name="range" value={range} />
            <input type="hidden" name="month" value={month || ""} />
            <label className="hq-filterField hq-filterFieldSearch">
              <span className="hq-filterLabel">Workspace search</span>
              <input className="hq-filterInput" type="search" name="q" placeholder="Search account name, slug, billing email" defaultValue={q} />
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel">Tier</span>
              <select className="hq-filterSelect" name="tier" defaultValue={tier || ""}>
                <option value="">All tiers</option>
                <option value="TRIALING">Trialing</option>
                <option value="FREE">Free</option>
                <option value="PREMIUM">Premium</option>
                <option value="ENTERPRISE">Premium+</option>
              </select>
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel">Subscription</span>
              <select className="hq-filterSelect" name="subscription" defaultValue={subscription || ""}>
                <option value="">All subscription</option>
                <option value="ACTIVE">Active</option>
                <option value="TRIALING">Trialing</option>
                <option value="PAST_DUE">Past due</option>
                <option value="CANCELED">Canceled</option>
              </select>
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel">Signup method</span>
              <select className="hq-filterSelect" name="signupMethod" defaultValue={signupMethod || ""}>
                <option value="">All signup methods</option>
                <option value="cavbot">CavBot</option>
                <option value="google">Google</option>
                <option value="github">GitHub</option>
              </select>
            </label>
            <div className="hq-filterActions">
              <button className="hq-button" type="submit">Apply</button>
            </div>
          </form>
        </section>
        <AccountDirectoryGrid accounts={accountCards} />
        <PaginationNav
          page={page}
          pageCount={totalPages}
          pathname="/accounts"
          searchParams={props.searchParams || {}}
        />
      </Panel>
    </AdminPage>
  );
}
