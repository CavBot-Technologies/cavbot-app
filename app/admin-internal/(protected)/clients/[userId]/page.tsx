import Link from "next/link";
import { Prisma } from "@prisma/client";
import { Suspense } from "react";
import { notFound } from "next/navigation";

import {
  AdminPage,
  AvatarBadge,
  Badge,
  KeyValueGrid,
  Panel,
} from "@/components/admin/AdminPrimitives";
import {
  formatAdminSubscriptionLabel,
  formatBytes,
  formatDate,
  formatDateTime,
  formatInt,
  formatUserHandle,
  formatUserName,
  getAccountOwners,
  resolveAdminPlanDisplay,
} from "@/lib/admin/server";
import { formatStaffStatusLabel, formatStaffSystemRoleLabel } from "@/lib/admin/staffDisplay";
import { getAccountStorageMap, getUserStorageActivityMap, sumAccountStorageSummaries } from "@/lib/admin/storage";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clientDetailUserSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  email: true,
  username: true,
  displayName: true,
  fullName: true,
  bio: true,
  country: true,
  region: true,
  timeZone: true,
  companyName: true,
  companyCategory: true,
  companySubcategory: true,
  avatarImage: true,
  avatarTone: true,
  createdAt: true,
  lastLoginAt: true,
  emailVerifiedAt: true,
  staffProfile: {
    select: {
      id: true,
      staffCode: true,
      systemRole: true,
      positionTitle: true,
      status: true,
      onboardingStatus: true,
      metadataJson: true,
      lastAdminLoginAt: true,
    },
  },
  memberships: {
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      createdAt: true,
      account: {
        select: {
          id: true,
          name: true,
          slug: true,
          tier: true,
          billingEmail: true,
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
          members: {
            where: { role: "OWNER" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: {
              user: {
                select: {
                  id: true,
                  email: true,
                  username: true,
                  displayName: true,
                  fullName: true,
                  avatarImage: true,
                  avatarTone: true,
                },
              },
            },
          },
        },
      },
    },
  },
});

function rankTier(tier: string) {
  if (tier === "ENTERPRISE") return 3;
  if (tier === "PREMIUM") return 2;
  return 1;
}

function resolveMembershipPlanDisplay(membership: {
  account: {
    tier: string;
    trialSeatActive: boolean | null;
    trialEndsAt: Date | null;
    subscriptions: Array<{
      status: string;
      tier: string;
      currentPeriodEnd: Date | null;
    }>;
  };
}, now: Date) {
  const latestSubscription = membership.account.subscriptions[0] || null;
  return resolveAdminPlanDisplay({
    tier: membership.account.tier,
    status: latestSubscription?.status,
    subscriptionTier: latestSubscription?.tier,
    currentPeriodEnd: latestSubscription?.currentPeriodEnd,
    trialSeatActive: membership.account.trialSeatActive,
    trialEndsAt: membership.account.trialEndsAt,
    now,
  });
}

function DetailPanelFallback(props: {
  title: string;
  subtitle: string;
  message: string;
}) {
  return (
    <Panel title={props.title} subtitle={props.subtitle}>
      <p className="hq-helperText">{props.message}</p>
    </Panel>
  );
}

