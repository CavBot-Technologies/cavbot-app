import {
  AdminPage,
  AvatarBadge,
  Badge,
  KeyValueGrid,
  Panel,
} from "@/components/admin/AdminPrimitives";
import { formatAdminDepartmentLabel, getAdminExtraScopes, resolveAdminDepartment } from "@/lib/admin/access";
import { formatDateTime } from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { hasAdminScope } from "@/lib/admin/permissions";
import {
  formatStaffLifecycleStateLabel,
  formatStaffStatusLabel,
  isProtectedStaffIdentity,
  readStaffLifecycleState,
  readStaffSuspendedUntil,
  resolveDisplayStaffStatus,
} from "@/lib/admin/staffDisplay";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function StaffDetailPage({ params }: { params: { staffId: string } }) {
  const ctx = await requireAdminAccessFromRequestContext(`/staff/${params.staffId}`, { scopes: ["staff.read"] });

  const staff = await prisma.staffProfile.findUnique({
    where: { id: params.staffId },
    select: {
      id: true,
      userId: true,
      staffCode: true,
      systemRole: true,
      positionTitle: true,
      status: true,
      onboardingStatus: true,
      scopes: true,
      notes: true,
      invitedEmail: true,
      metadataJson: true,
      createdAt: true,
      updatedAt: true,
      lastAdminLoginAt: true,
      lastAdminStepUpAt: true,
      user: {
        select: {
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
  });

  if (!staff) notFound();

  const audit = await prisma.adminAuditLog.findMany({
    where: {
      OR: [
        { actorStaffId: staff.id },
        { entityId: staff.id },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  const showFullStaffId = ctx.staff.systemRole === "OWNER" && ctx.staff.staffCode === staff.staffCode;
  const department = resolveAdminDepartment(staff);
  const extraScopes = getAdminExtraScopes(staff.scopes, department);
  const displayStatus = resolveDisplayStaffStatus(staff.status, staff.metadataJson);
  const canManageOperator = hasAdminScope(ctx.staff, "staff.write") && displayStatus !== "REVOKED" && !isProtectedStaffIdentity({
    staffCode: staff.staffCode,
    systemRole: staff.systemRole,
    email: staff.user.email,
    username: staff.user.username,
    name: staff.user.displayName || staff.user.username || staff.user.email,
  });

  return (
    <AdminPage
      title={staff.user.displayName || staff.user.username || staff.user.email}
      subtitle="Full team dossier for identity, access posture, onboarding state, and audit history."
      actions={(
        <Link href={`/staff/${params.staffId}/manage`} className="hq-buttonGhost">
          Manage
        </Link>
      )}
      chips={
        <>
          <Badge tone={department === "COMMAND" ? "good" : "watch"}>{formatAdminDepartmentLabel(department)}</Badge>
          <Badge tone={staff.status === "ACTIVE" ? "good" : staff.status === "INVITED" ? "watch" : "bad"}>{formatStaffStatusLabel(staff.status, staff.metadataJson)}</Badge>
        </>
      }
    >
      <section className="hq-detailGrid">
        <div className="hq-stack">
          <Panel title="Team identity" subtitle="Linked CavBot user identity and team authorization record.">
            <div className="hq-inlineStart">
              <AvatarBadge name={staff.user.displayName || staff.user.username || staff.user.email} email={staff.user.email} image={staff.user.avatarImage} tone={staff.user.avatarTone} />
              <div>
                <div className="hq-cardTitle">{staff.user.displayName || staff.user.username || staff.user.email}</div>
                <p className="hq-sectionLead">{staff.user.email}</p>
              </div>
            </div>
            <div style={{ height: 16 }} />
            <KeyValueGrid
              items={[
                { label: "Masked team ID", value: `•••• ${staff.staffCode.slice(-4)}` },
                { label: "Full owner ID", value: showFullStaffId ? staff.staffCode : "Owner-only staff identity view" },
                { label: "Department", value: formatAdminDepartmentLabel(department) },
                { label: "Position", value: staff.positionTitle },
                { label: "Status", value: formatStaffStatusLabel(staff.status, staff.metadataJson) },
                { label: "Onboarding", value: staff.onboardingStatus },
                { label: "Lifecycle", value: formatStaffLifecycleStateLabel(readStaffLifecycleState(staff.metadataJson)) },
                { label: "Suspended until", value: formatDateTime(readStaffSuspendedUntil(staff.metadataJson)) },
                { label: "Last admin login", value: formatDateTime(staff.lastAdminLoginAt) },
                { label: "Last step-up", value: formatDateTime(staff.lastAdminStepUpAt) },
                { label: "Linked user created", value: formatDateTime(staff.user.createdAt) },
                { label: "Last CavBot login", value: formatDateTime(staff.user.lastLoginAt) },
              ]}
            />
          </Panel>

          <Panel title="Permissions and notes" subtitle="Department presets drive access, and only true overrides show up separately here.">
            <KeyValueGrid
              items={[
                { label: "Extra scopes", value: extraScopes.length ? extraScopes.join(", ") : "Department preset only" },
                { label: "Invited email", value: staff.invitedEmail || staff.user.email },
                { label: "Notes", value: staff.notes || "No internal notes saved" },
                { label: "Updated", value: formatDateTime(staff.updatedAt) },
              ]}
            />
          </Panel>
        </div>

        <div className="hq-stack">
          <Panel
            title="Management handoff"
            subtitle="Run lifecycle, placement, onboarding, and access controls from the dedicated manage surface."
            actions={(
              <Link href={`/staff/${params.staffId}/manage`} className="hq-buttonGhost">
                Manage
              </Link>
            )}
          >
            <KeyValueGrid
              items={[
                { label: "Management posture", value: canManageOperator ? "Ready for management" : "Protected / read-only" },
                { label: "Access", value: formatStaffStatusLabel(staff.status, staff.metadataJson) },
                { label: "Onboarding", value: staff.onboardingStatus },
                { label: "Lifecycle", value: formatStaffLifecycleStateLabel(readStaffLifecycleState(staff.metadataJson)) },
                { label: "Suspended until", value: formatDateTime(readStaffSuspendedUntil(staff.metadataJson)) },
              ]}
            />
          </Panel>

          <Panel title="Audit history" subtitle="Recent team-specific audit records and sensitive admin actions.">
            <div className="hq-list">
              {audit.map((entry) => (
                <div key={entry.id} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{entry.actionLabel}</div>
                    <div className="hq-listMeta">{formatDateTime(entry.createdAt)} · {entry.entityLabel || entry.action}</div>
                  </div>
                  <Badge tone={entry.severity === "destructive" ? "bad" : entry.severity === "warning" ? "watch" : "good"}>
                    {entry.action}
                  </Badge>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </section>
    </AdminPage>
  );
}
