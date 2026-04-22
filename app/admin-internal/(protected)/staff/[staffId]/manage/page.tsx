import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AdminPage,
  AvatarBadge,
  Badge,
  KeyValueGrid,
  Panel,
} from "@/components/admin/AdminPrimitives";
import { TeamActionCenter } from "@/components/admin/TeamActionCenter";
import { formatAdminDepartmentLabel, getAdminExtraScopes, resolveAdminDepartment } from "@/lib/admin/access";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { hasAdminScope } from "@/lib/admin/permissions";
import { formatDateTime } from "@/lib/admin/server";
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

function disciplineTone(value?: string | null) {
  const status = String(value || "").trim().toUpperCase();
  if (status === "REVOKED") return "bad" as const;
  if (status === "SUSPENDED") return "watch" as const;
  return "good" as const;
}

export default async function StaffManagePage({ params }: { params: { staffId: string } }) {
  const ctx = await requireAdminAccessFromRequestContext(`/staff/${params.staffId}/manage`, { scopes: ["staff.write"] });

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

  const displayName = staff.user.displayName || staff.user.username || staff.user.email;
  const department = resolveAdminDepartment(staff);
  const departmentLabel = formatAdminDepartmentLabel(department);
  const extraScopes = getAdminExtraScopes(staff.scopes, department);
  const lifecycleState = readStaffLifecycleState(staff.metadataJson);
  const suspendedUntil = readStaffSuspendedUntil(staff.metadataJson);
  const displayStatus = resolveDisplayStaffStatus(staff.status, staff.metadataJson);
  const protectedTeamRecord = isProtectedStaffIdentity({
    staffCode: staff.staffCode,
    systemRole: staff.systemRole,
    email: staff.user.email,
    username: staff.user.username,
    name: displayName,
  });
  const canManageOperator = hasAdminScope(ctx.staff, "staff.write") && !protectedTeamRecord && displayStatus !== "REVOKED";
  const managementLockedLabel = protectedTeamRecord
    ? "Protected CavBot team record"
    : displayStatus === "REVOKED"
      ? "Revoked team records are read-only."
      : null;

  return (
    <AdminPage
      title={`Manage ${displayName}`}
      subtitle="Team placement, lifecycle, onboarding, and access controls for this operator record."
      actions={(
        <Link href={`/staff/${params.staffId}`} className="hq-buttonGhost">
          Full dossier
        </Link>
      )}
      chips={(
        <>
          <Badge tone={department === "COMMAND" ? "good" : "watch"}>{departmentLabel}</Badge>
          <Badge tone={disciplineTone(displayStatus)}>{formatStaffStatusLabel(staff.status, staff.metadataJson)}</Badge>
        </>
      )}
    >
      <section className="hq-grid hq-gridTwo hq-manageIntroGrid">
        <Panel title="Manage overview" subtitle="Identity and access context for the team record you are operating on.">
          <div className="hq-inlineStart hq-manageIdentityHead">
            <AvatarBadge
              name={displayName}
              email={staff.user.email}
              image={staff.user.avatarImage}
              tone={staff.user.avatarTone}
            />
            <div>
              <div className="hq-cardTitle">{displayName}</div>
              <p className="hq-sectionLead">{staff.user.email}</p>
            </div>
          </div>
          <div className="hq-manageIdentitySpacer" />
          <KeyValueGrid
            items={[
              { label: "Masked team ID", value: `•••• ${staff.staffCode.slice(-4)}` },
              { label: "Department", value: departmentLabel },
              { label: "Title", value: staff.positionTitle || "Operator" },
              { label: "Username", value: staff.user.username ? `@${staff.user.username}` : "Not set" },
              { label: "Mailbox", value: staff.invitedEmail || staff.user.email },
              { label: "Extra scopes", value: extraScopes.length ? extraScopes.join(", ") : "Department preset only" },
              { label: "Updated", value: formatDateTime(staff.updatedAt) },
            ]}
          />
        </Panel>

        <Panel title="Operational posture" subtitle="Live status and readiness context before you run team controls.">
          <KeyValueGrid
            items={[
              { label: "Access", value: formatStaffStatusLabel(staff.status, staff.metadataJson) },
              { label: "Onboarding", value: formatStaffStatusLabel(staff.onboardingStatus) },
              { label: "Lifecycle", value: formatStaffLifecycleStateLabel(lifecycleState) },
              { label: "Suspended until", value: formatDateTime(suspendedUntil) },
              { label: "Last admin login", value: formatDateTime(staff.lastAdminLoginAt) },
              { label: "Last step-up", value: formatDateTime(staff.lastAdminStepUpAt) },
              { label: "Linked user created", value: formatDateTime(staff.user.createdAt) },
              { label: "Last CavBot login", value: formatDateTime(staff.user.lastLoginAt) },
            ]}
          />
        </Panel>
      </section>

      <TeamActionCenter
        staffId={staff.id}
        displayName={displayName}
        maskedTeamCode={`•••• ${staff.staffCode.slice(-4)}`}
        department={department}
        departmentLabel={departmentLabel}
        status={displayStatus}
        statusLabel={formatStaffStatusLabel(staff.status, staff.metadataJson)}
        onboardingStatus={staff.onboardingStatus}
        onboardingLabel={formatStaffStatusLabel(staff.onboardingStatus)}
        lifecycleState={lifecycleState}
        lifecycleLabel={formatStaffLifecycleStateLabel(lifecycleState)}
        positionTitle={staff.positionTitle || "Operator"}
        notes={staff.notes}
        invitedEmail={staff.invitedEmail || staff.user.email}
        suspendedUntilLabel={formatDateTime(suspendedUntil)}
        canSendAccessReminder={displayStatus !== "REVOKED" && staff.onboardingStatus !== "COMPLETED"}
        manageable={canManageOperator}
        managementLockedLabel={managementLockedLabel}
      />
    </AdminPage>
  );
}
