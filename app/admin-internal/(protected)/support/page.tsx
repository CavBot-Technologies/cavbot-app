import Link from "next/link";

import { AdminPage, Badge, MetricCard, Panel } from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import { formatDateTime, formatInt, formatUserHandle, futureDate, getAccountOwners, parseAdminMonth, parseAdminRange, resolveAdminWindow } from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SupportPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/support", { scopes: ["support.read"] });

  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range);
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const trialEscalationAt = futureDate(3);
  const [pastDueAccounts, pendingWorkspaceAccess, pendingInvites, unreadBadNotifications, unresolvedNotices, staleTrials] = await Promise.all([
    prisma.account.findMany({
      where: {
        subscriptions: {
          some: { status: "PAST_DUE" },
        },
      },
      select: {
        id: true,
        name: true,
        tier: true,
      },
    }),
    prisma.workspaceAccessRequest.findMany({
      where: { status: "PENDING", createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        createdAt: true,
        account: { select: { id: true, name: true } },
        requesterUser: { select: { email: true, displayName: true } },
      },
    }),
    prisma.invite.findMany({
      where: { status: "PENDING", createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        expiresAt: true,
        account: { select: { id: true, name: true } },
      },
    }),
    prisma.notification.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        readAt: null,
        tone: { in: ["WATCH", "BAD"] },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        title: true,
        tone: true,
        kind: true,
        createdAt: true,
        user: { select: { email: true, displayName: true } },
        account: { select: { id: true, name: true } },
      },
    }),
    prisma.workspaceNotice.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        dismissedAt: null,
        tone: { in: ["WATCH", "BAD"] },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        title: true,
        tone: true,
        createdAt: true,
        account: { select: { id: true, name: true } },
      },
    }),
    prisma.account.findMany({
      where: {
        trialSeatActive: true,
        trialEndsAt: { lt: trialEscalationAt },
      },
      orderBy: { trialEndsAt: "asc" },
      take: 12,
      select: {
        id: true,
        name: true,
        tier: true,
        trialEndsAt: true,
      },
    }),
  ]);
  const notificationAccountIds = unreadBadNotifications
    .map((notification) => notification.account?.id)
    .filter((value): value is string => Boolean(value));
  const accountIds = Array.from(
    new Set([
      ...pastDueAccounts.map((account) => account.id),
      ...pendingWorkspaceAccess.map((request) => request.account.id),
      ...pendingInvites.map((invite) => invite.account.id),
      ...notificationAccountIds,
      ...unresolvedNotices.map((notice) => notice.account.id),
      ...staleTrials.map((account) => account.id),
    ]),
  );
  const accountOwners = await getAccountOwners(accountIds);

  return (
    <AdminPage
      title="Intervention"
      subtitle="Operator intervention workload derived from the current CavBot dataset: payment risk, access requests, pending invites, high-tone notifications, unresolved notices, and expiring trials."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Payment risk" value={formatInt(pastDueAccounts.length)} meta="Accounts requiring billing intervention" />
        <MetricCard label="Access requests" value={formatInt(pendingWorkspaceAccess.length)} meta={`Pending workspace membership review in ${rangeLabel}`} />
        <MetricCard label="Member invites" value={formatInt(pendingInvites.length)} meta={`Pending workspace invite action in ${rangeLabel}`} />
        <MetricCard label="Unread notifications" value={formatInt(unreadBadNotifications.length)} meta={`Unread WATCH/BAD client notifications in ${rangeLabel}`} />
        <MetricCard label="Unresolved notices" value={formatInt(unresolvedNotices.length)} meta={`WATCH/BAD workspace notices in ${rangeLabel}`} />
        <MetricCard label="Trials expiring" value={formatInt(staleTrials.length)} meta="Trial workspaces within three days of expiration" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel title="Accounts needing intervention" subtitle="Past-due workspaces and trials about to expire.">
          <div className="hq-list">
            {pastDueAccounts.map((account) => (
              <div key={account.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel"><Link href={`/accounts/${account.id}`}>{formatUserHandle(accountOwners.get(account.id))}</Link></div>
                  <div className="hq-listMeta">{account.tier} · Payment intervention required</div>
                </div>
                <Badge tone="bad">PAST_DUE</Badge>
              </div>
            ))}
            {staleTrials.map((account) => (
              <div key={account.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel"><Link href={`/accounts/${account.id}`}>{formatUserHandle(accountOwners.get(account.id))}</Link></div>
                  <div className="hq-listMeta">Trial ends {formatDateTime(account.trialEndsAt)}</div>
                </div>
                <Badge tone="watch">TRIAL</Badge>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Pending requests and invites" subtitle="Client onboarding and workspace access queue.">
          <div className="hq-list">
            {pendingWorkspaceAccess.map((request) => (
              <div key={request.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{request.requesterUser.displayName || request.requesterUser.email}</div>
                  <div className="hq-listMeta">
                    <Link href={`/accounts/${request.account.id}`}>{formatUserHandle(accountOwners.get(request.account.id))}</Link> · {formatDateTime(request.createdAt)}
                  </div>
                </div>
                <Badge tone="watch">ACCESS</Badge>
              </div>
            ))}
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{invite.email}</div>
                  <div className="hq-listMeta">
                    <Link href={`/accounts/${invite.account.id}`}>{formatUserHandle(accountOwners.get(invite.account.id))}</Link> · {invite.role} · expires {formatDateTime(invite.expiresAt)}
                  </div>
                </div>
                <Badge tone="watch">INVITE</Badge>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel title="Unread client signals" subtitle="Unread client-facing notifications in WATCH or BAD tone.">
          <div className="hq-list">
            {unreadBadNotifications.map((notification) => (
              <div key={notification.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{notification.title}</div>
                  <div className="hq-listMeta">
                    {notification.user.displayName || notification.user.email} · {notification.account ? formatUserHandle(accountOwners.get(notification.account.id)) : "No account"} · {notification.kind}
                  </div>
                </div>
                <Badge tone={notification.tone === "BAD" ? "bad" : "watch"}>{notification.tone}</Badge>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Unresolved workspace notices" subtitle="High-tone notices that may require client success intervention.">
          <div className="hq-list">
            {unresolvedNotices.map((notice) => (
              <div key={notice.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{notice.title}</div>
                  <div className="hq-listMeta">
                    <Link href={`/accounts/${notice.account.id}`}>{formatUserHandle(accountOwners.get(notice.account.id))}</Link> · {formatDateTime(notice.createdAt)}
                  </div>
                </div>
                <Badge tone={notice.tone === "BAD" ? "bad" : "watch"}>{notice.tone}</Badge>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </AdminPage>
  );
}
