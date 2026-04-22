import "server-only";

import type { MemberRole, PlanTier, Prisma, SubscriptionStatus } from "@prisma/client";

import {
  getAccountDisciplineState,
  restoreAccount,
  revokeAccount,
  suspendAccount,
} from "@/lib/admin/accountDiscipline.server";
import { ensureAdminCase, listAdminCases } from "@/lib/admin/cases.server";
import { createAdminEntityNote, listAdminEntityNotes, type AdminMutationPayload, writeAdminOperationalAudit } from "@/lib/admin/hqMutations.server";
import { createAdminNotification } from "@/lib/admin/notifications.server";
import {
  getUserDisciplineState,
  killUserSessions,
  recordUserIdentityReview,
  resetUserRecovery,
  restoreUser,
  revokeUser,
  suspendUser,
} from "@/lib/admin/userDiscipline.server";
import { prisma } from "@/lib/prisma";
import { sendAdHocSignupWelcomeEmail } from "@/lib/signupWelcomeEmail.server";
import { createWorkspaceInvite } from "@/lib/workspaceTeam.server";

type Actor = {
  staffId: string;
  userId: string;
};

function safeId(value: unknown) {
  return String(value || "").trim();
}

function safeText(value: unknown, max = 4000) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return null;
  return normalized.slice(0, Math.max(1, max));
}

function safeDurationDays(value: unknown) {
  const parsed = Number(value);
  if (parsed === 7 || parsed === 14 || parsed === 30) return parsed as 7 | 14 | 30;
  return null;
}

function safePlanTier(value: unknown): PlanTier {
  const token = String(value || "").trim().toUpperCase();
  if (token === "PREMIUM") return "PREMIUM";
  if (token === "PREMIUM_PLUS" || token === "ENTERPRISE") return "ENTERPRISE";
  return "FREE";
}

function safeSubscriptionStatus(value: unknown): SubscriptionStatus {
  const token = String(value || "").trim().toUpperCase();
  if (token === "TRIALING" || token === "PAST_DUE" || token === "CANCELED") return token;
  return "ACTIVE";
}

function safeMemberRole(value: unknown): MemberRole {
  const token = String(value || "").trim().toUpperCase();
  if (token === "OWNER" || token === "ADMIN") return token;
  return "MEMBER";
}

function safeInviteRole(value: unknown): "ADMIN" | "MEMBER" {
  return safeMemberRole(value) === "ADMIN" ? "ADMIN" : "MEMBER";
}

function safeMeta(value: unknown): Prisma.JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.JsonObject;
  } catch {
    return undefined;
  }
}

async function notifyAccountOwners(args: {
  accountId: string;
  title: string;
  body: string;
  href?: string | null;
  kind: string;
  meta?: Prisma.JsonObject | null;
}) {
  const owners = await prisma.membership.findMany({
    where: {
      accountId: args.accountId,
      role: { in: ["OWNER", "ADMIN"] },
    },
    select: {
      userId: true,
    },
  });

  for (const owner of owners) {
    await createAdminNotification({
      userId: owner.userId,
      accountId: args.accountId,
      title: args.title,
      body: args.body,
      href: args.href || "/notifications",
      kind: args.kind,
      tone: "WATCH",
      meta: args.meta || undefined,
    });
  }
}

async function notifyUser(userId: string, args: { title: string; body: string; href?: string | null; kind: string; meta?: Prisma.JsonObject | null }) {
  await createAdminNotification({
    userId,
    title: args.title,
    body: args.body,
    href: args.href || "/notifications",
    kind: args.kind,
    tone: "WATCH",
    meta: args.meta || undefined,
  });
}

async function writeMutationNote(args: {
  entityType: string;
  entityId: string;
  actor: Actor;
  payload: AdminMutationPayload;
}) {
  const noteBody = args.payload.customerVisibleNote || args.payload.reason;
  if (!noteBody) return null;
  return createAdminEntityNote({
    entityType: args.entityType,
    entityId: args.entityId,
    authorStaffId: args.actor.staffId,
    authorUserId: args.actor.userId,
    body: noteBody,
    customerVisibleNote: Boolean(args.payload.customerVisibleNote),
    caseId: args.payload.caseId,
    meta: safeMeta(args.payload.meta),
  });
}

