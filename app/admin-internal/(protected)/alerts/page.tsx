import Link from "next/link";

import {
  AdminPage,
  Badge,
  EmptyState,
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
  formatPercent,
  formatUserHandle,
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
import { getSystemStatusSnapshot } from "@/lib/system-status/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function s(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function alertBadgeTone(value: string) {
  const normalized = String(value || "").trim().toUpperCase();
  if (["BAD", "CRITICAL", "MAJOR", "DOWN"].includes(normalized)) return "bad" as const;
  if (["WATCH", "MINOR", "AT_RISK", "IDENTIFIED", "INVESTIGATING", "MONITORING", "UNKNOWN"].includes(normalized)) {
    return "watch" as const;
  }
  return "good" as const;
}

function isAlertSpike(input: { sourceKey: string; severity: string; status: string }) {
  const severity = String(input.severity || "").trim().toUpperCase();
  if (input.sourceKey === "incident") {
    return input.status === "open" || severity === "CRITICAL" || severity === "MAJOR";
  }
  return severity === "BAD";
}

function sharePercent(count: number, total: number) {
  if (!total) return formatPercent(0, 0);
  return formatPercent((count / total) * 100, 0);
}

function statusLabel(kind: "live" | "at_risk" | "down" | "unknown") {
  if (kind === "down") return "Incident";
  if (kind === "at_risk") return "At risk";
  if (kind === "live") return "Healthy";
  return "Unknown";
}

function statusChartKey(kind: "live" | "at_risk" | "down" | "unknown") {
  if (kind === "down") return "incident" as const;
  if (kind === "at_risk") return "at-risk" as const;
  if (kind === "live") return "healthy" as const;
  return "unknown" as const;
}

function humanizeToken(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return "Unknown";
  return normalized
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeAlertKind(value: string) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "HQ_CHAT_MESSAGE") return "CavChat message";
  return humanizeToken(value);
}

