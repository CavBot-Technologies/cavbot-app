import Link from "next/link";

import {
  AdminPage,
  Badge,
  MetricCard,
  PaginationNav,
  Panel,
  TrendChart,
} from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
  buildAdminTrendPoints,
  formatDateTime,
  formatInt,
  formatUserHandle,
  formatUserName,
  getAccountOwners,
  offsetForPage,
  pageCount,
  parseAdminMonth,
  parseAdminRange,
  parsePage,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function s(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function pickFirstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function buildSessionUserIdentity(args: {
  user:
    | {
        email: string | null;
        username: string | null;
        displayName: string | null;
      }
    | undefined;
  accountOwner:
    | {
        email: string;
        username: string | null;
        displayName: string | null;
        fullName: string | null;
      }
    | undefined;
  signupEmail: string | null | undefined;
  oauthEmail: string | null | undefined;
}) {
  const email = pickFirstNonEmpty(args.user?.email, args.signupEmail, args.oauthEmail, args.accountOwner?.email) || null;
  const username = pickFirstNonEmpty(args.user?.username, args.accountOwner?.username) || null;
  const primary =
    formatUserName(
      {
        fullName: args.accountOwner?.fullName || null,
        displayName: args.user?.displayName || args.accountOwner?.displayName || null,
        email,
      },
      "",
    )
    || (username ? `@${username}` : "")
    || "Archived session actor";

  return {
    primary,
    secondary: email || "No email captured",
    username,
    email,
  };
}

function buildSessionAccountIdentity(args: {
  account:
    | {
        id: string;
        name: string;
        slug: string;
        tier: string;
      }
    | undefined;
  accountOwner:
    | {
        email: string;
        username: string | null;
        displayName: string | null;
        fullName: string | null;
      }
    | undefined;
  userIdentity: {
    primary: string;
    username: string | null;
    email: string | null;
  };
  projectId: number | null;
}) {
  const fallbackHandleSource = args.userIdentity.username || args.userIdentity.email
    ? {
        username: args.userIdentity.username,
        email: args.userIdentity.email,
        displayName: args.userIdentity.primary,
      }
    : null;

  const label = args.account
    ? formatUserHandle(args.accountOwner, args.account.name || "Archived workspace")
    : formatUserHandle(fallbackHandleSource, "Archived workspace");

  return {
    label,
    meta: args.account?.tier || (args.projectId ? "Legacy project context" : "No workspace record"),
  };
}

export default async function SessionsPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/sessions", { scopes: ["sessions.read"] });

  const q = s(props.searchParams?.q).trim();
  const surface = s(props.searchParams?.surface).trim();
  const accountId = s(props.searchParams?.accountId).trim();
  const range = parseAdminRange(s(props.searchParams?.range), "30d");
  const month = parseAdminMonth(s(props.searchParams?.month));
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const page = parsePage(s(props.searchParams?.page), 1);
  const start24h = resolveAdminWindow("24h").start;
  const start = window.start;
  const end = window.end;

  const where = {
    AND: [
      { createdAt: { gte: start, lt: end } },
      q
        ? {
            OR: [
              { id: { contains: q, mode: "insensitive" as const } },
              { title: { contains: q, mode: "insensitive" as const } },
              { contextLabel: { contains: q, mode: "insensitive" as const } },
              { origin: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {},
      surface ? { surface } : {},
      accountId ? { accountId } : {},
    ],
  };

  const [accounts, totalSessions, recent24h, recentInWindow, monitoredSessions, recoveredSessions, filteredSessions, sessions, feedbackRows, sessionTrendRows, observedSignalRows] = await Promise.all([
    prisma.account.findMany({
      orderBy: { name: "asc" },
      take: 40,
      select: { id: true, name: true },
    }),
    prisma.cavAiSession.count(),
    prisma.cavAiSession.count({ where: { createdAt: { gte: start24h } } }),
    prisma.cavAiSession.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.adminEvent.count({ where: { name: "cavbot_session_observed", createdAt: { gte: start, lt: end } } }),
    prisma.adminEvent.count({ where: { name: "cavbot_session_recovered", createdAt: { gte: start, lt: end } } }),
    prisma.cavAiSession.count({ where }),
    prisma.cavAiSession.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: offsetForPage(page, PAGE_SIZE),
      take: PAGE_SIZE,
      select: {
        id: true,
        userId: true,
        accountId: true,
        projectId: true,
        surface: true,
        title: true,
        contextLabel: true,
        origin: true,
        createdAt: true,
        updatedAt: true,
        lastMessageAt: true,
      },
    }),
    prisma.cavAiMessageFeedback.findMany({
      where: {
        updatedAt: { gte: start, lt: end },
      },
      select: {
        sessionId: true,
        reaction: true,
        retryCount: true,
      },
    }),
    prisma.cavAiSession.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
    prisma.adminEvent.findMany({
      where: {
        name: "cavbot_session_observed",
        createdAt: { gte: start, lt: end },
      },
      select: { createdAt: true },
    }),
  ]);

  const totalPages = pageCount(filteredSessions, PAGE_SIZE);
  const sessionIds = sessions.map((session) => session.id);
  const userIds = Array.from(new Set(sessions.map((session) => session.userId)));
  const accountIds = Array.from(new Set(sessions.map((session) => session.accountId)));
  const allAccountIds = Array.from(new Set([...accounts.map((account) => account.id), ...accountIds]));

  const [users, accountsMapRows, messageCounts, accountOwners, signupWelcomeRows, oauthIdentityRows] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
          },
        })
      : Promise.resolve([]),
    accountIds.length
      ? prisma.account.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, name: true, slug: true, tier: true },
        })
      : Promise.resolve([]),
    sessionIds.length
      ? prisma.cavAiMessage.groupBy({
          by: ["sessionId"],
          where: { sessionId: { in: sessionIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    getAccountOwners(allAccountIds),
    userIds.length
      ? prisma.signupWelcomeEmail.findMany({
          where: { userId: { in: userIds } },
          select: {
            userId: true,
            email: true,
          },
        })
      : Promise.resolve([]),
    userIds.length
      ? prisma.oAuthIdentity.findMany({
          where: {
            userId: { in: userIds },
            email: { not: null },
          },
          orderBy: { createdAt: "asc" },
          select: {
            userId: true,
            email: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((user) => [user.id, user]));
  const accountMap = new Map(accountsMapRows.map((account) => [account.id, account]));
  const messageMap = new Map(messageCounts.map((row) => [row.sessionId, row._count._all]));
  const signupEmailMap = new Map(signupWelcomeRows.map((row) => [row.userId, row.email]));
  const oauthEmailMap = new Map<string, string>();
  for (const row of oauthIdentityRows) {
    if (!oauthEmailMap.has(row.userId) && row.email) {
      oauthEmailMap.set(row.userId, row.email);
    }
  }
  const riskySessionMap = new Map<string, number>();
  for (const feedback of feedbackRows) {
    const score = (feedback.reaction === "dislike" ? 1 : 0) + Number(feedback.retryCount || 0);
    riskySessionMap.set(feedback.sessionId, (riskySessionMap.get(feedback.sessionId) || 0) + score);
  }

  const rows = sessions.map((session) => {
    const user = userMap.get(session.userId);
    const account = accountMap.get(session.accountId);
    const accountOwner = account ? accountOwners.get(account.id) : undefined;
    const userIdentity = buildSessionUserIdentity({
      user,
      accountOwner,
      signupEmail: signupEmailMap.get(session.userId),
      oauthEmail: oauthEmailMap.get(session.userId),
    });
    const accountIdentity = buildSessionAccountIdentity({
      account,
      accountOwner,
      userIdentity,
      projectId: session.projectId,
    });

    return {
      ...session,
      user,
      account,
      messageCount: messageMap.get(session.id) || 0,
      riskScore: riskySessionMap.get(session.id) || 0,
      userIdentity,
      accountIdentity,
    };
  });
  const sessionTrend = buildAdminTrendPoints(
    sessionTrendRows.map((row) => ({ date: row.createdAt, value: 1 })),
    range,
    month,
  );
  const observedSignalTrend = buildAdminTrendPoints(
    observedSignalRows.map((row) => ({ date: row.createdAt, value: 1 })),
    range,
    month,
  );

  return (
    <AdminPage
      title="Sessions"
      subtitle="Central CavBot session inventory across surfaces, users, accounts, message volume, recovery counts, and risky feedback patterns."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="All sessions" value={formatInt(totalSessions)} meta={`${formatInt(recentInWindow)} created in ${rangeLabel}`} />
        <MetricCard label="Recent 24h" value={formatInt(recent24h)} meta="Fresh session creation" />
        <MetricCard label="Monitored sessions" value={formatInt(monitoredSessions)} meta={`Admin event stream in ${rangeLabel}`} />
        <MetricCard label="Recovered sessions" value={formatInt(recoveredSessions)} meta={`Admin recovery event stream in ${rangeLabel}`} />
        <MetricCard label="High-risk sessions" value={formatInt(rows.filter((row) => row.riskScore > 0).length)} meta="Current page only" />
        <MetricCard label="Messages" value={formatInt(rows.reduce((sum, row) => sum + row.messageCount, 0))} meta="Current page message volume" />
        <MetricCard label="Unique users" value={formatInt(new Set(rows.map((row) => row.userId)).size)} meta="Current page" />
        <MetricCard label="Unique accounts" value={formatInt(new Set(rows.map((row) => row.accountId)).size)} meta="Current page" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Session tracker"
          subtitle="Created session flow and observed session signals across the current reporting window."
          labels={sessionTrend.map((row) => row.label)}
          primary={sessionTrend.map((row) => row.value)}
          secondary={observedSignalTrend.map((row) => row.value)}
          primaryLabel="Created sessions"
          secondaryLabel="Observed signals"
        />

        <Panel title="Risk watchlist" subtitle="Sessions with negative feedback or retry churn in the current result slice.">
          <div className="hq-list">
            {rows
              .slice()
              .sort((left, right) => right.riskScore - left.riskScore)
              .slice(0, 8)
              .map((row) => (
                <div key={row.id} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{row.title}</div>
                    <div className="hq-listMeta">{row.accountIdentity.label} · {row.surface}</div>
                  </div>
                  <Badge className="hq-badgeCompact hq-badgeCorporate hq-watchlistStatusBadge" tone={row.riskScore > 0 ? "bad" : "good"}>
                    {formatInt(row.riskScore)}
                  </Badge>
                </div>
              ))}
          </div>
        </Panel>
      </section>

      <Panel title="Session inventory" subtitle="Server-side paginated session view with user, account, timing, message count, and risk context.">
        <section className="hq-filterShell">
          <form className="hq-filterRail hq-filterRailSessions">
            <input type="hidden" name="range" value={range} />
            <input type="hidden" name="month" value={month || ""} />
            <label className="hq-filterField hq-filterFieldSearch">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <input className="hq-filterInput" type="search" name="q" placeholder="Search session id, title, context, origin" defaultValue={q} aria-label="Session search" />
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="surface" defaultValue={surface} aria-label="Surface">
                <option value="">All surfaces</option>
                <option value="console">console</option>
                <option value="center">center</option>
                <option value="code">code</option>
              </select>
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="accountId" defaultValue={accountId} aria-label="Account">
                <option value="">All accounts</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{formatUserHandle(accountOwners.get(account.id))}</option>
                ))}
              </select>
            </label>
            <div className="hq-filterActions">
              <button className="hq-button" type="submit">Apply</button>
            </div>
          </form>
        </section>
        <div className="hq-tableWrap hq-tableWrapSessionInventory">
          <table className="hq-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>User</th>
                <th>Account</th>
                <th>Surface</th>
                <th>Messages</th>
                <th>Last activity</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.title}</strong>
                    <span>{row.contextLabel || row.origin || "No context label"}</span>
                  </td>
                  <td>
                    <strong>{row.userIdentity.primary}</strong>
                    <span>{row.userIdentity.secondary}</span>
                  </td>
                  <td>
                    <strong>{row.account ? <Link href={`/accounts/${row.account.id}`}>{row.accountIdentity.label}</Link> : row.accountIdentity.label}</strong>
                    <span>{row.accountIdentity.meta}</span>
                  </td>
                  <td>
                    <strong>{row.surface}</strong>
                    <span>{formatDateTime(row.createdAt)}</span>
                  </td>
                  <td>
                    <strong>{formatInt(row.messageCount)}</strong>
                    <span>{row.projectId ? `Project ${row.projectId}` : "No project scope"}</span>
                  </td>
                  <td>
                    <strong>{formatDateTime(row.lastMessageAt || row.updatedAt)}</strong>
                    <span>{formatDateTime(row.updatedAt)}</span>
                  </td>
                  <td>
                    <strong>{formatInt(row.riskScore)}</strong>
                    <span>{row.riskScore > 0 ? "Dislikes or retries detected" : "Stable"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationNav
          page={page}
          pageCount={totalPages}
          pathname="/sessions"
          searchParams={props.searchParams || {}}
        />
      </Panel>
    </AdminPage>
  );
}