async function updateMembershipRole(args: {
  membershipId: string;
  role: MemberRole;
}) {
  const membership = await prisma.membership.findUnique({
    where: { id: args.membershipId },
  });
  if (!membership) throw new Error("MEMBERSHIP_NOT_FOUND");

  if (membership.role === "OWNER" && args.role !== "OWNER") {
    const ownerCount = await prisma.membership.count({
      where: {
        accountId: membership.accountId,
        role: "OWNER",
      },
    });
    if (ownerCount <= 1) throw new Error("LAST_OWNER");
  }

  return prisma.membership.update({
    where: { id: membership.id },
    data: { role: args.role },
  });
}

async function removeMembership(membershipId: string) {
  const membership = await prisma.membership.findUnique({
    where: { id: membershipId },
  });
  if (!membership) throw new Error("MEMBERSHIP_NOT_FOUND");

  if (membership.role === "OWNER") {
    const ownerCount = await prisma.membership.count({
      where: {
        accountId: membership.accountId,
        role: "OWNER",
      },
    });
    if (ownerCount <= 1) throw new Error("LAST_OWNER");
  }

  await prisma.membership.delete({
    where: { id: membership.id },
  });
  return membership;
}

export async function getAccountActionCenterData(accountIdInput: string) {
  const accountId = safeId(accountIdInput);
  if (!accountId) return null;

  const [account, subscription, discipline, notes, cases, billingAdjustments] = await Promise.all([
    prisma.account.findUnique({
      where: { id: accountId },
      include: {
        members: {
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
          include: {
            user: {
              select: {
                id: true,
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
      where: { accountId },
      orderBy: { updatedAt: "desc" },
    }),
    getAccountDisciplineState(accountId),
    listAdminEntityNotes({ entityType: "account", entityId: accountId, take: 12 }),
    listAdminCases({ take: 12 }).then((rows) => rows.filter((row) => row.accountId === accountId)),
    prisma.adminBillingAdjustment.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  if (!account) return null;
  return {
    account,
    subscription,
    discipline,
    notes,
    cases,
    billingAdjustments,
  };
}

export async function getUserActionCenterData(userIdInput: string) {
  const userId = safeId(userIdInput);
  if (!userId) return null;

  const [user, discipline, notes, cases, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        fullName: true,
        lastLoginAt: true,
      },
    }),
    getUserDisciplineState(userId),
    listAdminEntityNotes({ entityType: "user", entityId: userId, take: 12 }),
    listAdminCases({ take: 12 }).then((rows) => rows.filter((row) => row.userId === userId)),
    prisma.membership.findMany({
      where: { userId },
      include: {
        account: {
          select: {
            id: true,
            name: true,
            tier: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!user) return null;
  return {
    user,
    discipline,
    notes,
    cases,
    memberships,
  };
}

export async function performAccountAction(args: {
  actor: Actor;
  request?: Request | null;
  accountId: string;
  action: string;
  payload: AdminMutationPayload;
  input: Record<string, unknown>;
}) {
  const accountId = safeId(args.accountId);
  const action = safeId(args.action).toLowerCase();
  if (!accountId || !action) throw new Error("ACCOUNT_ACTION_REQUIRED");

  const existing = await prisma.account.findUnique({
    where: { id: accountId },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              displayName: true,
            },
          },
        },
      },
    },
  });
  if (!existing) throw new Error("ACCOUNT_NOT_FOUND");

  if (action === "suspend") {
    const before = await getAccountDisciplineState(accountId);
    const durationDays = safeDurationDays(args.input.durationDays);
    if (!durationDays) throw new Error("BAD_DURATION");
    const result = await suspendAccount({
      accountId,
      actorStaffId: args.actor.staffId,
      durationDays,
      note: args.payload.reason,
    });
    await writeMutationNote({ entityType: "account", entityId: accountId, actor: args.actor, payload: args.payload });
    const caseRow = await ensureAdminCase({
      queue: "TRUST_AND_SAFETY",
      priority: result.escalatedToRevoke ? "CRITICAL" : "HIGH",
      subject: `${existing.name} ${result.escalatedToRevoke ? "revoked" : "suspended"}`,
      accountId,
      description: args.payload.reason,
      sourceKey: `account_discipline:${accountId}`,
    });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: result.escalatedToRevoke ? "ACCOUNT_REVOKED" : "ACCOUNT_SUSPENDED",
      actionLabel: result.escalatedToRevoke ? "Account revoked" : "Account suspended",
      entityType: "account",
      entityId: accountId,
      entityLabel: existing.name,
      severity: result.escalatedToRevoke ? "destructive" : "warning",
      before: { discipline: before },
      after: { discipline: result.state },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: caseRow?.id || args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    if (args.payload.notifySubject) {
      await notifyAccountOwners({
        accountId,
        title: result.escalatedToRevoke ? "Account revoked" : "Account suspended",
        body: args.payload.customerVisibleNote || args.payload.reason || "A workspace trust action was applied.",
        href: "/notifications",
        kind: "HQ_ACCOUNT_ACTION",
        meta: { action, accountId },
      });
    }
    return result.state;
  }

  if (action === "restore") {
    const before = await getAccountDisciplineState(accountId);
    const state = await restoreAccount({
      accountId,
      actorStaffId: args.actor.staffId,
      note: args.payload.reason,
    });
    await writeMutationNote({ entityType: "account", entityId: accountId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "ACCOUNT_RESTORED",
      actionLabel: "Account restored",
      entityType: "account",
      entityId: accountId,
      entityLabel: existing.name,
      before: { discipline: before },
      after: { discipline: state },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return state;
  }

  if (action === "revoke") {
    const before = await getAccountDisciplineState(accountId);
    const state = await revokeAccount({
      accountId,
      actorStaffId: args.actor.staffId,
      note: args.payload.reason,
    });
    await writeMutationNote({ entityType: "account", entityId: accountId, actor: args.actor, payload: args.payload });
    const caseRow = await ensureAdminCase({
      queue: "TRUST_AND_SAFETY",
      priority: "CRITICAL",
      subject: `${existing.name} revoked`,
      accountId,
      description: args.payload.reason,
      sourceKey: `account_discipline:${accountId}`,
    });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "ACCOUNT_REVOKED",
      actionLabel: "Account revoked",
      entityType: "account",
      entityId: accountId,
      entityLabel: existing.name,
      severity: "destructive",
      before: { discipline: before },
      after: { discipline: state },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: caseRow?.id || args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return state;
  }

  if (action === "extend_trial") {
    const durationDays = safeDurationDays(args.input.durationDays) || 14;
    const now = new Date();
    const currentEnd = existing.trialEndsAt && existing.trialEndsAt > now ? existing.trialEndsAt : now;
    const nextEnd = new Date(currentEnd.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const updated = await prisma.account.update({
      where: { id: accountId },
      data: {
        trialSeatActive: true,
        trialStartedAt: existing.trialStartedAt || now,
        trialEndsAt: nextEnd,
        trialEverUsed: true,
      },
    });
    await prisma.adminBillingAdjustment.create({
      data: {
        accountId,
        kind: "TRIAL_EXTENSION",
        reason: args.payload.reason || `Trial extended by ${durationDays} days`,
        note: args.payload.customerVisibleNote,
        createdByStaffId: args.actor.staffId,
        createdByUserId: args.actor.userId,
      },
    });
    await writeMutationNote({ entityType: "account", entityId: accountId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "ACCOUNT_TRIAL_EXTENDED",
      actionLabel: "Account trial extended",
      entityType: "account",
      entityId: accountId,
      entityLabel: existing.name,
      before: { trialEndsAt: existing.trialEndsAt?.toISOString() || null },
      after: { trialEndsAt: updated.trialEndsAt?.toISOString() || null, durationDays },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return updated;
  }

  if (action === "change_plan") {
    const planTier = safePlanTier(args.input.planTier);
    const subscriptionStatus = safeSubscriptionStatus(args.input.subscriptionStatus);
    const updatedAccount = await prisma.account.update({
      where: { id: accountId },
      data: {
        tier: planTier,
        lastUpgradePlanId: planTier,
        lastUpgradeAt: new Date(),
      },
    });
    const updatedSubscription = await prisma.subscription.upsert({
      where: {
        id: safeId(args.input.subscriptionId) || `hq-plan-${accountId}`,
      },
      update: {
        accountId,
        tier: planTier,
        status: planTier === "FREE" ? "CANCELED" : subscriptionStatus,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      create: {
        id: safeId(args.input.subscriptionId) || `hq-plan-${accountId}`,
        accountId,
        tier: planTier,
        status: planTier === "FREE" ? "CANCELED" : subscriptionStatus,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.adminBillingAdjustment.create({
      data: {
        accountId,
        kind: "PLAN_OVERRIDE",
        reason: args.payload.reason || `Plan updated to ${planTier}`,
        note: args.payload.customerVisibleNote,
        createdByStaffId: args.actor.staffId,
        createdByUserId: args.actor.userId,
        metaJson: {
          subscriptionId: updatedSubscription.id,
          subscriptionStatus: updatedSubscription.status,
        },
      },
    });
    await writeMutationNote({ entityType: "account", entityId: accountId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "ACCOUNT_PLAN_CHANGED",
      actionLabel: "Account plan changed",
      entityType: "account",
      entityId: accountId,
      entityLabel: existing.name,
      before: { tier: existing.tier },
      after: { tier: updatedAccount.tier, subscriptionStatus: updatedSubscription.status },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return { account: updatedAccount, subscription: updatedSubscription };
  }

  if (action === "apply_credit" || action === "apply_comp") {
    const amountCents = Math.max(0, Number(args.input.amountCents || 0));
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error("BAD_AMOUNT");
    const adjustment = await prisma.adminBillingAdjustment.create({
      data: {
        accountId,
        kind: action === "apply_comp" ? "COMP" : "CREDIT",
        amountCents,
        currency: "USD",
        reason: args.payload.reason || (action === "apply_comp" ? "Comp applied" : "Credit applied"),
        note: args.payload.customerVisibleNote,
        createdByStaffId: args.actor.staffId,
        createdByUserId: args.actor.userId,
      },
    });
    await writeMutationNote({ entityType: "account", entityId: accountId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: action === "apply_comp" ? "ACCOUNT_COMP_APPLIED" : "ACCOUNT_CREDIT_APPLIED",
      actionLabel: action === "apply_comp" ? "Account comp applied" : "Account credit applied",
      entityType: "account",
      entityId: accountId,
      entityLabel: existing.name,
      after: { amountCents, kind: adjustment.kind },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return adjustment;
  }

  if (action === "resend_onboarding") {
    const recipientEmails = Array.from(new Set(existing.members.map((member) => member.user.email).filter(Boolean)));
    const deliveries = [];
    for (const email of recipientEmails) {
      deliveries.push(await sendAdHocSignupWelcomeEmail(email));
    }
    await writeMutationNote({ entityType: "account", entityId: accountId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "ACCOUNT_ONBOARDING_RESENT",
      actionLabel: "Account onboarding resent",
      entityType: "account",
      entityId: accountId,
      entityLabel: existing.name,
      after: { recipients: recipientEmails.length },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: {
        deliveries,
        ...(args.payload.meta || {}),
      },
    });
    return { recipientEmails, deliveries };
  }

  if (action === "add_member") {
    const invite = await createWorkspaceInvite({
      accountId,
      inviterUserId: args.actor.userId,
      role: safeInviteRole(args.input.role),
      inviteeUserId: safeId(args.input.userId) || null,
      inviteeEmail: safeText(args.input.email, 320),
    });
    if (!invite.ok) throw new Error(invite.error);
    await writeMutationNote({ entityType: "account", entityId: accountId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "ACCOUNT_MEMBER_ADDED",
      actionLabel: "Account member invited",
      entityType: "account",
      entityId: accountId,
      entityLabel: existing.name,
      after: { inviteId: invite.invite.id, role: invite.invite.role, inviteeEmail: invite.invite.inviteeEmail },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return invite;
  }

  if (action === "update_member") {
    const membershipId = safeId(args.input.membershipId);
    if (!membershipId) throw new Error("MEMBERSHIP_REQUIRED");
    const updated = await updateMembershipRole({
      membershipId,
      role: safeMemberRole(args.input.role),
    });
    await writeMutationNote({ entityType: "account", entityId: accountId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "ACCOUNT_MEMBER_ROLE_UPDATED",
      actionLabel: "Account member role updated",
      entityType: "account",
      entityId: accountId,
      entityLabel: existing.name,
      after: { membershipId, role: updated.role },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return updated;
  }

  if (action === "remove_member") {
    const membershipId = safeId(args.input.membershipId);
    if (!membershipId) throw new Error("MEMBERSHIP_REQUIRED");
    const removed = await removeMembership(membershipId);
    await writeMutationNote({ entityType: "account", entityId: accountId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "ACCOUNT_MEMBER_REMOVED",
      actionLabel: "Account member removed",
      entityType: "account",
      entityId: accountId,
      entityLabel: existing.name,
      after: { membershipId, userId: removed.userId },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return removed;
  }

  if (action === "note") {
    const note = await createAdminEntityNote({
      entityType: "account",
      entityId: accountId,
      authorStaffId: args.actor.staffId,
      authorUserId: args.actor.userId,
      body: args.payload.reason || args.payload.customerVisibleNote || "Internal note",
      caseId: args.payload.caseId,
      customerVisibleNote: Boolean(args.payload.customerVisibleNote),
      meta: safeMeta(args.payload.meta),
    });
    return note;
  }

  throw new Error("ACCOUNT_ACTION_UNSUPPORTED");
}

export async function performUserAction(args: {
  actor: Actor;
  request?: Request | null;
  userId: string;
  action: string;
  payload: AdminMutationPayload;
  input: Record<string, unknown>;
}) {
  const userId = safeId(args.userId);
  const action = safeId(args.action).toLowerCase();
  if (!userId || !action) throw new Error("USER_ACTION_REQUIRED");

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      fullName: true,
    },
  });
  if (!existing) throw new Error("USER_NOT_FOUND");
  const displayLabel = existing.displayName || existing.fullName || existing.username || existing.email;

  if (action === "suspend") {
    const durationDays = safeDurationDays(args.input.durationDays);
    if (!durationDays) throw new Error("BAD_DURATION");
    const before = await getUserDisciplineState(userId);
    const result = await suspendUser({
      userId,
      actorStaffId: args.actor.staffId,
      durationDays,
      note: args.payload.reason,
    });
    await writeMutationNote({ entityType: "user", entityId: userId, actor: args.actor, payload: args.payload });
    const caseRow = await ensureAdminCase({
      queue: "TRUST_AND_SAFETY",
      priority: result.escalatedToRevoke ? "CRITICAL" : "HIGH",
      subject: `${displayLabel} ${result.escalatedToRevoke ? "revoked" : "suspended"}`,
      userId,
      description: args.payload.reason,
      sourceKey: `user_discipline:${userId}`,
    });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: result.escalatedToRevoke ? "USER_REVOKED" : "USER_SUSPENDED",
      actionLabel: result.escalatedToRevoke ? "User revoked" : "User suspended",
      entityType: "user",
      entityId: userId,
      entityLabel: displayLabel,
      severity: result.escalatedToRevoke ? "destructive" : "warning",
      before: { discipline: before },
      after: { discipline: result.state },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: caseRow?.id || args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    if (args.payload.notifySubject) {
      await notifyUser(userId, {
        title: result.escalatedToRevoke ? "Account access revoked" : "Account access suspended",
        body: args.payload.customerVisibleNote || args.payload.reason || "A trust action was applied to your CavBot access.",
        kind: "HQ_USER_ACTION",
        meta: { action, userId },
      });
    }
    return result.state;
  }

  if (action === "restore") {
    const before = await getUserDisciplineState(userId);
    const state = await restoreUser({
      userId,
      actorStaffId: args.actor.staffId,
      note: args.payload.reason,
    });
    await writeMutationNote({ entityType: "user", entityId: userId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "USER_RESTORED",
      actionLabel: "User restored",
      entityType: "user",
      entityId: userId,
      entityLabel: displayLabel,
      before: { discipline: before },
      after: { discipline: state },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return state;
  }

  if (action === "revoke") {
    const before = await getUserDisciplineState(userId);
    const state = await revokeUser({
      userId,
      actorStaffId: args.actor.staffId,
      note: args.payload.reason,
    });
    await writeMutationNote({ entityType: "user", entityId: userId, actor: args.actor, payload: args.payload });
    const caseRow = await ensureAdminCase({
      queue: "TRUST_AND_SAFETY",
      priority: "CRITICAL",
      subject: `${displayLabel} revoked`,
      userId,
      description: args.payload.reason,
      sourceKey: `user_discipline:${userId}`,
    });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "USER_REVOKED",
      actionLabel: "User revoked",
      entityType: "user",
      entityId: userId,
      entityLabel: displayLabel,
      severity: "destructive",
      before: { discipline: before },
      after: { discipline: state },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: caseRow?.id || args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return state;
  }

  if (action === "identity_review") {
    const state = await recordUserIdentityReview({
      userId,
      actorStaffId: args.actor.staffId,
      outcome: safeText(args.input.outcome, 80) || "reviewed",
      note: args.payload.reason,
    });
    await writeMutationNote({ entityType: "user", entityId: userId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "USER_IDENTITY_REVIEWED",
      actionLabel: "User identity reviewed",
      entityType: "user",
      entityId: userId,
      entityLabel: displayLabel,
      after: { discipline: state, outcome: safeText(args.input.outcome, 80) },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return state;
  }

  if (action === "reset_recovery") {
    const state = await resetUserRecovery({
      userId,
      actorStaffId: args.actor.staffId,
      note: args.payload.reason,
    });
    await writeMutationNote({ entityType: "user", entityId: userId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "USER_RECOVERY_RESET",
      actionLabel: "User recovery reset",
      entityType: "user",
      entityId: userId,
      entityLabel: displayLabel,
      after: { discipline: state },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return state;
  }

  if (action === "kill_sessions") {
    const state = await killUserSessions({
      userId,
      actorStaffId: args.actor.staffId,
    });
    await writeMutationNote({ entityType: "user", entityId: userId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "USER_SESSIONS_KILLED",
      actionLabel: "User sessions killed",
      entityType: "user",
      entityId: userId,
      entityLabel: displayLabel,
      after: { discipline: state },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return state;
  }

  if (action === "membership_override") {
    const membershipId = safeId(args.input.membershipId);
    if (!membershipId) throw new Error("MEMBERSHIP_REQUIRED");
    const updated = await updateMembershipRole({
      membershipId,
      role: safeMemberRole(args.input.role),
    });
    await writeMutationNote({ entityType: "user", entityId: userId, actor: args.actor, payload: args.payload });
    await writeAdminOperationalAudit({
      actorStaffId: args.actor.staffId,
      actorUserId: args.actor.userId,
      action: "USER_MEMBERSHIP_OVERRIDDEN",
      actionLabel: "User membership overridden",
      entityType: "user",
      entityId: userId,
      entityLabel: displayLabel,
      after: { membershipId, role: updated.role },
      reason: args.payload.reason,
      notifySubject: args.payload.notifySubject,
      caseId: args.payload.caseId,
      request: args.request,
      meta: args.payload.meta || undefined,
    });
    return updated;
  }

  if (action === "note") {
    return createAdminEntityNote({
      entityType: "user",
      entityId: userId,
      authorStaffId: args.actor.staffId,
      authorUserId: args.actor.userId,
      body: args.payload.reason || args.payload.customerVisibleNote || "Internal note",
      caseId: args.payload.caseId,
      customerVisibleNote: Boolean(args.payload.customerVisibleNote),
      meta: safeMeta(args.payload.meta),
    });
  }

  throw new Error("USER_ACTION_UNSUPPORTED");
}
