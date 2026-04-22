import "server-only";

import { randomBytes } from "crypto";
import type { AdminCasePriority, AdminCaseQueue, AdminCaseStatus, Prisma } from "@prisma/client";

import { createAdminNotification } from "@/lib/admin/notifications.server";
import { prisma } from "@/lib/prisma";
import { getAccountDisciplineMap, listAccountDisciplineStates } from "@/lib/admin/accountDiscipline.server";
import { getUserDisciplineMap, listUserDisciplineStates } from "@/lib/admin/userDiscipline.server";

function safeId(value: unknown) {
  return String(value || "").trim();
}

function safeText(value: unknown, max = 4000) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return null;
  return normalized.slice(0, Math.max(1, max));
}

function safeCaseQueue(value: unknown): AdminCaseQueue {
  const token = String(value || "").trim().toUpperCase();
  if (
    token === "BILLING_OPS"
    || token === "TRUST_AND_SAFETY"
    || token === "CUSTOMER_SUCCESS"
    || token === "BROADCASTS"
    || token === "APPROVALS"
    || token === "FOUNDER"
  ) {
    return token;
  }
  return "CUSTOMER_SUCCESS";
}

function safeCaseStatus(value: unknown): AdminCaseStatus {
  const token = String(value || "").trim().toUpperCase();
  if (token === "OPEN" || token === "IN_PROGRESS" || token === "PENDING_EXTERNAL" || token === "RESOLVED" || token === "CLOSED") {
    return token;
  }
  return "OPEN";
}

function safeCasePriority(value: unknown): AdminCasePriority {
  const token = String(value || "").trim().toUpperCase();
  if (token === "LOW" || token === "HIGH" || token === "CRITICAL") return token;
  return "MEDIUM";
}

