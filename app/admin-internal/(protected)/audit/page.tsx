import { Prisma } from "@prisma/client";

import {
  AdminPage,
  MetricCard,
  PaginationNav,
  Panel,
} from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
  formatDateTime,
  formatInt,
  offsetForPage,
  pageCount,
  parseAdminMonth,
  parseAdminRange,
  parsePage,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { readAdminAuditMetrics } from "@/lib/admin/auditMetrics.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

function s(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function titleCaseParts(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatShortStaffId(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D+/g, "");
  return digits ? digits.slice(-4) : "";
}

function formatAuditActionMeta(action: string) {
  switch (String(action || "").trim().toUpperCase()) {
    case "STAFF_SIGNED_IN":
      return "Sign-in event";
    case "STAFF_ADMIN_STEP_UP_SENT":
      return "Step-up challenge";
    case "STAFF_SIGNED_OUT":
      return "Sign-out event";
    case "STAFF_PROFILE_UPDATED":
      return "Profile change";
    case "STAFF_RESTORED":
      return "Access restored";
    case "STAFF_SUSPENDED":
      return "Access suspension";
    case "STAFF_REVOKED":
      return "Access revoked";
    case "STAFF_INVITED":
      return "Invitation issued";
    default:
      return titleCaseParts(action);
  }
}

function formatAuditEntityTypeLabel(entityType: string) {
  switch (String(entityType || "").trim().toLowerCase()) {
    case "staff_profile":
      return "Team member";
    case "user":
      return "User account";
    case "staff_invite":
      return "Staff invite";
    case "api_key":
      return "API key";
    default:
      return titleCaseParts(entityType);
  }
}

function formatAuditSeverityLabel(value: string) {
  switch (String(value || "").trim().toLowerCase()) {
    case "destructive":
      return "Destructive";
    case "warning":
      return "Warning";
    case "info":
      return "Info";
    default:
      return titleCaseParts(value);
  }
}

export default async function AuditPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/audit", { scopes: ["audit.read"] });

  const q = s(props.searchParams?.q).trim();
  const action = s(props.searchParams?.action).trim();
  const severity = s(props.searchParams?.severity).trim();
  const range = parseAdminRange(s(props.searchParams?.range), "30d");
  const month = parseAdminMonth(s(props.searchParams?.month));
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const page = parsePage(s(props.searchParams?.page), 1);
  const filters: Prisma.AdminAuditLogWhereInput[] = [];
  filters.push({ createdAt: { gte: start, lt: end } });
  if (q) {
    filters.push({
      OR: [
        { action: { contains: q, mode: "insensitive" } },
        { actionLabel: { contains: q, mode: "insensitive" } },
        { entityType: { contains: q, mode: "insensitive" } },
        { entityLabel: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (action) filters.push({ action });
  if (severity === "info" || severity === "warning" || severity === "destructive") {
    filters.push({ severity });
  }
  const where: Prisma.AdminAuditLogWhereInput = filters.length ? { AND: filters } : {};

  const [metrics, rows] = await Promise.all([
    readAdminAuditMetrics({ start, end, q, action, severity }),
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offsetForPage(page, PAGE_SIZE),
      take: PAGE_SIZE,
    }),
  ]);

  const actorUserIds = Array.from(new Set(rows.map((row) => row.actorUserId).filter(Boolean))) as string[];
  const staffProfileIds = Array.from(
    new Set(
      rows
        .flatMap((row) => [
          row.actorStaffId,
          row.entityType === "staff_profile" ? row.entityId : null,
        ])
        .filter(Boolean),
    ),
  ) as string[];

  const [actorUsers, relatedStaffProfiles] = await Promise.all([
    actorUserIds.length
      ? prisma.user.findMany({
          where: { id: { in: actorUserIds } },
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
          },
        })
      : Promise.resolve([]),
    staffProfileIds.length
      ? prisma.staffProfile.findMany({
          where: { id: { in: staffProfileIds } },
          select: {
            id: true,
            staffCode: true,
            user: {
              select: {
                email: true,
                username: true,
                displayName: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const actorUserMap = new Map(actorUsers.map((row) => [row.id, row]));
  const staffProfileMap = new Map(relatedStaffProfiles.map((row) => [row.id, row]));

  const totalPages = pageCount(metrics.auditRows, PAGE_SIZE);

  return (
    <AdminPage
      title="Audit"
      subtitle="Sensitive admin action log with actor, action, entity, timestamps, request metadata, and before/after summaries."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Audit rows" value={formatInt(metrics.auditRows)} meta={`Filtered HQ audit records in ${rangeLabel}`} />
        <MetricCard label="Unique actors" value={formatInt(metrics.uniqueActors)} meta="Distinct staff, user, or system actors" />
        <MetricCard label="Unique sessions" value={formatInt(metrics.uniqueSessions)} meta="Distinct admin session keys observed" />
        <MetricCard label="Unique IPs" value={formatInt(metrics.uniqueIps)} meta="Distinct request IPs observed" />
        <MetricCard label="Destructive" value={formatInt(metrics.destructive)} meta="Destructive actions in the filtered window" />
        <MetricCard label="Warnings" value={formatInt(metrics.warnings)} meta="Warning actions in the filtered window" />
        <MetricCard label="Info" value={formatInt(metrics.info)} meta="Informational actions in the filtered window" />
        <MetricCard label="Action types" value={formatInt(metrics.actionTypes)} meta="Distinct audit action identifiers" />
        <MetricCard label="Entities touched" value={formatInt(metrics.entitiesTouched)} meta="Distinct entity targets in the filtered window" />
        <MetricCard label="Changed records" value={formatInt(metrics.changedRecords)} meta="Rows with before or after state snapshots" />
        <MetricCard label="Cross-IP sessions" value={formatInt(metrics.crossIpSessions)} meta="Session keys reused across multiple IPs" />
        <MetricCard label="Repeat destructive actors" value={formatInt(metrics.repeatDestructiveActors)} meta="Actors with 2+ destructive actions" className="hq-cardRepeatDestructive" />
      </section>

      <Panel title="Audit log" subtitle="Actor, action, entity target, and request metadata for sensitive HQ activity.">
        <section className="hq-filterShell">
          <form className="hq-filterRail hq-filterRailAudit">
            <input type="hidden" name="range" value={range} />
            <input type="hidden" name="month" value={month || ""} />
            <label className="hq-filterField hq-filterFieldSearch">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <input className="hq-filterInput" type="search" name="q" placeholder="Search action, label, entity" defaultValue={q} aria-label="Search action, label, entity" />
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <input className="hq-filterInput" type="search" name="action" placeholder="Exact action id" defaultValue={action} aria-label="Exact action id" />
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="severity" defaultValue={severity} aria-label="Severity">
                <option value="">All severities</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="destructive">Destructive</option>
              </select>
            </label>
            <div className="hq-filterActions">
              <button className="hq-button" type="submit">Apply</button>
            </div>
          </form>
        </section>

        <div className="hq-tableWrap hq-tableWrapAudit">
          <table className="hq-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Entity</th>
                <th>Actor</th>
                <th>Request</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                (() => {
                  const actorUser = row.actorUserId ? actorUserMap.get(row.actorUserId) : null;
                  const actorStaff = row.actorStaffId ? staffProfileMap.get(row.actorStaffId) : null;
                  const entityStaff =
                    row.entityType === "staff_profile" && row.entityId
                      ? staffProfileMap.get(row.entityId)
                      : null;

                  const actorPrimary =
                    actorUser?.email ||
                    actorStaff?.user.email ||
                    row.actorUserId ||
                    row.actorStaffId ||
                    "System";

                  const entityPrimary =
                    row.entityType === "staff_profile"
                      ? (
                          entityStaff?.user.username
                            ? `@${entityStaff.user.username}`
                            : entityStaff?.user.email ||
                              entityStaff?.user.displayName ||
                              row.entityLabel ||
                              "Team member"
                        )
                      : row.entityLabel || row.entityId || formatAuditEntityTypeLabel(row.entityType);

                  const entitySecondaryParts =
                    row.entityType === "staff_profile"
                      ? [
                          formatShortStaffId(row.entityLabel) ||
                            formatShortStaffId(entityStaff?.staffCode) ||
                            null,
                        ]
                      : [
                          formatAuditEntityTypeLabel(row.entityType),
                          row.entityLabel && row.entityLabel !== entityPrimary ? row.entityLabel : row.entityId || null,
                        ];

                  const entitySecondary = entitySecondaryParts.filter(Boolean).join(" · ");

                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.actionLabel}</strong>
                        <span>{formatAuditActionMeta(row.action)}</span>
                      </td>
                      <td>
                        <strong>{entityPrimary}</strong>
                        <span>{entitySecondary || "No entity label"}</span>
                      </td>
                      <td>
                        <strong>{actorPrimary}</strong>
                        <span>{formatAuditSeverityLabel(row.severity)}</span>
                      </td>
                      <td>
                        <strong>{row.requestHost || "No host"}</strong>
                        <span>{row.ip || "No IP"} · {row.sessionKey || "No session key"}</span>
                      </td>
                      <td>
                        <strong>{formatDateTime(row.createdAt)}</strong>
                        <span>{row.userAgent || "No user agent"}</span>
                      </td>
                    </tr>
                  );
                })()
              ))}
            </tbody>
          </table>
        </div>
        <PaginationNav
          page={page}
          pageCount={totalPages}
          pathname="/audit"
          searchParams={props.searchParams || {}}
        />
      </Panel>
    </AdminPage>
  );
}
