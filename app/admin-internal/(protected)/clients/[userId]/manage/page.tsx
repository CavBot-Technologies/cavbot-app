import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AdminPage,
  AvatarBadge,
  Badge,
  KeyValueGrid,
  Panel,
} from "@/components/admin/AdminPrimitives";
import { UserActionCenter } from "@/components/admin/OperationalActionCenter";
import { getUserActionCenterData } from "@/lib/admin/operations.server";
import { formatAdminPlanName, formatDateTime } from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatDisciplineStatus(value?: string | null) {
  const status = String(value || "").trim().toUpperCase();
  if (status === "SUSPENDED") return "Suspended";
  if (status === "REVOKED") return "Revoked";
  return "Active";
}

function disciplineTone(value?: string | null) {
  const status = String(value || "").trim().toUpperCase();
  if (status === "REVOKED") return "bad" as const;
  if (status === "SUSPENDED") return "watch" as const;
  return "good" as const;
}

export default async function ClientManagePage({ params }: { params: { userId: string } }) {
  await requireAdminAccessFromRequestContext(`/clients/${params.userId}/manage`, { scopes: ["customers.write"] });

  const [user, actionCenterData] = await Promise.all([
    prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        fullName: true,
        avatarImage: true,
        avatarTone: true,
        createdAt: true,
        lastLoginAt: true,
      },
    }),
    getUserActionCenterData(params.userId),
  ]);

  if (!user || !actionCenterData) notFound();

  const displayName = user.displayName || user.fullName || user.username || user.email;
  const leadMembership = actionCenterData.memberships[0] || null;
  const actionCenter = JSON.parse(JSON.stringify({
    userId: actionCenterData.user.id,
    displayName: actionCenterData.user.displayName || actionCenterData.user.fullName || actionCenterData.user.username || actionCenterData.user.email,
    discipline: actionCenterData.discipline,
    notes: actionCenterData.notes,
    cases: actionCenterData.cases,
    memberships: actionCenterData.memberships,
  }));
  const summaryItems = [
    { label: "Trust status", value: formatDisciplineStatus(actionCenterData.discipline?.status) },
    { label: "Violations", value: String(actionCenterData.discipline?.violationCount || 0) },
    { label: "Memberships", value: String(actionCenterData.memberships.length) },
    { label: "Open cases", value: String(actionCenterData.cases.length) },
    { label: "Saved notes", value: String(actionCenterData.notes.length) },
    { label: "Primary tier", value: leadMembership ? formatAdminPlanName(leadMembership.account.tier) : "No active plan" },
  ];

  return (
    <AdminPage
      title={`Manage ${displayName}`}
      subtitle="Trust actions, recovery, membership overrides, and internal notes for this client identity."
      actions={(
        <Link href={`/clients/${params.userId}`} className="hq-buttonGhost">
          Full dossier
        </Link>
      )}
      chips={
        <>
          {leadMembership ? <Badge tone="watch">{formatAdminPlanName(leadMembership.account.tier)}</Badge> : null}
          <Badge tone={disciplineTone(actionCenterData.discipline?.status)}>{formatDisciplineStatus(actionCenterData.discipline?.status)}</Badge>
        </>
      }
    >
      <section className="hq-grid hq-gridTwo hq-manageIntroGrid">
        <Panel title="Manage overview" subtitle="Identity and workspace context for the client you are operating on.">
          <div className="hq-inlineStart hq-manageIdentityHead">
            <AvatarBadge
              name={displayName}
              email={user.email}
              image={user.avatarImage}
              tone={user.avatarTone}
            />
            <div>
              <div className="hq-cardTitle">{displayName}</div>
              <p className="hq-sectionLead">{user.email}</p>
            </div>
          </div>
          <div className="hq-manageIdentitySpacer" />
          <KeyValueGrid
            items={[
              { label: "Username", value: user.username ? `@${user.username}` : "Not set" },
              { label: "Joined", value: formatDateTime(user.createdAt) },
              { label: "Last active", value: formatDateTime(user.lastLoginAt) },
              { label: "Primary account", value: leadMembership?.account.name || "No workspace membership" },
              { label: "Primary tier", value: leadMembership ? formatAdminPlanName(leadMembership.account.tier) : "No active plan" },
              { label: "Memberships", value: String(actionCenterData.memberships.length) },
            ]}
          />
        </Panel>

        <Panel title="Operational posture" subtitle="Live trust, membership, and case context before you run client controls.">
          <KeyValueGrid items={summaryItems} />
        </Panel>
      </section>

      <UserActionCenter {...actionCenter} />
    </AdminPage>
  );
}
