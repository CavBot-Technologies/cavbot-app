import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";

import {
  AdminPage,
  Badge,
  KeyValueGrid,
  Panel,
} from "@/components/admin/AdminPrimitives";
import { AdminSignupMethodInline } from "@/components/admin/AdminSignupMethodMark";
import {
  formatAdminSubscriptionLabel,
  formatBytes,
  formatDate,
  formatDateTime,
  formatInt,
  formatPercent,
  formatUserHandle,
  formatUserName,
  resolveAdminPlanDisplay,
} from "@/lib/admin/server";
import { formatAdminSignupMethodLabel, resolveAdminSignupMethod } from "@/lib/admin/signupMethod";
import { getAccountStorageMap } from "@/lib/admin/storage";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { buildCanonicalPublicProfileHref } from "@/lib/publicProfile/url";
import { getQwenCoderPopoverState } from "@/src/lib/ai/qwen-coder-credits.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AccountDetailRecord = {
  id: string;
  name: string;
  slug: string;
  tier: string;
  billingEmail: string | null;
  stripeCustomerId: string | null;
  trialSeatActive: boolean | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialEverUsed: boolean | null;
  pendingDowngradePlanId: string | null;
  pendingDowngradeEffectiveAt: Date | null;
  lastUpgradePlanId: string | null;
  lastUpgradeAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  members: Array<{
    id: string;
    role: string;
    createdAt: Date;
    user: {
      id: string;
      email: string;
      username: string | null;
      displayName: string | null;
      fullName: string | null;
      avatarImage: string | null;
      avatarTone: string | null;
      lastLoginAt: Date | null;
      oauthIdentities: Array<{
        provider: string;
        createdAt: Date;
      }>;
    };
  }>;
  projects: Array<{
    id: number;
    name: string | null;
    slug: string;
    region: string;
    updatedAt: Date;
    sites: Array<{
      id: string;
      label: string;
      origin: string;
      status: string;
    }>;
  }>;
};

type LatestSubscription = {
  status: string;
  tier: string;
  billingCycle: string | null;
  currentPeriodEnd: Date | null;
} | null;

function resolveAccountOwner(account: AccountDetailRecord) {
  const ownerMembership = account.members.find((member) => member.role === "OWNER") || account.members[0];
  if (!ownerMembership) return null;

  return {
    userId: ownerMembership.user.id,
    email: ownerMembership.user.email,
    username: ownerMembership.user.username,
    displayName: ownerMembership.user.displayName,
    fullName: ownerMembership.user.fullName,
    avatarImage: ownerMembership.user.avatarImage,
    avatarTone: ownerMembership.user.avatarTone,
  };
}

function resolveAccountFootprint(account: AccountDetailRecord) {
  return {
    projects: account.projects.length,
    sites: account.projects.reduce((total, project) => total + project.sites.length, 0),
    members: account.members.length,
  };
}

