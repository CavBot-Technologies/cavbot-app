import {
  AdminPage,
  EmptyState,
  MetricCard,
  Panel,
} from "@/components/admin/AdminPrimitives";
import { StaffDirectoryGrid, type StaffDirectoryCardData } from "@/components/admin/StaffDirectoryGrid";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import { StaffInvitePanel } from "@/components/admin/StaffInvitePanel";
import {
  ADMIN_DEPARTMENT_OPTIONS,
  formatAdminDepartmentLabel,
  getAdminExtraScopes,
  resolveAdminDepartment,
} from "@/lib/admin/access";
import { hasAdminScope } from "@/lib/admin/permissions";
import { isPrimaryCavBotAdminIdentity, pinPrimaryItemFirst } from "@/lib/admin/pinning";
import { formatDateTime, formatInt, parseAdminMonth, parseAdminRange, resolveAdminWindow } from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import {
  formatStaffLifecycleStateLabel,
  formatStaffStatusLabel,
  isProtectedStaffIdentity,
  readStaffLifecycleState,
  readStaffSuspendedUntil,
  resolveDisplayStaffStatus,
} from "@/lib/admin/staffDisplay";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function s(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function resolveStaffStatusTone(value: string | null | undefined): "good" | "watch" | "bad" {
  switch (String(value || "").trim().toUpperCase()) {
    case "ACTIVE":
    case "COMPLETED":
      return "good";
    case "INVITED":
    case "READY":
    case "PENDING":
      return "watch";
    default:
      return "bad";
  }
}

export default async function StaffPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireAdminAccessFromRequestContext("/staff", { scopes: ["staff.read"] });
  const q = s(props.searchParams?.q).trim();
  const department = s(props.searchParams?.department).trim().toUpperCase();
  const status = s(props.searchParams?.status).trim().toUpperCase();
  const onboarding = s(props.searchParams?.onboarding).trim().toUpperCase();
  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range);
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;

  const [staff, invites, recentAudit] = await Promise.all([
    prisma.staffProfile.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        staffCode: true,
        systemRole: true,
        scopes: true,
        positionTitle: true,
        status: true,
        onboardingStatus: true,
        notes: true,
        invitedEmail: true,
        metadataJson: true,
        createdAt: true,
        updatedAt: true,
        lastAdminLoginAt: true,
        lastAdminStepUpAt: true,
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            avatarImage: true,
            avatarTone: true,
            createdAt: true,
            lastLoginAt: true,
          },
        },
      },
    }),
    prisma.staffInvite.findMany({
      where: {
        status: "PENDING",
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        email: true,
        systemRole: true,
        positionTitle: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
    prisma.adminAuditLog.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        action: {
          in: ["STAFF_INVITED", "STAFF_PROFILE_UPDATED", "STAFF_SIGNED_IN", "STAFF_ADMIN_STEP_UP_SENT"],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  const departmentCounts = {
    COMMAND: 0,
    OPERATIONS: 0,
    SECURITY: 0,
    HUMAN_RESOURCES: 0,
  } satisfies Record<"COMMAND" | "OPERATIONS" | "SECURITY" | "HUMAN_RESOURCES", number>;

  for (const row of staff) {
    departmentCounts[resolveAdminDepartment(row)] += 1;
  }

  const canManageStaff = hasAdminScope(ctx.staff, "staff.write");
  const staffWithDisplayStatus = staff.map((row) => ({
    ...row,
    displayStatus: resolveDisplayStaffStatus(row.status, row.metadataJson),
    suspendedUntil: readStaffSuspendedUntil(row.metadataJson),
  }));

  const normalizedQuery = q.toLowerCase();
  const filteredStaff = staffWithDisplayStatus.filter((row) => {
    const rowDepartment = resolveAdminDepartment(row);
    if (department && rowDepartment !== department) return false;
    if (status === "REVOKED" && row.displayStatus !== "REVOKED") return false;
    if (status && status !== "REVOKED" && row.displayStatus !== status) return false;
    if (onboarding && row.onboardingStatus !== onboarding) return false;
    if (!normalizedQuery) return true;

    const searchHaystack = [
      row.user.displayName,
      row.user.email,
      row.user.username ? `@${row.user.username}` : "",
      row.positionTitle,
      row.staffCode,
      formatAdminDepartmentLabel(rowDepartment),
    ]
      .join(" ")
      .toLowerCase();

    return searchHaystack.includes(normalizedQuery);
  });

  const prioritizedStaff = pinPrimaryItemFirst(filteredStaff, (row) =>
    isPrimaryCavBotAdminIdentity({
      email: row.user.email,
      username: row.user.username,
      name: row.user.displayName || row.user.username || row.user.email,
    }),
  );

  const filteredStaffCards: StaffDirectoryCardData[] = prioritizedStaff.map((row) => {
    const displayName = row.user.displayName || row.user.username || row.user.email;
    const departmentValue = resolveAdminDepartment(row);
    const departmentLabel = formatAdminDepartmentLabel(departmentValue);
    const extraScopes = getAdminExtraScopes(row.scopes, departmentValue);
    const statusLabel = formatStaffStatusLabel(row.status, row.metadataJson);
    const onboardingLabel = formatStaffStatusLabel(row.onboardingStatus);
    const managementLocked = isProtectedStaffIdentity({
      staffCode: row.staffCode,
      systemRole: row.systemRole,
      email: row.user.email,
      username: row.user.username,
      name: displayName,
    });
    const manageable = canManageStaff && !managementLocked && row.displayStatus !== "REVOKED";

    return {
      id: row.id,
      name: displayName,
      email: row.user.email,
      positionLabel: row.positionTitle || "Operator",
      statusLabel,
      statusValue: row.displayStatus,
      statusTone: resolveStaffStatusTone(row.displayStatus),
      onboardingLabel,
      onboardingValue: row.onboardingStatus,
      onboardingTone: resolveStaffStatusTone(row.onboardingStatus),
      lifecycleStateLabel: formatStaffLifecycleStateLabel(readStaffLifecycleState(row.metadataJson)),
      lifecycleStateValue: readStaffLifecycleState(row.metadataJson),
      departmentLabel,
      departmentValue,
      departmentTone: departmentValue === "COMMAND" ? "good" : "watch",
      systemRoleValue: row.systemRole,
      usernameLabel: row.user.username ? `@${row.user.username}` : "—",
      fullStaffCodeLabel: row.staffCode,
      maskedStaffCode: `•••• ${row.staffCode.slice(-4)}`,
      shortStaffCodeLabel: row.staffCode.slice(-4),
      lastAdminLoginLabel: formatDateTime(row.lastAdminLoginAt),
      lastStepUpLabel: formatDateTime(row.lastAdminStepUpAt),
      linkedUserCreatedLabel: formatDateTime(row.user.createdAt),
      lastCavBotLoginLabel: formatDateTime(row.user.lastLoginAt),
      invitedEmailLabel: row.invitedEmail || row.user.email,
      invitedEmailValue: row.invitedEmail || row.user.email,
      extraScopesLabel: extraScopes.length ? extraScopes.join(", ") : "Department preset only",
      overrideCountLabel: formatInt(extraScopes.length),
      notesLabel: row.notes || "No internal notes saved",
      notesValue: row.notes,
      updatedLabel: formatDateTime(row.updatedAt),
      suspendedUntilLabel: row.suspendedUntil ? formatDateTime(row.suspendedUntil) : "—",
      avatarImage: row.user.avatarImage,
      avatarTone: row.user.avatarTone,
      detailHref: `/staff/${row.id}`,
      manageable,
      canSendAccessReminder: row.displayStatus !== "REVOKED" && row.onboardingStatus !== "COMPLETED",
      managementLockedLabel: managementLocked ? "Protected CavBot team record" : row.displayStatus === "REVOKED" ? "Revoked team records cannot be managed." : null,
    };
  });

  return (
    <AdminPage
      title="Team"
      subtitle="Internal team directory, operator onboarding queue, departments, positions, readiness, and recent sensitive activity."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Total operators" value={formatInt(staff.length)} meta="Persisted internal operator profiles" />
        <MetricCard label="Active operators" value={formatInt(staffWithDisplayStatus.filter((row) => row.displayStatus === "ACTIVE").length)} meta="Can access admin surfaces" />
        <MetricCard label="In onboarding" value={formatInt(invites.length)} meta={`Operator onboarding queue in ${rangeLabel}`} />
        <MetricCard label="Suspended / revoked" value={formatInt(staffWithDisplayStatus.filter((row) => row.displayStatus === "SUSPENDED" || row.displayStatus === "REVOKED").length)} meta="Restricted operator access" />
        <MetricCard label="Command" value={formatInt(departmentCounts.COMMAND)} meta="Operators with command clearance" />
        <MetricCard label="Operations" value={formatInt(departmentCounts.OPERATIONS)} meta="Operators assigned to operations" />
        <MetricCard label="Security" value={formatInt(departmentCounts.SECURITY)} meta="Operators assigned to security" />
        <MetricCard label="Human Resources" value={formatInt(departmentCounts.HUMAN_RESOURCES)} meta="Operators assigned to HR" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel title="Onboard operator" subtitle="Set up access for existing CavBot accounts or queue onboarding for future operators.">
          <StaffInvitePanel />
        </Panel>

        <Panel title="Recent sensitive activity" subtitle="Latest operator-related audit entries inside CavBot HQ.">
          <div className="hq-list">
            {recentAudit.map((entry) => (
              <div key={entry.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{entry.actionLabel}</div>
                  <div className="hq-listMeta">{formatDateTime(entry.createdAt)} · {entry.entityLabel || "operator"}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <Panel title="Team directory" subtitle="Review team usernames, positions, access, onboarding, and last admin activity.">
        <section className="hq-filterShell">
          <form className="hq-filterRail">
            <input type="hidden" name="range" value={range} />
            <input type="hidden" name="month" value={month || ""} />
            <label className="hq-filterField hq-filterFieldSearch">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <input className="hq-filterInput" type="search" name="q" placeholder="Search name, email, username, position" defaultValue={q} aria-label="Operator search" />
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="department" defaultValue={department} aria-label="Department">
                <option value="">All departments</option>
                {ADMIN_DEPARTMENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="status" defaultValue={status} aria-label="Status">
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INVITED">Invited</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="REVOKED">Revoked</option>
              </select>
            </label>
            <label className="hq-filterField">
              <span className="hq-filterLabel" aria-hidden="true">&nbsp;</span>
              <select className="hq-filterSelect" name="onboarding" defaultValue={onboarding} aria-label="Onboarding">
                <option value="">All onboarding states</option>
                <option value="PENDING">Pending</option>
                <option value="READY">Ready</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </label>
            <div className="hq-filterActions">
              <button className="hq-button" type="submit">Apply</button>
            </div>
          </form>
        </section>

        {filteredStaffCards.length ? (
          <StaffDirectoryGrid staff={filteredStaffCards} />
        ) : (
          <EmptyState title="No operators match these filters." subtitle="Adjust the search, department, status, or onboarding filters to widen the team directory." />
        )}
      </Panel>
    </AdminPage>
  );
}
