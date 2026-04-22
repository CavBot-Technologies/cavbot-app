import {
  AdminPage,
  EmptyState,
  MetricCard,
  Panel,
} from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import { formatAdminDepartmentLabel, resolveAdminDepartment } from "@/lib/admin/access";
import {
  formatDateTime,
  formatInt,
  parseAdminMonth,
  parseAdminRange,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import {
  formatStaffLifecycleStateLabel,
  formatStaffStatusLabel,
  readStaffLifecycleState,
} from "@/lib/admin/staffDisplay";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function s(value: unknown) {
  return String(value || "").trim();
}

function displayStaffName(row: {
  user: {
    displayName: string | null;
    username: string | null;
    email: string;
  };
}) {
  return row.user.displayName || row.user.username || row.user.email;
}

function formatDepartmentToken(value: string) {
  const normalized = s(value).toUpperCase();
  if (
    normalized === "COMMAND"
    || normalized === "OPERATIONS"
    || normalized === "SECURITY"
    || normalized === "HUMAN_RESOURCES"
  ) {
    return formatAdminDepartmentLabel(normalized as Parameters<typeof formatAdminDepartmentLabel>[0]);
  }
  return value;
}

function extractLifecycleChanges(entry: {
  actionLabel: string;
  beforeJson: unknown;
  afterJson: unknown;
}) {
  const before = asRecord(entry.beforeJson);
  const after = asRecord(entry.afterJson);

  const beforeDepartment = s(before?.department);
  const afterDepartment = s(after?.department);
  if (beforeDepartment && afterDepartment && beforeDepartment !== afterDepartment) {
    return `Department move · ${formatDepartmentToken(beforeDepartment)} → ${formatDepartmentToken(afterDepartment)}`;
  }

  const beforeTitle = s(before?.positionTitle);
  const afterTitle = s(after?.positionTitle);
  if (beforeTitle && afterTitle && beforeTitle !== afterTitle) {
    return `Title change · ${beforeTitle} → ${afterTitle}`;
  }

  const beforeOnboarding = s(before?.onboardingStatus);
  const afterOnboarding = s(after?.onboardingStatus);
  if (beforeOnboarding && afterOnboarding && beforeOnboarding !== afterOnboarding) {
    return `Onboarding stage · ${beforeOnboarding} → ${afterOnboarding}`;
  }

  const beforeLifecycle = s(before?.lifecycleState);
  const afterLifecycle = s(after?.lifecycleState);
  if (beforeLifecycle && afterLifecycle && beforeLifecycle !== afterLifecycle) {
    return `Lifecycle · ${formatStaffLifecycleStateLabel(beforeLifecycle)} → ${formatStaffLifecycleStateLabel(afterLifecycle)}`;
  }

  return entry.actionLabel;
}

export default async function StaffLifecyclePage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAdminAccessFromRequestContext("/staff-lifecycle", { scopes: ["staff.read"] });
  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range);
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const start = window.start;
  const end = window.end;
  const now = new Date();

  const [staff, pendingInvites, recentLifecycleAudit] = await Promise.all([
    prisma.staffProfile.findMany({
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        staffCode: true,
        systemRole: true,
        scopes: true,
        positionTitle: true,
        status: true,
        onboardingStatus: true,
        metadataJson: true,
        updatedAt: true,
        user: {
          select: {
            email: true,
            username: true,
            displayName: true,
          },
        },
      },
    }),
    prisma.staffInvite.findMany({
      where: {
        status: "PENDING",
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        email: true,
        positionTitle: true,
        createdAt: true,
        expiresAt: true,
      },
    }),
    prisma.adminAuditLog.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        action: {
          in: [
            "STAFF_INVITED",
            "STAFF_PROFILE_UPDATED",
            "STAFF_SUSPENDED",
            "STAFF_RESTORED",
            "STAFF_REVOKED",
            "STAFF_ONBOARDING_REMINDER_SENT",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 18,
      select: {
        id: true,
        action: true,
        actionLabel: true,
        entityLabel: true,
        createdAt: true,
        beforeJson: true,
        afterJson: true,
      },
    }),
  ]);

  const lifecycleWatchlist = staff.filter((row) => {
    const lifecycleState = readStaffLifecycleState(row.metadataJson);
    return (
      lifecycleState !== "ACTIVE"
      || row.onboardingStatus !== "COMPLETED"
      || row.status === "SUSPENDED"
      || row.status === "INVITED"
    );
  });

  const leaveCount = staff.filter((row) => readStaffLifecycleState(row.metadataJson) === "LEAVE").length;
  const offboardingCount = staff.filter((row) => readStaffLifecycleState(row.metadataJson) === "OFFBOARDING").length;
  const suspendedCount = staff.filter((row) => row.status === "SUSPENDED").length;
  const readyCount = staff.filter((row) => row.onboardingStatus === "READY").length;
  const pendingCount = staff.filter((row) => row.onboardingStatus === "PENDING").length;

  const departmentMoveCount = recentLifecycleAudit.filter((entry) => {
    const before = asRecord(entry.beforeJson);
    const after = asRecord(entry.afterJson);
    return s(before?.department) && s(after?.department) && s(before?.department) !== s(after?.department);
  }).length;

  const titleChangeCount = recentLifecycleAudit.filter((entry) => {
    const before = asRecord(entry.beforeJson);
    const after = asRecord(entry.afterJson);
    return s(before?.positionTitle) && s(after?.positionTitle) && s(before?.positionTitle) !== s(after?.positionTitle);
  }).length;

  return (
    <AdminPage
      title="Team Lifecycle"
      subtitle="Onboarding, employment movement, department changes, leave, offboarding, and secure team readiness across HQ."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Pending invites" value={formatInt(pendingInvites.length)} meta="Offers still waiting for acceptance" />
        <MetricCard label="Pending onboarding" value={formatInt(pendingCount)} meta="Operators still blocked before readiness" />
        <MetricCard label="Ready onboarding" value={formatInt(readyCount)} meta="Operators ready to enter HQ" />
        <MetricCard label="On leave" value={formatInt(leaveCount)} meta="Lifecycle set to leave" />
        <MetricCard label="Offboarding" value={formatInt(offboardingCount)} meta="Operators moving through exit handling" />
        <MetricCard label="Suspended" value={formatInt(suspendedCount)} meta="Team access temporarily restricted" />
        <MetricCard label="Department moves" value={formatInt(departmentMoveCount)} meta={`Observed in ${window.label}`} />
        <MetricCard label="Title changes" value={formatInt(titleChangeCount)} meta={`Observed in ${window.label}`} />
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel title="Onboarding queue" subtitle="Pending offers plus operators who still need readiness work before full HQ use.">
          <div className="hq-list">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{invite.email}</div>
                  <div className="hq-listMeta">{invite.positionTitle} · invited {formatDateTime(invite.createdAt)} · expires {formatDateTime(invite.expiresAt)}</div>
                </div>
              </div>
            ))}
            {lifecycleWatchlist
              .filter((row) => row.onboardingStatus !== "COMPLETED" || row.status === "INVITED")
              .slice(0, 10)
              .map((row) => (
                <div key={row.id} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{displayStaffName(row)}</div>
                    <div className="hq-listMeta">
                      {formatAdminDepartmentLabel(resolveAdminDepartment(row))} · {row.positionTitle} · {formatStaffStatusLabel(row.status, row.metadataJson)} · {row.onboardingStatus}
                    </div>
                  </div>
                </div>
              ))}
            {!pendingInvites.length && !lifecycleWatchlist.some((row) => row.onboardingStatus !== "COMPLETED" || row.status === "INVITED") ? (
              <EmptyState title="Onboarding queue clear" subtitle="No pending invites or unfinished onboarding records are active right now." />
            ) : null}
          </div>
        </Panel>

        <Panel title="Lifecycle watchlist" subtitle="Team members currently on leave, offboarding, suspended, or otherwise needing HR and Command attention.">
          <div className="hq-list">
            {lifecycleWatchlist.slice(0, 12).map((row) => (
              <div key={row.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{displayStaffName(row)}</div>
                  <div className="hq-listMeta">
                    {formatStaffLifecycleStateLabel(readStaffLifecycleState(row.metadataJson))} · {formatStaffStatusLabel(row.status, row.metadataJson)} · {row.positionTitle} · updated {formatDateTime(row.updatedAt)}
                  </div>
                </div>
              </div>
            ))}
            {!lifecycleWatchlist.length ? (
              <EmptyState title="Lifecycle watchlist clear" subtitle="No team member is currently on leave, offboarding, suspended, or stuck in onboarding." />
            ) : null}
          </div>
        </Panel>
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel title="Recent lifecycle changes" subtitle="Latest operator movement across onboarding, lifecycle state, suspension, restoration, and revocation.">
          <div className="hq-list">
            {recentLifecycleAudit.map((entry) => (
              <div key={entry.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{extractLifecycleChanges(entry)}</div>
                  <div className="hq-listMeta">{entry.entityLabel || "operator"} · {formatDateTime(entry.createdAt)}</div>
                </div>
              </div>
            ))}
            {!recentLifecycleAudit.length ? (
              <EmptyState title="No lifecycle changes yet" subtitle="No team lifecycle audit entries were recorded inside the selected reporting window." />
            ) : null}
          </div>
        </Panel>

        <Panel title="Department placement" subtitle="Current team footprint by department for HR review and staffing balance.">
          <div className="hq-list">
            {(["COMMAND", "OPERATIONS", "SECURITY", "HUMAN_RESOURCES"] as const).map((department) => {
              const rows = staff.filter((row) => resolveAdminDepartment(row) === department);
              return (
                <div key={department} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{formatAdminDepartmentLabel(department)}</div>
                    <div className="hq-listMeta">{formatInt(rows.length)} operators · {formatInt(rows.filter((row) => row.onboardingStatus !== "COMPLETED").length)} still in onboarding</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </section>
    </AdminPage>
  );
}