function AccountDetailAsideSkeleton(props: {
  projectsLabel: string;
  seatsLabel: string;
  sitesLabel: string;
  subscriptionLabel: string;
}) {
  return (
    <div className="hq-stack">
      <Panel title="Plan and usage" subtitle="Commercial health plus platform and security traffic.">
        <div className="hq-kvGrid">
          {[
            { label: "Subscription status", value: props.subscriptionLabel },
            { label: "Billing cycle", value: "Loading" },
            { label: "Current period end", value: "Loading" },
            { label: "Pending downgrade", value: "Loading" },
            { label: "Projects", value: props.projectsLabel },
            { label: "Seats", value: props.seatsLabel },
            { label: "Sites", value: props.sitesLabel },
            { label: "CavCloud storage", value: "Loading" },
            { label: "CavSafe storage", value: "Loading" },
            { label: "Uploaded files", value: "Loading" },
            { label: "Deleted files", value: "Loading" },
            { label: "CavBot sessions", value: "Loading" },
            { label: "CavAI usage", value: "Loading" },
            { label: "Open notices", value: "Loading" },
          ].map((item) => (
            <div key={item.label} className="hq-kvItem">
              <div className="hq-kvLabel">{item.label}</div>
              <div className="hq-kvValue">
                <span className="hq-loadingBar is-value" aria-hidden="true" />
                <span className="hq-srOnly">{item.value}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Alerts and incidents" subtitle="Recent workspace notices and active or recent incidents relevant to operators.">
        <div className="hq-loadingList">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={`alerts-${index}`} className="hq-listRow">
              <div className="hq-loadingStack">
                <span className="hq-loadingBar is-row" aria-hidden="true" />
                <span className="hq-loadingBar is-meta" aria-hidden="true" />
              </div>
              <span className="hq-loadingBar is-chip" aria-hidden="true" />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Recent scans" subtitle="Latest scan jobs across projects in this workspace.">
        <div className="hq-loadingList">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={`scans-${index}`} className="hq-listRow">
              <div className="hq-loadingStack">
                <span className="hq-loadingBar is-row" aria-hidden="true" />
                <span className="hq-loadingBar is-metaWide" aria-hidden="true" />
              </div>
              <span className="hq-loadingBar is-chip" aria-hidden="true" />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

async function AccountDetailAside(props: {
  accountId: string;
  ownerUserId: string | null;
  accountUsagePlanId: PlanId;
  accountTier: string;
  trialSeatActive: boolean | null;
  trialEndsAt: Date | null;
  subscription: LatestSubscription;
  footprint: {
    projects: number;
    members: number;
    sites: number;
  };
  pendingDowngradePlanId: string | null;
  pendingDowngradeEffectiveAt: Date | null;
}) {
  const [sessionCount, notices, incidents, scans, cavaiUsage, storageMap] = await Promise.all([
    prisma.cavAiSession.count({ where: { accountId: props.accountId } }),
    prisma.workspaceNotice.findMany({
      where: { accountId: props.accountId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        tone: true,
        createdAt: true,
      },
    }),
    prisma.incident.findMany({
      orderBy: { startedAt: "desc" },
      take: 6,
      select: {
        id: true,
        title: true,
        status: true,
        impact: true,
        startedAt: true,
      },
    }),
    prisma.scanJob.findMany({
      where: { project: { accountId: props.accountId } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        status: true,
        pagesScanned: true,
        issuesFound: true,
        overallScore: true,
        createdAt: true,
        site: {
          select: {
            label: true,
            origin: true,
          },
        },
      },
    }),
    props.ownerUserId
      ? getQwenCoderPopoverState({
          accountId: props.accountId,
          userId: props.ownerUserId,
          planId: props.accountUsagePlanId,
        })
      : Promise.resolve(null),
    getAccountStorageMap([props.accountId]),
  ]);
  const storage = storageMap.get(props.accountId) || {
    accountId: props.accountId,
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
  };

  return (
    <div className="hq-stack">
      <Panel title="Plan and usage" subtitle="Commercial health plus platform and security traffic.">
        <KeyValueGrid
          items={[
            {
              label: "Subscription status",
              value: formatAdminSubscriptionLabel({
                status: props.subscription?.status,
                tier: props.accountTier,
                subscriptionTier: props.subscription?.tier,
                currentPeriodEnd: props.subscription?.currentPeriodEnd,
                trialSeatActive: props.trialSeatActive,
                trialEndsAt: props.trialEndsAt,
              }),
            },
            { label: "Billing cycle", value: props.subscription?.billingCycle || "—" },
            { label: "Current period end", value: formatDate(props.subscription?.currentPeriodEnd) },
            {
              label: "Pending downgrade",
              value: props.pendingDowngradePlanId
                ? `${props.pendingDowngradePlanId} on ${formatDate(props.pendingDowngradeEffectiveAt)}`
                : "None scheduled",
            },
            { label: "Projects", value: formatInt(props.footprint.projects) },
            { label: "Seats", value: formatInt(props.footprint.members) },
            { label: "Sites", value: formatInt(props.footprint.sites) },
            { label: "CavCloud storage", value: `${formatInt(storage.cloudFiles)} files · ${formatBytes(storage.cloudBytes)}` },
            { label: "CavSafe storage", value: `${formatInt(storage.safeFiles)} files · ${formatBytes(storage.safeBytes)}` },
            { label: "Uploaded files", value: formatInt(storage.uploadedFiles) },
            { label: "Deleted files", value: formatInt(storage.deletedFiles) },
            { label: "CavBot sessions", value: formatInt(sessionCount) },
            { label: "CavAI usage", value: cavaiUsage ? formatPercent(cavaiUsage.usage.percentUsed, 0) : "Not available" },
            { label: "Open notices", value: formatInt(notices.length) },
          ]}
        />
      </Panel>

      <Panel title="Alerts and incidents" subtitle="Recent workspace notices and active or recent incidents relevant to operators.">
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
          {incidents.map((incident) => (
            <div key={incident.id} className="hq-listRow">
              <div>
                <div className="hq-listLabel">{incident.title}</div>
                <div className="hq-listMeta">{formatDateTime(incident.startedAt)}</div>
              </div>
              <Badge tone={incident.status === "RESOLVED" ? "good" : "bad"}>{incident.status}</Badge>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Recent scans" subtitle="Latest scan jobs across projects in this workspace.">
        <div className="hq-list">
          {scans.map((scan) => (
            <div key={scan.id} className="hq-listRow">
              <div>
                <div className="hq-listLabel">{scan.site.label}</div>
                <div className="hq-listMeta">
                  {scan.site.origin} · {formatInt(scan.pagesScanned || 0)} pages · {formatInt(scan.issuesFound || 0)} issues
                </div>
              </div>
              <Badge tone={scan.status === "FAILED" ? "bad" : scan.status === "RUNNING" ? "watch" : "good"}>
                {scan.status}
              </Badge>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export default async function AccountDetailPage({ params }: { params: { accountId: string } }) {
  await requireAdminAccessFromRequestContext(`/accounts/${params.accountId}`, { scopes: ["accounts.read"] });

  const [account, subscription, accountCreatedAudit] = await Promise.all([
    prisma.account.findUnique({
      where: { id: params.accountId },
      select: {
        id: true,
        name: true,
        slug: true,
        tier: true,
        billingEmail: true,
        stripeCustomerId: true,
        trialSeatActive: true,
        trialStartedAt: true,
        trialEndsAt: true,
        trialEverUsed: true,
        pendingDowngradePlanId: true,
        pendingDowngradeEffectiveAt: true,
        lastUpgradePlanId: true,
        lastUpgradeAt: true,
        createdAt: true,
        updatedAt: true,
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
                fullName: true,
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
              },
            },
          },
        },
        projects: {
          where: { isActive: true },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            name: true,
            slug: true,
            region: true,
            updatedAt: true,
            sites: {
              where: { isActive: true },
              select: {
                id: true,
                label: true,
                origin: true,
                status: true,
              },
            },
          },
        },
      },
    }),
    prisma.subscription.findFirst({
      where: { accountId: params.accountId },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        tier: true,
        billingCycle: true,
        currentPeriodEnd: true,
      },
    }),
    prisma.auditLog.findFirst({
      where: {
        accountId: params.accountId,
        action: "ACCOUNT_CREATED",
      },
      orderBy: { createdAt: "asc" },
      select: {
        metaJson: true,
      },
    }),
  ]);

  if (!account) notFound();

  const owner = resolveAccountOwner(account);
  const ownerMembership = account.members.find((member) => member.role === "OWNER") || account.members[0] || null;
  const footprint = resolveAccountFootprint(account);
  const publicProfileHref = owner?.username ? buildCanonicalPublicProfileHref(owner.username) : "";
  const signupMethod = resolveAdminSignupMethod({
    accountCreatedMeta: accountCreatedAudit?.metaJson,
    identities: ownerMembership?.user.oauthIdentities || [],
  });
  const signupMethodLabel = formatAdminSignupMethodLabel(signupMethod);
  const planDisplay = resolveAdminPlanDisplay({
    tier: account.tier,
    status: subscription?.status,
    subscriptionTier: subscription?.tier,
    currentPeriodEnd: subscription?.currentPeriodEnd,
    trialSeatActive: account.trialSeatActive,
    trialEndsAt: account.trialEndsAt,
  });
  const accountUsagePlanId = planDisplay.planId;
  const { planLabel } = planDisplay;
  const subscriptionLabel = formatAdminSubscriptionLabel({
    status: subscription?.status,
    tier: account.tier,
    subscriptionTier: subscription?.tier,
    currentPeriodEnd: subscription?.currentPeriodEnd,
    trialSeatActive: account.trialSeatActive,
    trialEndsAt: account.trialEndsAt,
  });
  return (
    <AdminPage
      title={`${formatUserName(owner, account.name)}'s Dossier`}
      subtitle="Full account dossier with workspace ownership, plan state, seat usage, project/site inventory, notices, scans, and security traffic."
      actions={(
        <Link href={`/accounts/${params.accountId}/manage`} className="hq-buttonGhost">
          Manage
        </Link>
      )}
      chips={
        <>
          <Badge tone={planDisplay.isTrialing ? "watch" : "good"}>{planLabel}</Badge>
          {subscriptionLabel !== planLabel ? (
            <Badge tone={subscription?.status === "PAST_DUE" ? "bad" : planDisplay.isTrialing ? "watch" : "good"}>
              {subscriptionLabel}
            </Badge>
          ) : null}
        </>
      }
    >
      <section className="hq-detailGrid">
        <div className="hq-stack">
          <Panel title="Account overview" subtitle="Workspace identity, billing posture, and lifecycle context.">
            <KeyValueGrid
              items={[
                { label: "Owner handle", value: formatUserHandle(owner) },
                { label: "Owner", value: formatUserName(owner) },
                { label: "Plan", value: planLabel },
                {
                  label: "Signup method",
                  value: <AdminSignupMethodInline method={signupMethod} label={signupMethodLabel} />,
                },
                {
                  label: "Profile URL",
                  value: publicProfileHref ? <Link href={publicProfileHref}>{publicProfileHref}</Link> : "Not available",
                },
                { label: "Billing email", value: account.billingEmail || "Not set" },
                { label: "Created", value: formatDateTime(account.createdAt) },
                { label: "Updated", value: formatDateTime(account.updatedAt) },
                { label: "Stripe client", value: account.stripeCustomerId || "Not attached" },
                {
                  label: "Trial",
                  value: planDisplay.isTrialing
                    ? `Active until ${formatDate(account.trialEndsAt || subscription?.currentPeriodEnd)}`
                    : account.trialEverUsed
                      ? "Used previously"
                      : "Never started",
                },
                {
                  label: "Upgrade path",
                  value: account.lastUpgradePlanId
                    ? `${account.lastUpgradePlanId} on ${formatDate(account.lastUpgradeAt)}`
                    : "No prior upgrade recorded",
                },
              ]}
            />
          </Panel>

          <Panel title="Projects and sites" subtitle="Active project inventory across the workspace.">
            <div className="hq-tableWrap">
              <table className="hq-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Region</th>
                    <th>Sites</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {account.projects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <strong>{project.name || project.slug}</strong>
                        <span>{project.slug}</span>
                      </td>
                      <td>
                        <strong>{project.region}</strong>
                        <span>{project.sites.length} active sites</span>
                      </td>
                      <td>
                        <strong>{project.sites.map((site) => site.label).join(", ") || "No sites"}</strong>
                        <span>{project.sites.map((site) => site.origin).join(" · ")}</span>
                      </td>
                      <td>
                        <strong>{formatDate(project.updatedAt)}</strong>
                        <span>Last project update</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Members" subtitle="Workspace seats, owner/admin/member roles, and recent last-login activity.">
            <div className="hq-tableWrap">
              <table className="hq-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Last active</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {account.members.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <strong><Link href={`/clients/${member.user.id}`}>{member.user.displayName || member.user.fullName || member.user.username || member.user.email}</Link></strong>
                        <span>{member.user.email}</span>
                      </td>
                      <td>
                        <strong>{member.role}</strong>
                        <span>{member.user.username ? `@${member.user.username}` : "No username"}</span>
                      </td>
                      <td>
                        <strong>{formatDateTime(member.user.lastLoginAt)}</strong>
                        <span>Most recent login</span>
                      </td>
                      <td>
                        <strong>{formatDate(member.createdAt)}</strong>
                        <span>Membership created</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <Suspense
          fallback={(
            <AccountDetailAsideSkeleton
              projectsLabel={formatInt(footprint.projects)}
              seatsLabel={formatInt(footprint.members)}
              sitesLabel={formatInt(footprint.sites)}
              subscriptionLabel={subscriptionLabel}
            />
          )}
        >
          <AccountDetailAside
            accountId={account.id}
            ownerUserId={owner?.userId || null}
            accountUsagePlanId={accountUsagePlanId}
            accountTier={account.tier}
            trialSeatActive={account.trialSeatActive}
            trialEndsAt={account.trialEndsAt}
            subscription={subscription}
            footprint={footprint}
            pendingDowngradePlanId={account.pendingDowngradePlanId}
            pendingDowngradeEffectiveAt={account.pendingDowngradeEffectiveAt}
          />
        </Suspense>
      </section>
    </AdminPage>
  );
}