function generateCaseCode() {
  return `CASE-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function ensureAdminCase(args: {
  queue: AdminCaseQueue;
  priority?: AdminCasePriority;
  status?: AdminCaseStatus;
  sourceKey?: string | null;
  subject: string;
  description?: string | null;
  accountId?: string | null;
  userId?: string | null;
  linkedThreadId?: string | null;
  linkedCampaignId?: string | null;
  assigneeStaffId?: string | null;
  assigneeUserId?: string | null;
  slaDueAt?: Date | null;
  meta?: Prisma.JsonObject | null;
}) {
  const sourceKey = safeId(args.sourceKey);
  const subject = safeText(args.subject, 180);
  if (!subject) return null;

  const data = {
    queue: args.queue,
    priority: args.priority || "MEDIUM",
    status: args.status || "OPEN",
    subject,
    description: safeText(args.description),
    accountId: safeId(args.accountId) || null,
    userId: safeId(args.userId) || null,
    linkedThreadId: safeId(args.linkedThreadId) || null,
    linkedCampaignId: safeId(args.linkedCampaignId) || null,
    assigneeStaffId: safeId(args.assigneeStaffId) || null,
    assigneeUserId: safeId(args.assigneeUserId) || null,
    slaDueAt: args.slaDueAt || null,
    metaJson: args.meta || undefined,
  };

  if (sourceKey) {
    return prisma.adminCase.upsert({
      where: { sourceKey },
      update: {
        ...data,
        sourceKey,
        status: args.status && (args.status === "RESOLVED" || args.status === "CLOSED")
          ? args.status
          : undefined,
      },
      create: {
        caseCode: generateCaseCode(),
        sourceKey,
        ...data,
      },
    });
  }

  return prisma.adminCase.create({
    data: {
      caseCode: generateCaseCode(),
      ...data,
    },
  });
}

export async function addAdminCaseNote(args: {
  caseId: string;
  authorStaffId?: string | null;
  authorUserId?: string | null;
  body: string;
  customerVisibleNote?: boolean;
  meta?: Prisma.JsonObject | null;
}) {
  const caseId = safeId(args.caseId);
  const body = safeText(args.body);
  if (!caseId || !body) return null;

  return prisma.adminCaseNote.create({
    data: {
      caseId,
      authorStaffId: safeId(args.authorStaffId) || null,
      authorUserId: safeId(args.authorUserId) || null,
      body,
      customerVisibleNote: Boolean(args.customerVisibleNote),
      metaJson: args.meta || undefined,
    },
  });
}

export async function listAdminCases(args: {
  queue?: string | null;
  status?: string | null;
  assigneeStaffId?: string | null;
  search?: string | null;
  take?: number;
}) {
  const search = safeText(args.search, 120);
  const queue = safeId(args.queue);
  const status = safeId(args.status);
  const assigneeStaffId = safeId(args.assigneeStaffId);

  return prisma.adminCase.findMany({
    where: {
      ...(queue ? { queue: safeCaseQueue(queue) } : {}),
      ...(status ? { status: safeCaseStatus(status) } : {}),
      ...(assigneeStaffId ? { assigneeStaffId } : {}),
      ...(search
        ? {
            OR: [
              { caseCode: { contains: search, mode: "insensitive" } },
              { subject: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      notes: {
        orderBy: { createdAt: "desc" },
        take: 6,
      },
    },
    orderBy: [
      { updatedAt: "desc" },
      { createdAt: "desc" },
    ],
    take: Math.max(1, Math.min(Number(args.take || 40), 100)),
  });
}

export async function updateAdminCase(args: {
  caseId: string;
  status?: string | null;
  priority?: string | null;
  queue?: string | null;
  assigneeStaffId?: string | null;
  assigneeUserId?: string | null;
  slaDueAt?: Date | null;
  outcome?: string | null;
  customerNotified?: boolean | null;
  note?: string | null;
  actorStaffId?: string | null;
}) {
  const caseId = safeId(args.caseId);
  if (!caseId) return null;
  const existing = await prisma.adminCase.findUnique({
    where: { id: caseId },
  });
  if (!existing) return null;

  const nextStatus = args.status ? safeCaseStatus(args.status) : existing.status;
  const nextAssigneeUserId = safeId(args.assigneeUserId) || null;
  const updated = await prisma.adminCase.update({
    where: { id: caseId },
    data: {
      status: nextStatus,
      priority: args.priority ? safeCasePriority(args.priority) : existing.priority,
      queue: args.queue ? safeCaseQueue(args.queue) : existing.queue,
      assigneeStaffId: args.assigneeStaffId === undefined ? existing.assigneeStaffId : (safeId(args.assigneeStaffId) || null),
      assigneeUserId: args.assigneeUserId === undefined ? existing.assigneeUserId : nextAssigneeUserId,
      slaDueAt: args.slaDueAt === undefined ? existing.slaDueAt : (args.slaDueAt || null),
      outcome: args.outcome === undefined ? existing.outcome : safeText(args.outcome),
      customerNotifiedAt: args.customerNotified
        ? existing.customerNotifiedAt || new Date()
        : args.customerNotified === false
          ? null
          : existing.customerNotifiedAt,
      resolvedAt: nextStatus === "RESOLVED" ? existing.resolvedAt || new Date() : nextStatus === "CLOSED" ? existing.resolvedAt || new Date() : null,
      closedAt: nextStatus === "CLOSED" ? existing.closedAt || new Date() : null,
    },
  });

  const note = safeText(args.note);
  if (note) {
    await addAdminCaseNote({
      caseId,
      authorStaffId: args.actorStaffId,
      body: note,
    });
  }

  if (nextAssigneeUserId && nextAssigneeUserId !== existing.assigneeUserId) {
    await createAdminNotification({
      userId: nextAssigneeUserId,
      title: `Assigned ${updated.caseCode}`,
      body: updated.subject,
      href: "/admin-internal/cases",
      kind: "HQ_CASE_ASSIGNED",
      tone: updated.priority === "CRITICAL" ? "BAD" : updated.priority === "HIGH" ? "WATCH" : "GOOD",
      meta: {
        caseId: updated.id,
        caseCode: updated.caseCode,
      },
    });
  }

  return updated;
}

export async function syncOperationalCasesFromSignals() {
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const [
    pastDueAccounts,
    pendingAccessRequests,
    unresolvedNotices,
    unreadSignals,
    expiringTrials,
    broadcastFailures,
    activeAccountDisciplineRows,
    activeUserDisciplineRows,
  ] = await Promise.all([
    prisma.account.findMany({
      where: {
        subscriptions: {
          some: { status: "PAST_DUE" },
        },
      },
      select: { id: true, name: true },
    }),
    prisma.workspaceAccessRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        accountId: true,
        requesterUserId: true,
        createdAt: true,
      },
    }),
    prisma.workspaceNotice.findMany({
      where: {
        dismissedAt: null,
        tone: { in: ["WATCH", "BAD"] },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        accountId: true,
        title: true,
        tone: true,
        createdAt: true,
      },
    }),
    prisma.notification.findMany({
      where: {
        readAt: null,
        tone: { in: ["WATCH", "BAD"] },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        userId: true,
        accountId: true,
        title: true,
        tone: true,
        createdAt: true,
      },
    }),
    prisma.account.findMany({
      where: {
        trialSeatActive: true,
        trialEndsAt: { lte: soon },
      },
      select: {
        id: true,
        name: true,
        trialEndsAt: true,
      },
    }),
    prisma.adminBroadcastDelivery.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        campaignId: true,
        recipientUserId: true,
        errorMessage: true,
      },
    }),
    listAccountDisciplineStates({
      statuses: ["SUSPENDED", "REVOKED"],
      take: 200,
    }),
    listUserDisciplineStates({
      statuses: ["SUSPENDED", "REVOKED"],
      take: 200,
    }),
  ]);

  const accountDisciplineMap = await getAccountDisciplineMap(activeAccountDisciplineRows.map((row) => row.accountId));
  const userDisciplineMap = await getUserDisciplineMap(activeUserDisciplineRows.map((row) => row.userId));

  await Promise.all([
    ...pastDueAccounts.map((account) =>
      ensureAdminCase({
        queue: "BILLING_OPS",
        priority: "HIGH",
        sourceKey: `billing:past_due:${account.id}`,
        subject: `${account.name} is past due`,
        accountId: account.id,
        description: "Subscription is currently marked PAST_DUE and needs operator billing intervention.",
        slaDueAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
        meta: { signal: "past_due" },
      })),
    ...pendingAccessRequests.map((request) =>
      ensureAdminCase({
        queue: "CUSTOMER_SUCCESS",
        priority: "MEDIUM",
        sourceKey: `workspace_access:${request.id}`,
        subject: "Pending workspace access request",
        accountId: request.accountId,
        userId: request.requesterUserId,
        description: "A workspace access request is still pending operator review.",
        slaDueAt: new Date(request.createdAt.getTime() + 24 * 60 * 60 * 1000),
        meta: { signal: "workspace_access_request" },
      })),
    ...unresolvedNotices.map((notice) =>
      ensureAdminCase({
        queue: "CUSTOMER_SUCCESS",
        priority: notice.tone === "BAD" ? "HIGH" : "MEDIUM",
        sourceKey: `workspace_notice:${notice.id}`,
        subject: notice.title,
        accountId: notice.accountId,
        description: "Workspace notice is still unresolved and needs operator follow-up.",
        meta: { signal: "workspace_notice", tone: notice.tone },
      })),
    ...unreadSignals.map((notification) =>
      ensureAdminCase({
        queue: "CUSTOMER_SUCCESS",
        priority: notification.tone === "BAD" ? "HIGH" : "MEDIUM",
        sourceKey: `notification_signal:${notification.id}`,
        subject: notification.title,
        accountId: notification.accountId,
        userId: notification.userId,
        description: "Unread WATCH/BAD notification is still outstanding.",
        meta: { signal: "notification" },
      })),
    ...expiringTrials.map((account) =>
      ensureAdminCase({
        queue: "BILLING_OPS",
        priority: "MEDIUM",
        sourceKey: `trial_expiring:${account.id}`,
        subject: `${account.name} trial expires soon`,
        accountId: account.id,
        description: "Trial workspace is inside the three-day intervention window.",
        slaDueAt: account.trialEndsAt || undefined,
        meta: { signal: "trial_expiring" },
      })),
    ...broadcastFailures.map((delivery) =>
      ensureAdminCase({
        queue: "BROADCASTS",
        priority: "HIGH",
        sourceKey: `broadcast_failure:${delivery.campaignId}`,
        subject: "Broadcast delivery failure",
        userId: delivery.recipientUserId,
        linkedCampaignId: delivery.campaignId,
        description: delivery.errorMessage || "A broadcast delivery failed and needs retry or investigation.",
        meta: { signal: "broadcast_failure" },
      })),
    ...Array.from(accountDisciplineMap.values()).map((state) =>
      ensureAdminCase({
        queue: "TRUST_AND_SAFETY",
        priority: state.status === "REVOKED" ? "CRITICAL" : "HIGH",
        sourceKey: `account_discipline:${state.accountId}`,
        subject: `Account discipline: ${state.status}`,
        accountId: state.accountId,
        description: state.note || "Account discipline is active and requires Trust & Safety visibility.",
        meta: { signal: "account_discipline", status: state.status },
      })),
    ...Array.from(userDisciplineMap.values()).map((state) =>
      ensureAdminCase({
        queue: "TRUST_AND_SAFETY",
        priority: state.status === "REVOKED" ? "CRITICAL" : "HIGH",
        sourceKey: `user_discipline:${state.userId}`,
        subject: `User discipline: ${state.status}`,
        userId: state.userId,
        description: state.note || "User discipline is active and requires Trust & Safety visibility.",
        meta: { signal: "user_discipline", status: state.status },
      })),
  ]);
}
