import {
  AdminPage,
  Badge,
  EmptyState,
  KeyValueGrid,
  MetricCard,
  Panel,
  TrendChart,
} from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
  asRecord,
  parseAdminMonth,
  formatDateTime,
  formatInt,
  formatPercent,
  getAdminEventTrend,
  parseAdminRange,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECOVERY_EVENT_NAMES = [
  "auth_password_recovery_requested",
  "auth_password_recovery_completed",
  "auth_email_recovery_requested",
  "auth_email_recovery_completed",
] as const;

function metaValue(meta: unknown, key: string) {
  const value = asRecord(meta)?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function topEntries(source: Map<string, number>, limit = 6) {
  return [...source.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function friendlySecurityLabel(name: string) {
  switch (name) {
    case "auth_password_recovery_requested":
      return "Password recovery requested";
    case "auth_password_recovery_completed":
      return "Password reset completed";
    case "auth_email_recovery_requested":
      return "Login email recovery requested";
    case "auth_email_recovery_completed":
      return "Login email recovered";
    case "cavverify_failed":
      return "Caverify failed";
    case "cavguard_blocked":
      return "CavGuard blocked";
    case "cavguard_overridden":
      return "CavGuard overridden";
    default:
      return name;
  }
}

function securityEventTone(name: string): "good" | "watch" | "bad" {
  if (name.includes("failed") || name.includes("blocked")) return "bad";
  if (name.includes("completed")) return "good";
  return "watch";
}

function securityEventBadge(name: string) {
  switch (name) {
    case "auth_password_recovery_requested":
    case "auth_email_recovery_requested":
      return "requested";
    case "auth_password_recovery_completed":
    case "auth_email_recovery_completed":
      return "recovered";
    case "cavverify_failed":
      return "verify";
    case "cavguard_blocked":
      return "blocked";
    case "cavguard_overridden":
      return "override";
    default:
      return "event";
  }
}

function auditEventLabel(action: string) {
  switch (action) {
    case "AUTH_LOGIN_FAILED":
      return "Login failed";
    case "USERNAME_CHANGED":
      return "Username changed";
    case "PASSWORD_CHANGED":
      return "Password changed";
    default:
      return action;
  }
}

export default async function SecurityPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/security", { scopes: ["security.read"] });

  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range);
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const [
    cavverifyRenders,
    cavverifyFails,
    cavguardRenders,
    cavguardBlocks,
    cavguardOverrides,
    usernameChanges,
    passwordChanges,
    loginFailures,
    loginAcceptedSignals,
    suspiciousTrend,
    topOriginsRaw,
    recoveryEvents,
    recentAuditEvents,
    recentSecurityOps,
    recentIncidents,
  ] = await Promise.all([
    prisma.adminEvent.count({ where: { name: "cavverify_rendered", createdAt: { gte: start, lt: end } } }),
    prisma.adminEvent.count({ where: { name: "cavverify_failed", createdAt: { gte: start, lt: end } } }),
    prisma.adminEvent.count({ where: { name: "cavguard_rendered", createdAt: { gte: start, lt: end } } }),
    prisma.adminEvent.count({ where: { name: "cavguard_blocked", createdAt: { gte: start, lt: end } } }),
    prisma.adminEvent.count({ where: { name: "cavguard_overridden", createdAt: { gte: start, lt: end } } }),
    prisma.auditLog.count({ where: { action: "USERNAME_CHANGED", createdAt: { gte: start, lt: end } } }),
    prisma.auditLog.count({ where: { action: "PASSWORD_CHANGED", createdAt: { gte: start, lt: end } } }),
    prisma.auditLog.count({ where: { action: "AUTH_LOGIN_FAILED", createdAt: { gte: start, lt: end } } }),
    prisma.auditLog.findMany({
      where: {
        action: "AUTH_SIGNED_IN",
        createdAt: { gte: start, lt: end },
      },
      select: {
        metaJson: true,
      },
    }),
    getAdminEventTrend(["cavverify_failed", "cavguard_blocked"], range, month),
    prisma.adminEvent.groupBy({
      by: ["origin"],
      where: {
        createdAt: { gte: start, lt: end },
        name: { in: ["cavverify_rendered", "cavguard_rendered", "cavguard_blocked", "cavverify_failed"] },
        origin: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.adminEvent.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        name: { in: [...RECOVERY_EVENT_NAMES] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        origin: true,
        subjectUserId: true,
        metaJson: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        action: {
          in: ["AUTH_LOGIN_FAILED", "USERNAME_CHANGED", "PASSWORD_CHANGED"],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 16,
      select: {
        id: true,
        action: true,
        targetLabel: true,
        metaJson: true,
        createdAt: true,
      },
    }),
    prisma.adminEvent.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        name: {
          in: [
            "cavverify_failed",
            "cavguard_blocked",
            "cavguard_overridden",
            ...RECOVERY_EVENT_NAMES,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: {
        id: true,
        name: true,
        origin: true,
        result: true,
        metaJson: true,
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
  ]);
  const topOrigins = [...topOriginsRaw]
    .sort((left, right) => right._count._all - left._count._all)
    .slice(0, 8);
  let directPasswordLogins = 0;
  let googleOauthLogins = 0;
  let githubOauthLogins = 0;
  let emailStepUpCompletions = 0;
  let appStepUpCompletions = 0;

  for (const entry of loginAcceptedSignals) {
    const securityEvent = metaValue(entry.metaJson, "security_event");
    const method = metaValue(entry.metaJson, "method");
    if (securityEvent === "login_password_ok" && method === "password") {
      directPasswordLogins += 1;
      continue;
    }
    if (method === "oauth_google") {
      googleOauthLogins += 1;
      continue;
    }
    if (method === "oauth_github") {
      githubOauthLogins += 1;
      continue;
    }
    if (securityEvent === "2fa_verified" && method === "email") {
      emailStepUpCompletions += 1;
      continue;
    }
    if (securityEvent === "2fa_verified" && method === "app") {
      appStepUpCompletions += 1;
    }
  }

  const protectedSessions = cavverifyRenders + cavguardRenders;
  const loginAccepted = loginAcceptedSignals.filter((entry) => metaValue(entry.metaJson, "security_event") !== "2fa_verified").length;
  const loginAttempts = loginFailures + loginAccepted;
  const loginFailureRate = loginAttempts > 0 ? (loginFailures / loginAttempts) * 100 : 0;
  const cavverifyRenderRate = protectedSessions > 0 ? (cavverifyRenders / protectedSessions) * 100 : 0;
  const cavguardRenderRate = protectedSessions > 0 ? (cavguardRenders / protectedSessions) * 100 : 0;
  let passwordRecoveryRequested = 0;
  let passwordRecoveryCompleted = 0;
  let emailRecoveryRequested = 0;
  let emailRecoveryCompleted = 0;
  let passwordRequestsByEmail = 0;
  let passwordRequestsByUsername = 0;
  const recoveredUsers = new Set<string>();
  const recoveryDomains = new Map<string, number>();
  const recoveryEmailDomains = new Map<string, number>();

  for (const event of recoveryEvents) {
    const requestedDomain = event.origin || metaValue(event.metaJson, "requestedDomain");
    const emailDomain = metaValue(event.metaJson, "emailDomain");
    if (emailDomain) {
      recoveryEmailDomains.set(emailDomain, (recoveryEmailDomains.get(emailDomain) || 0) + 1);
    }

    if (event.name === "auth_password_recovery_requested") {
      passwordRecoveryRequested += 1;
      const identifierType = metaValue(event.metaJson, "identifierType");
      if (identifierType === "email") passwordRequestsByEmail += 1;
      if (identifierType === "username") passwordRequestsByUsername += 1;
      continue;
    }

    if (event.name === "auth_password_recovery_completed") {
      passwordRecoveryCompleted += 1;
      if (event.subjectUserId) recoveredUsers.add(event.subjectUserId);
      continue;
    }

    if (event.name === "auth_email_recovery_requested") {
      emailRecoveryRequested += 1;
      if (requestedDomain) {
        recoveryDomains.set(requestedDomain, (recoveryDomains.get(requestedDomain) || 0) + 1);
      }
      continue;
    }

    if (event.name === "auth_email_recovery_completed") {
      emailRecoveryCompleted += 1;
      if (event.subjectUserId) recoveredUsers.add(event.subjectUserId);
    }
  }

  const recoveryRequests = passwordRecoveryRequested + emailRecoveryRequested;
  const recoveryCompletions = passwordRecoveryCompleted + emailRecoveryCompleted;
  const recoveryFailures = Math.max(0, recoveryRequests - recoveryCompletions);
  const recoverySuccessRate = recoveryRequests > 0 ? (recoveryCompletions / recoveryRequests) * 100 : 0;
  const recoveryFailureRate = recoveryRequests > 0 ? (recoveryFailures / recoveryRequests) * 100 : 0;
  const recoveryCompletionRate = recoveryRequests > 0 ? (recoveryCompletions / recoveryRequests) * 100 : 0;
  const passwordRecoveryCompletionShare = recoveryCompletions > 0 ? (passwordRecoveryCompleted / recoveryCompletions) * 100 : 0;
  const emailRecoveryCompletionShare = recoveryCompletions > 0 ? (emailRecoveryCompleted / recoveryCompletions) * 100 : 0;
  const accountsRecovered = recoveredUsers.size;
  const identityChangeCount = usernameChanges + passwordChanges;
  const recoveryInboxTouches = [...recoveryEmailDomains.values()].reduce((sum, value) => sum + value, 0);
  const openIncidentCount = recentIncidents.filter((incident) => incident.status !== "RESOLVED").length;
  const totalStepUpCompletions = emailStepUpCompletions + appStepUpCompletions;
  const accessPathLeader = [
    { label: "Direct password", value: directPasswordLogins },
    { label: "Google OAuth", value: googleOauthLogins },
    { label: "GitHub OAuth", value: githubOauthLogins },
    { label: "2FA email", value: emailStepUpCompletions },
    { label: "2FA app", value: appStepUpCompletions },
  ].sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))[0];
  const forgottenLead = passwordRecoveryRequested === emailRecoveryRequested
    ? "Balanced"
    : passwordRecoveryRequested > emailRecoveryRequested
      ? "Password"
      : "Login email";
  const recoveredLead = passwordRecoveryCompleted === emailRecoveryCompleted
    ? "Balanced"
    : passwordRecoveryCompleted > emailRecoveryCompleted
      ? "Password reset"
      : "Login email";
  const topRecoveryDomains = topEntries(recoveryDomains);
  const topRecoveryEmailDomains = topEntries(recoveryEmailDomains);
  const securityFeed = [
    ...recentSecurityOps.map((event) => {
      const requestedDomain = event.origin || metaValue(event.metaJson, "requestedDomain");
      const emailDomain = metaValue(event.metaJson, "emailDomain");
      const detail = event.name.startsWith("auth_")
        ? [requestedDomain || null, emailDomain ? `${emailDomain} inbox` : null]
        : [event.origin || null, event.result || null];
      return {
        id: `event:${event.id}`,
        title: friendlySecurityLabel(event.name),
        meta: [detail.filter(Boolean).join(" · "), formatDateTime(event.createdAt)].filter(Boolean).join(" · "),
        tone: securityEventTone(event.name),
        badge: securityEventBadge(event.name),
        createdAt: event.createdAt,
      };
    }),
    ...recentAuditEvents.map((event) => {
      const location = [metaValue(event.metaJson, "location"), metaValue(event.metaJson, "geoCountry")].filter(Boolean).join(" · ");
      return {
        id: `audit:${event.id}`,
        title: auditEventLabel(event.action),
        meta: [event.targetLabel || null, location || null, formatDateTime(event.createdAt)].filter(Boolean).join(" · "),
        tone: event.action === "AUTH_LOGIN_FAILED" ? "bad" as const : "watch" as const,
        badge: event.action === "AUTH_LOGIN_FAILED" ? "auth" : "change",
        createdAt: event.createdAt,
      };
    }),
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 14);

  return (
    <AdminPage
      title="Security"
      subtitle="Top-level security operating view for Caverify, CavGuard, failed sign-ins, account recovery demand, identity changes, targeted origins, overrides, and recent incidents."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Protected sessions" value={formatInt(protectedSessions)} meta="Combined verify and guard render traffic" />
        <MetricCard
          label="Login failure rate"
          value={formatPercent(loginFailureRate)}
          meta={`${formatInt(loginFailures)} failed sign-ins against ${formatInt(loginAccepted)} accepted sign-ins`}
        />
        <MetricCard
          label="Caverify render rate"
          value={formatPercent(cavverifyRenderRate)}
          meta={`${formatInt(cavverifyFails)} failed outcomes`}
          href="/security/cavverify"
        />
        <MetricCard
          label="CavGuard render rate"
          value={formatPercent(cavguardRenderRate)}
          meta={`${formatInt(cavguardBlocks)} blocked sessions`}
          href="/security/cavguard"
        />
        <MetricCard label="Username changes" value={formatInt(usernameChanges)} meta={`Profile username changes recorded in ${rangeLabel}`} />
        <MetricCard label="Password changes" value={formatInt(passwordChanges)} meta={`Successful password updates recorded in ${rangeLabel}`} />
        <MetricCard
          label="Accounts recovered"
          value={formatInt(accountsRecovered)}
          meta={`${formatInt(passwordRecoveryCompleted)} password resets and ${formatInt(emailRecoveryCompleted)} login email recoveries completed`}
        />
        <MetricCard label="Overrides" value={formatInt(cavguardOverrides)} meta="Manual or CTA-based bypass activity" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Suspicious activity trend"
          subtitle={`Failed verify outcomes plus blocked guard outcomes across ${rangeLabel}.`}
          labels={suspiciousTrend.map((point) => point.label)}
          primary={suspiciousTrend.map((point) => point.value)}
          secondary={suspiciousTrend.map((point) => point.secondaryValue || 0)}
          primaryLabel="Verify fails"
          secondaryLabel="Guard blocks"
          primaryTone="bad"
          secondaryTone="lime"
        />

        <Panel title="Credential pressure" subtitle={`Failed sign-ins, recovery demand, recovered accounts, and dominant targeted origins across ${rangeLabel}.`}>
          <div className="hq-grid">
            <KeyValueGrid
              items={[
                { label: "Login failure rate", value: formatPercent(loginFailureRate) },
                { label: "Recovery demand", value: formatInt(recoveryRequests) },
                { label: "Recovered accounts", value: formatInt(accountsRecovered) },
                { label: "Forgotten most", value: forgottenLead },
              ]}
            />
            {topOrigins.length ? (
              <div className="hq-list">
                {topOrigins.slice(0, 4).map((origin) => (
                  <div key={origin.origin || "unknown"} className="hq-listRow">
                    <div>
                      <div className="hq-listLabel">{origin.origin || "Unknown origin"}</div>
                      <div className="hq-listMeta">Security event count</div>
                    </div>
                    <Badge tone="watch">{formatInt(origin._count._all)}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No targeted origins yet."
                subtitle="Once failed verify, blocked guard, or related security events arrive with an origin, the highest-pressure origins will show here."
              />
            )}
          </div>
        </Panel>
      </section>

      <section className="hq-grid hq-securityPuzzle">
        <div className="hq-grid hq-gridTwo hq-securityRecoveryRow">
          <div className="hq-securityRecoveryColumn">
            <div className="hq-securityRecoveryMethod">
              <Panel
                title="Recovered by method"
                subtitle={`Completed account recovery outcomes across ${rangeLabel}, split between password reset and login email recovery.`}
              >
                {recoveryCompletions > 0 ? (
                  <div className="hq-securityMiniCompare">
                    <div className="hq-securityMiniCompareHead">
                      <div className="hq-securityMiniCompareTitle">{recoveredLead}</div>
                      <div className="hq-securityMiniCompareMeta">{formatInt(recoveryCompletions)} completed recoveries in this window</div>
                    </div>

                    <div className="hq-securityMiniCompareList">
                      <article className="hq-securityMiniCompareRow">
                        <div className="hq-securityMiniCompareRowHead">
                          <div className="hq-planShareLabelWrap">
                            <span className="hq-planShareSwatch" data-tone="lime" />
                            <span className="hq-securityMiniCompareLabel">Password reset</span>
                          </div>
                          <div className="hq-securityMiniCompareValue" data-tone="lime">{formatInt(passwordRecoveryCompleted)}</div>
                        </div>
                        <div className="hq-securityMiniCompareLine">
                          <span
                            className="hq-securityMiniCompareLineFill"
                            data-tone="lime"
                            style={{ width: `${Math.max(passwordRecoveryCompletionShare, 6)}%` }}
                          />
                        </div>
                        <div className="hq-securityMiniCompareMeta">
                          {formatPercent(passwordRecoveryCompletionShare, 0)} of completions · {formatInt(passwordRecoveryRequested)} requests opened
                        </div>
                      </article>

                      <article className="hq-securityMiniCompareRow">
                        <div className="hq-securityMiniCompareRowHead">
                          <div className="hq-planShareLabelWrap">
                            <span className="hq-planShareSwatch" data-tone="orange" />
                            <span className="hq-securityMiniCompareLabel">Login email</span>
                          </div>
                          <div className="hq-securityMiniCompareValue" data-tone="orange">{formatInt(emailRecoveryCompleted)}</div>
                        </div>
                        <div className="hq-securityMiniCompareLine">
                          <span
                            className="hq-securityMiniCompareLineFill"
                            data-tone="orange"
                            style={{ width: `${Math.max(emailRecoveryCompletionShare, 6)}%` }}
                          />
                        </div>
                        <div className="hq-securityMiniCompareMeta">
                          {formatPercent(emailRecoveryCompletionShare, 0)} of completions · {formatInt(emailRecoveryRequested)} requests opened
                        </div>
                      </article>
                    </div>
                  </div>
                ) : (
                  <div className="hq-securityCompactEmpty hq-securityCompactEmptyTight">
                    <p className="hq-securityCompactEmptyTitle">No completed recoveries yet</p>
                    <p className="hq-securityCompactEmptySub">As soon as password resets or login email recoveries complete, the recovery split will render here without stretching the full row.</p>
                  </div>
                )}
              </Panel>
            </div>

            <Panel title="Accepted login paths" subtitle={`How successful auth reached CavBot across ${rangeLabel}, split between direct sign-ins, OAuth, and second-step completions.`}>
              <KeyValueGrid
                items={[
                  { label: "Direct password", value: formatInt(directPasswordLogins) },
                  { label: "Google OAuth", value: formatInt(googleOauthLogins) },
                  { label: "GitHub OAuth", value: formatInt(githubOauthLogins) },
                  { label: "2FA email", value: formatInt(emailStepUpCompletions) },
                  { label: "Most used path", value: accessPathLeader?.value ? `${accessPathLeader.label} · ${formatInt(accessPathLeader.value)}` : "No accepted auth yet" },
                  { label: "Accepted sign-ins", value: formatInt(loginAccepted) },
                ]}
              />
            </Panel>
          </div>

          <Panel title="Recovery command" subtitle={`Password/email recovery demand, completion rate, identifier split, and dominant forgotten factor across ${rangeLabel}.`}>
            <div className="hq-securityRecoveryCommand">
              <KeyValueGrid
                items={[
                  { label: "Forgot password", value: formatInt(passwordRecoveryRequested) },
                  { label: "Forgot login email", value: formatInt(emailRecoveryRequested) },
                  { label: "Recovered accounts", value: formatInt(accountsRecovered) },
                  { label: "Recovery completion rate", value: formatPercent(recoveryCompletionRate) },
                  { label: "Password request split", value: `${formatInt(passwordRequestsByEmail)} email · ${formatInt(passwordRequestsByUsername)} username` },
                  { label: "Recovered most via", value: recoveredLead },
                  { label: "2FA app", value: formatInt(appStepUpCompletions) },
                  { label: "Step-up completions", value: formatInt(totalStepUpCompletions) },
                ]}
              />

              <div
                className="hq-securityMiniCompare"
                role="img"
                aria-label={`Recovery success rate ${formatPercent(recoverySuccessRate)} and failure rate ${formatPercent(recoveryFailureRate)}`}
              >
                <div className="hq-securityMiniCompareHead">
                  <div className="hq-securityMiniCompareTitle">Recovery outcome rate</div>
                </div>
                <div className="hq-securityMiniCompareList">
                  {[
                    {
                      label: "Success",
                      value: recoveryCompletions,
                      rate: recoverySuccessRate,
                      tone: "lime" as const,
                    },
                    {
                      label: "Failure",
                      value: recoveryFailures,
                      rate: recoveryFailureRate,
                      tone: "bad" as const,
                    },
                  ].map((item) => {
                    return (
                      <article key={item.label} className="hq-securityMiniCompareRow">
                        <div className="hq-securityMiniCompareRowHead">
                          <div className="hq-securityMiniCompareLabel">{item.label}</div>
                          <div className="hq-securityMiniCompareValue" data-tone={item.tone}>
                            {formatPercent(item.rate)}
                          </div>
                        </div>
                        <div className="hq-securityMiniCompareLine">
                          <span
                            className="hq-securityMiniCompareLineFill"
                            data-tone={item.tone}
                            style={{ width: `${Math.max(item.rate, 6)}%` }}
                          />
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          </Panel>
        </div>

        <div className="hq-securityAuthDesk">
          <Panel title="Auth activity desk" subtitle="Verify, guard, sign-in failure, recovery, and identity-change flow without the dead-space card stack.">
            <div className="hq-securitySignalStrip">
              <div className="hq-securitySignalCard">
                <div className="hq-securitySignalLabel">Failed sign-ins</div>
                <div className="hq-securitySignalValue">{formatInt(loginFailures)}</div>
              </div>
              <div className="hq-securitySignalCard">
                <div className="hq-securitySignalLabel">Recovery requests</div>
                <div className="hq-securitySignalValue">{formatInt(recoveryRequests)}</div>
              </div>
              <div className="hq-securitySignalCard">
                <div className="hq-securitySignalLabel">Identity changes</div>
                <div className="hq-securitySignalValue">{formatInt(identityChangeCount)}</div>
              </div>
            </div>
            {securityFeed.length ? (
              <div className="hq-list hq-securityFeedList">
                {securityFeed.map((event) => (
                  <div key={event.id} className="hq-listRow">
                    <div>
                      <div className="hq-listLabel">{event.title}</div>
                      <div className="hq-listMeta">{event.meta}</div>
                    </div>
                    <Badge tone={event.tone}>{event.badge}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="hq-securityCompactEmpty">
                <p className="hq-securityCompactEmptyTitle">Security feed warming up</p>
                <p className="hq-securityCompactEmptySub">When CavBot captures login failures, recoveries, identity changes, or higher-risk auth events, this desk will fill in with the latest operator-facing activity.</p>
              </div>
            )}
          </Panel>
        </div>

        <div className="hq-grid hq-gridTwo hq-securityRailRow">
          <Panel title="Recovery routing surfaces" subtitle="Where recovery is flowing when users forget their password or login email.">
            <div className="hq-securitySurfaceSplit">
              <section className="hq-securitySurfaceBlock">
                <div className="hq-securitySurfaceHead">
                  <div>
                    <div className="hq-securitySurfaceTitle">Workspace recovery domains</div>
                    <p className="hq-securitySurfaceMeta">Domains used to recover login email by workspace or monitored site.</p>
                  </div>
                  <Badge tone="watch" className="hq-badgeCorporate">{formatInt(emailRecoveryRequested)}</Badge>
                </div>
                <div className="hq-securitySurfaceContent">
                  {topRecoveryDomains.length ? (
                    <div className="hq-securitySurfaceList">
                      {topRecoveryDomains.map(([domain, count]) => (
                        <div key={domain} className="hq-securitySurfaceRow">
                          <span className="hq-securitySurfaceValue">{domain}</span>
                          <span className="hq-securitySurfaceCount">{formatInt(count)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="hq-securityCompactEmpty hq-securityCompactEmptyTight hq-securitySurfaceEmpty">
                      <p className="hq-securityCompactEmptyTitle">No recovery domains yet</p>
                      <p className="hq-securityCompactEmptySub">As soon as someone uses workspace-domain recovery, the leading domains will show here.</p>
                    </div>
                  )}
                </div>
              </section>

              <section className="hq-securitySurfaceBlock">
                <div className="hq-securitySurfaceHead">
                  <div>
                    <div className="hq-securitySurfaceTitle">Login inbox domains</div>
                    <p className="hq-securitySurfaceMeta">Email domains tied to password reset or login email recovery traffic.</p>
                  </div>
                  <Badge tone="watch" className="hq-badgeCorporate">{formatInt(recoveryInboxTouches)}</Badge>
                </div>
                <div className="hq-securitySurfaceContent">
                  {topRecoveryEmailDomains.length ? (
                    <div className="hq-securitySurfaceList">
                      {topRecoveryEmailDomains.map(([domain, count]) => (
                        <div key={domain} className="hq-securitySurfaceRow">
                          <span className="hq-securitySurfaceValue">{domain}</span>
                          <span className="hq-securitySurfaceCount">{formatInt(count)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="hq-securityCompactEmpty hq-securityCompactEmptyTight hq-securitySurfaceEmpty">
                      <p className="hq-securityCompactEmptyTitle">No inbox-domain activity yet</p>
                      <p className="hq-securityCompactEmptySub">When recovery requests or completions carry login inbox domains, the most common domains will render here.</p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </Panel>

          <Panel title="Incident pulse" subtitle="The latest platform incidents to line up against auth friction, recovery demand, or override pressure.">
            <div className="hq-securityIncidentStack">
              <div className="hq-securitySignalStrip hq-securitySignalStripRail">
                <div className="hq-securitySignalCard">
                  <div className="hq-securitySignalLabel">Open now</div>
                  <div className="hq-securitySignalValue">{formatInt(openIncidentCount)}</div>
                </div>
                <div className="hq-securitySignalCard">
                  <div className="hq-securitySignalLabel">Recent tracked</div>
                  <div className="hq-securitySignalValue">{formatInt(recentIncidents.length)}</div>
                </div>
              </div>
              {recentIncidents.length ? (
                <div className="hq-list hq-securityIncidentList">
                  {recentIncidents.map((incident) => (
                    <div key={incident.id} className="hq-listRow">
                      <div>
                        <div className="hq-listLabel">{incident.title}</div>
                        <div className="hq-listMeta">{formatDateTime(incident.startedAt)} · {incident.impact}</div>
                      </div>
                      <Badge tone={incident.status === "RESOLVED" ? "good" : "bad"}>{incident.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="hq-securityCompactEmpty hq-securityCompactEmptyTight">
                  <p className="hq-securityCompactEmptyTitle">No recent incidents</p>
                  <p className="hq-securityCompactEmptySub">Incident correlation will appear here whenever platform issues overlap the current security window.</p>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </section>
    </AdminPage>
  );
}