async function getClientDetailBase(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: clientDetailUserSelect,
  });

  if (!user) return null;

  const accountIds = Array.from(new Set(user.memberships.map((membership) => membership.account.id)));
  const [memberCounts, projectCounts, siteCounts] = await Promise.all([
    accountIds.length
      ? prisma.membership.groupBy({
          by: ["accountId"],
          where: { accountId: { in: accountIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    accountIds.length
      ? prisma.project.groupBy({
          by: ["accountId"],
          where: {
            accountId: { in: accountIds },
            isActive: true,
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    accountIds.length
      ? prisma.$queryRaw<Array<{ accountId: string; sites: bigint }>>(Prisma.sql`
          SELECT
            p."accountId" AS "accountId",
            COUNT(s."id") AS "sites"
          FROM "Project" p
          LEFT JOIN "Site" s
            ON s."projectId" = p."id"
           AND s."isActive" = true
          WHERE p."accountId" IN (${Prisma.join(accountIds)})
            AND p."isActive" = true
          GROUP BY p."accountId"
        `)
      : Promise.resolve([]),
  ]);

  const memberCountMap = new Map(memberCounts.map((row) => [row.accountId, row._count._all]));
  const projectCountMap = new Map(projectCounts.map((row) => [row.accountId, row._count._all]));
  const siteCountMap = new Map(siteCounts.map((row) => [row.accountId, Number(row.sites)]));
  const now = new Date();
  const resolvedMemberships = [...user.memberships].sort((left, right) => {
    const leftPlan = resolveMembershipPlanDisplay(left, now);
    const rightPlan = resolveMembershipPlanDisplay(right, now);
    if (leftPlan.isTrialing !== rightPlan.isTrialing) return Number(rightPlan.isTrialing) - Number(leftPlan.isTrialing);
    return rankTier(rightPlan.planTier) - rankTier(leftPlan.planTier);
  });

  return {
    user,
    accountIds,
    resolvedMemberships,
    memberCountMap,
    projectCountMap,
    siteCountMap,
  };
}

async function ClientProjectsPanel(props: {
  accountIds: string[];
}) {
  const projects = props.accountIds.length
    ? await prisma.project.findMany({
        where: { accountId: { in: props.accountIds }, isActive: true },
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: {
          id: true,
          name: true,
          slug: true,
          updatedAt: true,
          sites: {
            where: { isActive: true },
            select: { id: true, origin: true },
          },
        },
      })
    : [];

  return (
    <Panel title="Projects, sites, and origins" subtitle="Current active projects and monitored site origins across every workspace membership.">
      {projects.length ? (
        <div className="hq-list">
          {projects.map((project) => (
            <div key={project.id} className="hq-listRow">
              <div>
                <div className="hq-listLabel">{project.name || project.slug}</div>
                <div className="hq-listMeta">
                  {project.sites.length} sites · {project.sites.map((site) => site.origin).join(" · ") || "No active site origins"}
                </div>
              </div>
              <Badge tone="watch">{formatDate(project.updatedAt)}</Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="hq-helperText">No active projects or sites are attached to this client yet.</p>
      )}
    </Panel>
  );
}

async function ClientUsagePanel(props: {
  userId: string;
  accountIds: string[];
}) {
  const [sessions, messages, securityEvents, accountStorageMap, userStorageActivityMap] = await Promise.all([
    prisma.cavAiSession.count({ where: { userId: props.userId } }),
    prisma.cavAiMessage.count({ where: { session: { userId: props.userId } } }),
    prisma.adminEvent.groupBy({
      by: ["name"],
      where: {
        actorUserId: props.userId,
        name: { in: ["cavverify_rendered", "cavguard_rendered"] },
      },
      _count: { _all: true },
    }),
    getAccountStorageMap(props.accountIds),
    getUserStorageActivityMap([props.userId]),
  ]);

  const securityEventMap = new Map(securityEvents.map((row) => [row.name, row._count._all]));
  const attachedStorage = sumAccountStorageSummaries(
    props.accountIds
      .map((accountId) => accountStorageMap.get(accountId))
      .filter((value): value is NonNullable<typeof value> => Boolean(value)),
  );
  const userStorageActivity = userStorageActivityMap.get(props.userId) || {
    userId: props.userId,
    uploadedFiles: 0,
    deletedFiles: 0,
  };

  return (
    <Panel title="Usage" subtitle="Session, message, and security usage attributed to this client.">
      <KeyValueGrid
        items={[
          { label: "Sessions", value: formatInt(sessions) },
          { label: "Messages", value: formatInt(messages) },
          { label: "CavCloud storage", value: `${formatInt(attachedStorage.cloudFiles)} files · ${formatBytes(attachedStorage.cloudBytes)}` },
          { label: "CavSafe storage", value: `${formatInt(attachedStorage.safeFiles)} files · ${formatBytes(attachedStorage.safeBytes)}` },
          { label: "Uploaded files", value: formatInt(userStorageActivity.uploadedFiles) },
          { label: "Deleted files", value: formatInt(userStorageActivity.deletedFiles) },
          { label: "Caverify renders", value: formatInt(securityEventMap.get("cavverify_rendered") || 0) },
          { label: "CavGuard renders", value: formatInt(securityEventMap.get("cavguard_rendered") || 0) },
        ]}
      />
    </Panel>
  );
}

async function ClientRecentSessionsPanel(props: {
  userId: string;
}) {
  const recentSessions = await prisma.cavAiSession.findMany({
    where: { userId: props.userId },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: {
      id: true,
      surface: true,
      title: true,
      contextLabel: true,
      updatedAt: true,
    },
  });

  return (
    <Panel title="Recent sessions" subtitle="Latest persisted CavBot session surfaces for this client.">
      {recentSessions.length ? (
        <div className="hq-list">
          {recentSessions.map((session) => (
            <div key={session.id} className="hq-listRow">
              <div>
                <div className="hq-listLabel">{session.title}</div>
                <div className="hq-listMeta">{session.surface} · {session.contextLabel || "No context label"}</div>
              </div>
              <Badge tone="watch">{formatDateTime(session.updatedAt)}</Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="hq-helperText">No persisted CavBot sessions are attached to this client yet.</p>
      )}
    </Panel>
  );
}

async function ClientNoticesPanel(props: {
  accountIds: string[];
}) {
  const notices = props.accountIds.length
    ? await prisma.workspaceNotice.findMany({
        where: { accountId: { in: props.accountIds } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          title: true,
          tone: true,
          createdAt: true,
        },
      })
    : [];

  return (
    <Panel title="Alerts and notices" subtitle="Recent workspace notices attached to any of this user’s accounts.">
      {notices.length ? (
        <div className="hq-list">
          {notices.map((notice) => (
            <div key={notice.id} className="hq-listRow">
              <div>
                <div className="hq-listLabel">{notice.title}</div>
                <div className="hq-listMeta">{formatDateTime(notice.createdAt)}</div>
              </div>
              <Badge tone={notice.tone === "GOOD" ? "good" : notice.tone === "WATCH" ? "watch" : "bad"}>{notice.tone}</Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="hq-helperText">No recent workspace notices are attached to this client.</p>
      )}
    </Panel>
  );
}

async function ClientInternalActivityPanel(props: {
  userId: string;
  includeAdminAudit: boolean;
}) {
  const [notifications, adminAudit, accountAudit] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: props.userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        kind: true,
        tone: true,
        createdAt: true,
        readAt: true,
      },
    }),
    props.includeAdminAudit
      ? prisma.adminAuditLog.findMany({
          where: { actorUserId: props.userId },
          orderBy: { createdAt: "desc" },
          take: 8,
          select: {
            id: true,
            action: true,
            actionLabel: true,
            severity: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    prisma.auditLog.findMany({
      where: { operatorUserId: props.userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        actionLabel: true,
        category: true,
        severity: true,
        createdAt: true,
        account: {
          select: { id: true },
        },
      },
    }),
  ]);

  const auditAccountIds = Array.from(new Set(
    accountAudit
      .map((entry) => entry.account?.id)
      .filter((value): value is string => Boolean(value)),
  ));
  const accountOwners = auditAccountIds.length ? await getAccountOwners(auditAccountIds) : new Map();

  return (
    <Panel title="Internal activity" subtitle="Latest client-side notifications and relevant audit trail entries.">
      {notifications.length || adminAudit.length || accountAudit.length ? (
        <div className="hq-list">
          {notifications.map((notification) => (
            <div key={notification.id} className="hq-listRow">
              <div>
                <div className="hq-listLabel">{notification.title}</div>
                <div className="hq-listMeta">{notification.kind} · {formatDateTime(notification.createdAt)}</div>
              </div>
              <Badge tone={notification.tone === "GOOD" ? "good" : notification.tone === "WATCH" ? "watch" : "bad"}>
                {notification.readAt ? "Read" : "Unread"}
              </Badge>
            </div>
          ))}
          {adminAudit.map((entry) => (
            <div key={entry.id} className="hq-listRow">
              <div>
                <div className="hq-listLabel">{entry.actionLabel}</div>
                <div className="hq-listMeta">{formatDateTime(entry.createdAt)}</div>
              </div>
              <Badge tone={entry.severity === "destructive" ? "bad" : entry.severity === "warning" ? "watch" : "good"}>{entry.action}</Badge>
            </div>
          ))}
          {accountAudit.map((entry) => (
            <div key={entry.id} className="hq-listRow">
              <div>
                <div className="hq-listLabel">{entry.actionLabel}</div>
                <div className="hq-listMeta">
                  {entry.account ? formatUserHandle(accountOwners.get(entry.account.id), "No owner") : "No owner"} · {formatDateTime(entry.createdAt)}
                </div>
              </div>
              <Badge tone={entry.severity === "destructive" ? "bad" : entry.severity === "warning" ? "watch" : "good"}>{entry.category}</Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="hq-helperText">No recent notifications or audit activity are attached to this client.</p>
      )}
    </Panel>
  );
}

export default async function ClientDetailPage({ params }: { params: { userId: string } }) {
  await requireAdminAccessFromRequestContext(`/clients/${params.userId}`, { scopes: ["customers.read"] });

  const detail = await getClientDetailBase(params.userId);
  if (!detail) notFound();

  const { user, accountIds, resolvedMemberships, memberCountMap, siteCountMap } = detail;
  const primaryPlanDisplay = resolveMembershipPlanDisplay(resolvedMemberships[0], new Date());
  return (
    <AdminPage
      title={user.displayName || user.fullName || user.username || user.email}
      subtitle="Client operator dossier covering identity, workspace membership, plan status, platform usage, security load, notices, and internal activity."
      actions={(
        <Link href={`/clients/${params.userId}/manage`} className="hq-buttonGhost">
          Manage
        </Link>
      )}
      chips={
        <>
          <Badge tone={primaryPlanDisplay.isTrialing ? "watch" : "good"}>{primaryPlanDisplay.planLabel}</Badge>
          {user.staffProfile ? <Badge tone="good">Staff-linked user</Badge> : null}
        </>
      }
    >
      <section className="hq-detailGrid">
        <div className="hq-stack">
          <Panel title="Overview" subtitle="Identity, contact, membership, and lifecycle state.">
            <div className="hq-inlineStart">
              <AvatarBadge name={user.displayName || user.fullName || user.username || user.email} email={user.email} image={user.avatarImage} tone={user.avatarTone} />
              <div>
                <div className="hq-cardTitle">{user.displayName || user.fullName || user.username || user.email}</div>
                <p className="hq-sectionLead">{user.email}</p>
              </div>
            </div>
            <div style={{ height: 16 }} />
            <KeyValueGrid
              items={[
                { label: "Username", value: user.username ? `@${user.username}` : "Not set" },
                { label: "Joined", value: formatDateTime(user.createdAt) },
                { label: "Last active", value: formatDateTime(user.lastLoginAt) },
                { label: "Email verified", value: formatDateTime(user.emailVerifiedAt) },
                { label: "Company", value: user.companyName || "Not provided" },
                { label: "Location", value: [user.country, user.region, user.timeZone].filter(Boolean).join(" · ") || "Not provided" },
                { label: "Bio", value: user.bio || "No profile bio saved" },
                { label: "Company category", value: [user.companyCategory, user.companySubcategory].filter(Boolean).join(" · ") || "Uncategorized" },
              ]}
            />
          </Panel>

          <Panel title="Workspace membership" subtitle="All account relationships, tiers, plan status, and workspace footprint.">
            <div className="hq-tableWrap">
              <table className="hq-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Role</th>
                    <th>Tier</th>
                    <th>Subscription</th>
                    <th>Sites</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {resolvedMemberships.map((membership) => {
                    const owner = membership.account.members[0]?.user || null;
                    const latestSub = membership.account.subscriptions[0] || null;
                    const planDisplay = resolveMembershipPlanDisplay(membership, new Date());
                    const trialEndsAt = membership.account.trialEndsAt || latestSub?.currentPeriodEnd || null;
                    return (
                      <tr key={membership.account.id}>
                        <td>
                          <strong><Link href={`/accounts/${membership.account.id}`}>{formatUserHandle(owner, membership.account.name)}</Link></strong>
                          <span>{formatUserName(owner, membership.account.billingEmail || "No billing email")}</span>
                        </td>
                        <td>
                          <strong>{membership.role}</strong>
                          <span>{membership.account.billingEmail || "No billing email"}</span>
                        </td>
                        <td>
                          <strong>{planDisplay.planLabel}</strong>
                          <span>{planDisplay.isTrialing && trialEndsAt ? `Trial until ${formatDate(trialEndsAt)}` : "No active trial"}</span>
                        </td>
                        <td>
                          <strong>{formatAdminSubscriptionLabel({
                            status: latestSub?.status,
                            tier: membership.account.tier,
                            subscriptionTier: latestSub?.tier,
                            currentPeriodEnd: latestSub?.currentPeriodEnd,
                            trialSeatActive: membership.account.trialSeatActive,
                            trialEndsAt: membership.account.trialEndsAt,
                          })}</strong>
                          <span>{latestSub?.currentPeriodEnd ? `Renews ${formatDate(latestSub.currentPeriodEnd)}` : "No renewal date"}</span>
                        </td>
                        <td>
                          <strong>{formatInt(siteCountMap.get(membership.account.id) || 0)}</strong>
                          <span>{formatInt(memberCountMap.get(membership.account.id) || 0)} members</span>
                        </td>
                        <td>
                          <strong>{formatDate(membership.createdAt)}</strong>
                          <span>Membership created</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Suspense fallback={<DetailPanelFallback title="Projects, sites, and origins" subtitle="Current active projects and monitored site origins across every workspace membership." message="Loading current project inventory…" />}>
            <ClientProjectsPanel accountIds={accountIds} />
          </Suspense>
        </div>

        <div className="hq-stack">
          {user.staffProfile ? (
            <Panel title="Staff linkage" subtitle="Separate staff authorization record for this CavBot account.">
              <KeyValueGrid
                items={[
                  { label: "Masked staff ID", value: `•••• ${user.staffProfile.staffCode.slice(-4)}` },
                  { label: "System role", value: formatStaffSystemRoleLabel(user.staffProfile.systemRole) },
                  { label: "Position", value: user.staffProfile.positionTitle },
                  { label: "Status", value: formatStaffStatusLabel(user.staffProfile.status, user.staffProfile.metadataJson) },
                  { label: "Onboarding", value: formatStaffStatusLabel(user.staffProfile.onboardingStatus) },
                  { label: "Last admin login", value: formatDateTime(user.staffProfile.lastAdminLoginAt) },
                ]}
              />
            </Panel>
          ) : null}

          <Suspense fallback={<DetailPanelFallback title="Usage" subtitle="Session, message, and security usage attributed to this client." message="Loading usage totals…" />}>
            <ClientUsagePanel userId={user.id} accountIds={accountIds} />
          </Suspense>

          <Suspense fallback={<DetailPanelFallback title="Recent sessions" subtitle="Latest persisted CavBot session surfaces for this client." message="Loading recent sessions…" />}>
            <ClientRecentSessionsPanel userId={user.id} />
          </Suspense>

          <Suspense fallback={<DetailPanelFallback title="Alerts and notices" subtitle="Recent workspace notices attached to any of this user’s accounts." message="Loading workspace notices…" />}>
            <ClientNoticesPanel accountIds={accountIds} />
          </Suspense>

          <Suspense fallback={<DetailPanelFallback title="Internal activity" subtitle="Latest client-side notifications and relevant audit trail entries." message="Loading internal activity…" />}>
            <ClientInternalActivityPanel userId={user.id} includeAdminAudit={Boolean(user.staffProfile)} />
          </Suspense>
        </div>
      </section>
    </AdminPage>
  );
}