export default async function AlertsPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/alerts", { scopes: ["alerts.read"] });

  const q = s(props.searchParams?.q).trim().toLowerCase();
  const rawSource = s(props.searchParams?.source).trim().toLowerCase();
  const source = ["workspace", "project", "notification", "incident"].includes(rawSource) ? rawSource : "";
  const status = s(props.searchParams?.status).trim().toLowerCase();
  const severity = s(props.searchParams?.severity).trim().toUpperCase();
  const range = parseAdminRange(s(props.searchParams?.range), "30d");
  const month = parseAdminMonth(s(props.searchParams?.month));
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const page = parsePage(s(props.searchParams?.page), 1);

  const [workspaceNotices, projectNotices, notifications, incidents, incidentUpdates, liveStatusSnapshot] = await Promise.all([
    prisma.workspaceNotice.findMany({
      where: {
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: "desc" },
      take: 150,
      select: {
        id: true,
        title: true,
        body: true,
        tone: true,
        createdAt: true,
        dismissedAt: true,
        account: { select: { id: true, name: true } },
        project: { select: { name: true, slug: true } },
        site: { select: { label: true, origin: true } },
      },
    }),
    prisma.projectNotice.findMany({
      where: {
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        body: true,
        tone: true,
        createdAt: true,
        dismissedAt: true,
        project: {
          select: {
            name: true,
            slug: true,
            account: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.notification.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        tone: { in: ["WATCH", "BAD"] },
      },
      orderBy: { createdAt: "desc" },
      take: 120,
      select: {
        id: true,
        title: true,
        body: true,
        kind: true,
        tone: true,
        createdAt: true,
        readAt: true,
        user: {
          select: {
            email: true,
            displayName: true,
            username: true,
          },
        },
        account: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.incident.findMany({
      where: {
        startedAt: { gte: start, lt: end },
      },
      orderBy: { startedAt: "desc" },
      take: 60,
      select: {
        id: true,
        title: true,
        body: true,
        status: true,
        impact: true,
        startedAt: true,
        resolvedAt: true,
        affectedServices: true,
      },
    }),
    prisma.incidentUpdate.findMany({
      where: {
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        message: true,
        createdAt: true,
        incident: {
          select: {
            id: true,
            title: true,
            impact: true,
          },
        },
      },
    }),
    getSystemStatusSnapshot(),
  ]);
  const accountOwners = await getAccountOwners(
    Array.from(
      new Set([
        ...workspaceNotices.map((notice) => notice.account.id),
        ...projectNotices.map((notice) => notice.project.account.id),
        ...notifications.map((notification) => notification.account?.id).filter((value): value is string => Boolean(value)),
      ]),
    ),
  );
  const unresolvedWorkspaceNotices = workspaceNotices.filter((notice) => !notice.dismissedAt);
  const unresolvedProjectNotices = projectNotices.filter((notice) => !notice.dismissedAt);
  const unreadSignals = notifications.filter((notification) => !notification.readAt);
  const openIncidents = incidents.filter((incident) => incident.status !== "RESOLVED");
  const serviceWatchlist = liveStatusSnapshot.services
    .filter((service) => service.status !== "live")
    .sort((left, right) => {
      const severity = { down: 3, at_risk: 2, unknown: 1, live: 0 } as const;
      const delta = severity[right.status] - severity[left.status];
      if (delta !== 0) return delta;
      return String(left.label || "").localeCompare(String(right.label || ""));
    });
  const latestIncidentUpdateById = new Map<string, (typeof incidentUpdates)[number]>();
  for (const update of incidentUpdates) {
    if (!latestIncidentUpdateById.has(update.incident.id)) {
      latestIncidentUpdateById.set(update.incident.id, update);
    }
  }

  const allRows = [
    ...workspaceNotices.map((notice) => ({
      id: `wn:${notice.id}`,
      title: notice.title,
      body: notice.body,
      severity: notice.tone,
      status: notice.dismissedAt ? "resolved" : "open",
      source: "Workspace notice",
      sourceKey: "workspace",
      scope: [formatUserHandle(accountOwners.get(notice.account.id)), notice.project?.name || notice.project?.slug, notice.site?.label || notice.site?.origin].filter(Boolean).join(" · "),
      createdAt: notice.createdAt,
    })),
    ...projectNotices.map((notice) => ({
      id: `pn:${notice.id}`,
      title: notice.title,
      body: notice.body,
      severity: notice.tone,
      status: notice.dismissedAt ? "resolved" : "open",
      source: "Project notice",
      sourceKey: "project",
      scope: [formatUserHandle(accountOwners.get(notice.project.account.id)), notice.project.name || notice.project.slug].filter(Boolean).join(" · "),
      createdAt: notice.createdAt,
    })),
    ...notifications.map((notification) => ({
      id: `notification:${notification.id}`,
      title: notification.title,
      body: notification.body || "",
      severity: notification.tone,
      status: notification.readAt ? "resolved" : "open",
      source: "Notification",
      sourceKey: "notification",
      scope: [
        notification.user.displayName || notification.user.username || notification.user.email,
        notification.account?.id ? formatUserHandle(accountOwners.get(notification.account.id)) : null,
        humanizeAlertKind(notification.kind),
      ].filter(Boolean).join(" · "),
      createdAt: notification.createdAt,
    })),
    ...incidents.map((incident) => ({
      id: `incident:${incident.id}`,
      title: incident.title,
      body: incident.body || "",
      severity: incident.impact,
      status: incident.status === "RESOLVED" ? "resolved" : "open",
      source: "Incident",
      sourceKey: "incident",
      scope: incident.affectedServices.length ? incident.affectedServices.join(" · ") : incident.impact,
      createdAt: incident.startedAt,
    })),
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

  const rows = allRows
    .filter((row) => (q ? `${row.title} ${row.body} ${row.scope} ${row.source}`.toLowerCase().includes(q) : true))
    .filter((row) => (source ? row.sourceKey === source : true))
    .filter((row) => (status ? row.status === status : true))
    .filter((row) => (severity ? row.severity.toUpperCase() === severity : true))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

  const openCount = rows.filter((row) => row.status === "open").length;
  const resolvedCount = rows.filter((row) => row.status === "resolved").length;
  const unreadSignalCount = unreadSignals.length;
  const serviceIssues = liveStatusSnapshot.summary.atRiskCount + liveStatusSnapshot.summary.downCount;
  const unresolvedNotices = [
    ...unresolvedWorkspaceNotices.map((notice) => ({
      id: `workspace:${notice.id}`,
      title: notice.title,
      tone: notice.tone,
      createdAt: notice.createdAt,
      sourceLabel: "Workspace notice",
      accountId: notice.account.id,
      accountLabel: formatUserHandle(accountOwners.get(notice.account.id), notice.account.name),
      scopeParts: [
        notice.project?.name || notice.project?.slug || null,
        notice.site?.label || notice.site?.origin || null,
      ].filter(Boolean),
    })),
    ...unresolvedProjectNotices.map((notice) => ({
      id: `project:${notice.id}`,
      title: notice.title,
      tone: notice.tone,
      createdAt: notice.createdAt,
      sourceLabel: "Project notice",
      accountId: notice.project.account.id,
      accountLabel: formatUserHandle(accountOwners.get(notice.project.account.id), notice.project.account.name),
      scopeParts: [notice.project.name || notice.project.slug].filter(Boolean),
    })),
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 12);
  const sourcePressure = [
    {
      key: "workspace",
      label: "Workspace notices",
      total: workspaceNotices.length,
      open: unresolvedWorkspaceNotices.length,
      severe: unresolvedWorkspaceNotices.filter((notice) => notice.tone === "BAD").length,
      severeLabel: "BAD tone",
    },
    {
      key: "project",
      label: "Project notices",
      total: projectNotices.length,
      open: unresolvedProjectNotices.length,
      severe: unresolvedProjectNotices.filter((notice) => notice.tone === "BAD").length,
      severeLabel: "BAD tone",
    },
    {
      key: "notification",
      label: "Client signals",
      total: notifications.length,
      open: unreadSignals.length,
      severe: unreadSignals.filter((notification) => notification.tone === "BAD").length,
      severeLabel: "BAD tone",
    },
    {
      key: "incident",
      label: "Incidents",
      total: incidents.length,
      open: openIncidents.length,
      severe: incidents.filter((incident) => ["CRITICAL", "MAJOR"].includes(incident.impact)).length,
      severeLabel: "major+ impact",
    },
  ];
  const alertSpikeTrend = buildAdminTrendPoints(
    allRows.map((row) => ({
      date: row.createdAt,
      value: 1,
      secondaryValue: isAlertSpike(row) ? 1 : 0,
    })),
    range,
    month,
  );
  const totalPages = pageCount(rows.length, PAGE_SIZE);
  const visibleRows = rows.slice(offsetForPage(page, PAGE_SIZE), offsetForPage(page, PAGE_SIZE) + PAGE_SIZE);

  return (
    <AdminPage
      title="Alerts"
      subtitle="Unified operations surface for workspace notices, project notices, client signals, incident records, and live service risk across CavBot."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Total alerts" value={formatInt(rows.length)} meta={`Current unified alerts queue for ${rangeLabel}`} />
        <MetricCard label="Open alerts" value={formatInt(openCount)} meta="Signals, notices, or incidents still unresolved" />
        <MetricCard label="Resolved alerts" value={formatInt(resolvedCount)} meta="Dismissed notices or resolved incidents" />
        <MetricCard label="Critical incidents" value={formatInt(rows.filter((row) => row.source === "Incident" && row.severity === "CRITICAL").length)} meta="Critical impact incidents" />
        <MetricCard label="Unread client signals" value={formatInt(unreadSignalCount)} meta={`WATCH/BAD notifications in ${rangeLabel}`} />
        <MetricCard label="Live service issues" value={formatInt(serviceIssues)} meta="At-risk or incident services right now" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Alert pressure"
          subtitle={`Unified alert volume plus dotted spike signal across ${rangeLabel}, covering notices, client signals, and incidents.`}
          labels={alertSpikeTrend.map((point) => point.label)}
          primary={alertSpikeTrend.map((point) => point.value)}
          secondary={alertSpikeTrend.map((point) => point.secondaryValue || 0)}
          primaryLabel="All alerts"
          secondaryLabel="Spike signal"
          secondaryTone="bad"
        />

        <Panel title="Source pressure" subtitle="How the current alert surface is distributed across every tracked source.">
          <div className="hq-list">
            {sourcePressure.map((item) => (
              <div key={item.key} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{item.label}</div>
                  <div className="hq-listMeta">
                    {formatInt(item.open)} open · {formatInt(item.severe)} {item.severeLabel} · {sharePercent(item.total, allRows.length)} of queue
                  </div>
                </div>
                <Badge tone={item.open === 0 ? "good" : item.severe > 0 ? "bad" : "watch"}>
                  {formatInt(item.total)}
                </Badge>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel title="Incident command" subtitle="Open incidents with their latest known status update and service impact.">
          <div className="hq-list">
            {openIncidents.length ? (
              openIncidents.slice(0, 8).map((incident) => {
                const latestUpdate = latestIncidentUpdateById.get(incident.id);
                const services = incident.affectedServices.length
                  ? incident.affectedServices.join(" · ")
                  : "Affected services not listed";
                return (
                  <div key={incident.id} className="hq-listRow">
                    <div>
                      <div className="hq-listLabel">{incident.title}</div>
                      <div className="hq-listMeta">
                        {humanizeToken(incident.impact)} impact · {services} · {latestUpdate ? `${humanizeToken(latestUpdate.status)}: ${latestUpdate.message}` : `Started ${formatDateTime(incident.startedAt)}`}
                      </div>
                    </div>
                    <Badge tone={alertBadgeTone(incident.status === "RESOLVED" ? incident.status : incident.impact)}>
                      {humanizeToken(incident.status)}
                    </Badge>
                  </div>
                );
              })
            ) : incidentUpdates.length ? (
              incidentUpdates.map((update) => (
                <div key={update.id} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{update.incident.title}</div>
                    <div className="hq-listMeta">
                      {update.message} · {humanizeToken(update.incident.impact)} impact · {formatDateTime(update.createdAt)}
                    </div>
                  </div>
                  <Badge tone={alertBadgeTone(update.status)}>{humanizeToken(update.status)}</Badge>
                </div>
              ))
            ) : (
              <EmptyState title="Incident timeline quiet" subtitle="No incident progression entries were recorded in this reporting window." />
            )}
          </div>
        </Panel>

        <Panel title="Live service watchlist" subtitle="Shared CavBot status services that are at risk, in incident, or still unknown.">
          <div className="hq-list">
            {serviceWatchlist.length ? (
              serviceWatchlist.map((service) => (
                <div key={service.key} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{service.label}</div>
                    <div className="hq-listMeta">
                      {service.reason || statusLabel(service.status)} · {typeof service.latencyMs === "number" ? `${formatInt(service.latencyMs)} ms` : "No latency yet"} · {formatDateTime(service.checkedAt)}
                    </div>
                  </div>
                  <div
                    className="hq-platformServiceState"
                    data-status={statusChartKey(service.status)}
                    aria-label={statusLabel(service.status)}
                    title={statusLabel(service.status)}
                  >
                    <span className="hq-platformServiceStateDot" aria-hidden="true" />
                    <span className="hq-platformServiceStateText">{statusLabel(service.status)}</span>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="All services healthy" subtitle="No service currently reports an at-risk, incident, or unknown state." />
            )}
          </div>
        </Panel>
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel title="Client signal triage" subtitle="Unread WATCH or BAD notifications that still need operator attention.">
          <div className="hq-list">
            {unreadSignals.length ? (
              unreadSignals.slice(0, 12).map((notification) => (
                <div key={notification.id} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{notification.title}</div>
                    <div className="hq-listMeta">
                      {notification.user.displayName || notification.user.username || notification.user.email}
                      {" · "}
                      {notification.account?.id ? (
                        <Link href={`/accounts/${notification.account.id}`}>
                          {formatUserHandle(accountOwners.get(notification.account.id), notification.account.name)}
                        </Link>
                      ) : (
                        "No account"
                      )}
                      {" · "}
                        {humanizeAlertKind(notification.kind)}
                      {" · "}
                      {formatDateTime(notification.createdAt)}
                    </div>
                  </div>
                  <Badge tone={notification.tone === "BAD" ? "bad" : "watch"}>{notification.tone}</Badge>
                </div>
              ))
            ) : (
              <EmptyState title="No unread client signals" subtitle="All WATCH and BAD client-facing notifications in this window have been read." />
            )}
          </div>
        </Panel>

        <Panel title="Unresolved notice backlog" subtitle="Workspace and project notices still open and likely to need operator response.">
          <div className="hq-list">
            {unresolvedNotices.length ? (
              unresolvedNotices.map((notice) => (
                <div key={notice.id} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{notice.title}</div>
                    <div className="hq-listMeta">
                      {notice.sourceLabel}
                      {" · "}
                      <Link href={`/accounts/${notice.accountId}`}>{notice.accountLabel}</Link>
                      {notice.scopeParts.length ? ` · ${notice.scopeParts.join(" · ")}` : ""}
                      {" · "}
                      {formatDateTime(notice.createdAt)}
                    </div>
                  </div>
                  <Badge tone={notice.tone === "BAD" ? "bad" : notice.tone === "GOOD" ? "good" : "watch"}>
                    {notice.tone}
                  </Badge>
                </div>
              ))
            ) : (
              <EmptyState title="Notice backlog clear" subtitle="There are no unresolved workspace or project notices in this reporting window." />
            )}
          </div>
        </Panel>
      </section>

      <Panel title="Filters" subtitle="Search and narrow by source, status, or severity across notices, client signals, and incidents.">
        <section className="hq-filterShell">
          <form className="hq-filterRail hq-filterRailAlerts">
            <input type="hidden" name="range" value={range} />
            <input type="hidden" name="month" value={month || ""} />
            <label className="hq-filterField hq-filterFieldSearch">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <input
                className="hq-filterInput"
                type="search"
                name="q"
                placeholder="Search title, body, scope"
                defaultValue={q}
                aria-label="Alert search"
              />
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="source" defaultValue={source} aria-label="Source">
                <option value="">All sources</option>
                <option value="workspace">Workspace notices</option>
                <option value="project">Project notices</option>
                <option value="notification">Notifications</option>
                <option value="incident">Incidents</option>
              </select>
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="status" defaultValue={status} aria-label="Status">
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="severity" defaultValue={severity} aria-label="Severity">
                <option value="">All severities</option>
                <option value="BAD">BAD</option>
                <option value="WATCH">WATCH</option>
                <option value="GOOD">GOOD</option>
                <option value="CRITICAL">CRITICAL</option>
                <option value="MAJOR">MAJOR</option>
                <option value="MINOR">MINOR</option>
              </select>
            </label>
            <div className="hq-filterActions">
              <button className="hq-button" type="submit">Apply</button>
            </div>
          </form>
        </section>
      </Panel>

      <Panel title="Alert queue" subtitle="Serious operator view of alert source, severity, status, and target scope.">
        <div className="hq-tableWrap">
          <table className="hq-table hq-tableAlerts">
            <colgroup>
              <col className="hq-colAlertTitle" />
              <col className="hq-colAlertSource" />
              <col className="hq-colAlertScope" />
              <col className="hq-colAlertStatus" />
              <col className="hq-colAlertCreated" />
            </colgroup>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Source</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length ? (
                visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.title}</strong>
                      <span>{row.body || "No additional body text"}</span>
                    </td>
                    <td>
                      <strong>{row.source}</strong>
                      <span>{row.severity}</span>
                    </td>
                    <td>
                      <strong>{row.scope || "Global"}</strong>
                      <span>Target scope</span>
                    </td>
                    <td>
                      <strong>{row.status === "resolved" ? "Resolved" : "Open"}</strong>
                      <span>{row.severity}</span>
                    </td>
                    <td>
                      <strong>{formatDateTime(row.createdAt)}</strong>
                      <span>Recorded</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className="hq-empty">
                      <p className="hq-emptyTitle">No alerts match this query.</p>
                      <p className="hq-emptySub">Adjust the search, source, status, or severity filters to widen the queue.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationNav
          page={page}
          pageCount={totalPages}
          pathname="/alerts"
          searchParams={props.searchParams || {}}
        />
      </Panel>
    </AdminPage>
  );
}
