import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AdminPage,
  Badge,
  KeyValueGrid,
  Panel,
} from "@/components/admin/AdminPrimitives";
import { AccountActionCenter } from "@/components/admin/OperationalActionCenter";
import { getAccountActionCenterData } from "@/lib/admin/operations.server";
import {
  formatAdminSubscriptionLabel,
  formatDate,
  formatDateTime,
  formatUserName,
  resolveAdminPlanDisplay,
} from "@/lib/admin/server";
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

export default async function AccountManagePage({ params }: { params: { accountId: string } }) {
  await requireAdminAccessFromRequestContext(`/accounts/${params.accountId}/manage`, { scopes: ["accounts.write"] });

  const [account, subscription, actionCenterData] = await Promise.all([
    prisma.account.findUnique({
      where: { id: params.accountId },
      select: {
        id: true,
        name: true,
        tier: true,
        billingEmail: true,
        trialSeatActive: true,
        trialEndsAt: true,
        updatedAt: true,
        members: {
          where: { role: "OWNER" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            user: {
              select: {
                email: true,
                username: true,
                displayName: true,
                fullName: true,
              },
            },
          },
        },
      },
    }),
    prisma.subscription.findFirst({
      where: { accountId: params.accountId },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        tier: true,
        currentPeriodEnd: true,
      },
    }),
    getAccountActionCenterData(params.accountId),
  ]);

  if (!account || !actionCenterData) notFound();

  const owner = account.members[0]?.user || null;
  const { planLabel } = resolveAdminPlanDisplay({
    tier: account.tier,
    status: subscription?.status,
    subscriptionTier: subscription?.tier,
    currentPeriodEnd: subscription?.currentPeriodEnd,
    trialSeatActive: account.trialSeatActive,
    trialEndsAt: account.trialEndsAt,
  });
  const subscriptionLabel = formatAdminSubscriptionLabel({
    status: subscription?.status,
    tier: account.tier,
    subscriptionTier: subscription?.tier,
    currentPeriodEnd: subscription?.currentPeriodEnd,
    trialSeatActive: account.trialSeatActive,
    trialEndsAt: account.trialEndsAt,
  });
  const actionCenter = JSON.parse(JSON.stringify({
    accountId: actionCenterData.account.id,
    accountName: actionCenterData.account.name,
    discipline: actionCenterData.discipline,
    notes: actionCenterData.notes,
    cases: actionCenterData.cases,
    billingAdjustments: actionCenterData.billingAdjustments,
    members: actionCenterData.account.members,
  }));
  const summaryItems = [
    { label: "Trust status", value: formatDisciplineStatus(actionCenterData.discipline?.status) },
    { label: "Violations", value: String(actionCenterData.discipline?.violationCount || 0) },
    { label: "Open cases", value: String(actionCenterData.cases.length) },
    { label: "Saved notes", value: String(actionCenterData.notes.length) },
    { label: "Billing actions", value: String(actionCenterData.billingAdjustments.length) },
    { label: "Members", value: String(actionCenterData.account.members.length) },
  ];

  return (
    <AdminPage
      title={`Manage ${formatUserName(owner, account.name)}`}
      subtitle="Workspace operations, trust actions, plan changes, billing adjustments, and customer handling."
      actions={(
        <Link href={`/accounts/${params.accountId}`} className="hq-buttonGhost">
          Full dossier
        </Link>
      )}
      chips={
        <>
          <Badge tone={planLabel === "Trialing" ? "watch" : "good"}>{planLabel}</Badge>
          {subscriptionLabel !== planLabel ? <Badge tone="watch">{subscriptionLabel}</Badge> : null}
          <Badge tone={disciplineTone(actionCenterData.discipline?.status)}>{formatDisciplineStatus(actionCenterData.discipline?.status)}</Badge>
        </>
      }
    >
      <section className="hq-grid hq-gridTwo hq-manageIntroGrid">
        <Panel title="Manage overview" subtitle="Identity and billing context for the workspace you are operating on.">
          <KeyValueGrid
            items={[
              { label: "Workspace", value: account.name },
              { label: "Owner", value: formatUserName(owner, account.name) },
              { label: "Plan", value: planLabel },
              { label: "Subscription", value: subscriptionLabel },
              { label: "Billing email", value: account.billingEmail || "Not set" },
              {
                label: "Trial",
                value: planLabel === "Trialing"
                  ? `Active until ${formatDate(account.trialEndsAt || subscription?.currentPeriodEnd)}`
                  : "No active trial",
              },
              { label: "Current period end", value: formatDate(subscription?.currentPeriodEnd) },
              { label: "Updated", value: formatDateTime(account.updatedAt) },
            ]}
          />
        </Panel>

        <Panel title="Operational posture" subtitle="Live management context before you touch trust, billing, and customer controls.">
          <KeyValueGrid items={summaryItems} />
        </Panel>
      </section>

      <AccountActionCenter {...actionCenter} />
    </AdminPage>
  );
}
