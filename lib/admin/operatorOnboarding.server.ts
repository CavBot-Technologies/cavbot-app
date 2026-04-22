import "server-only";

import type { Prisma } from "@prisma/client";

import type { AdminDepartment } from "@/lib/admin/access";
import { formatAdminDepartmentLabel, normalizeAdminDepartment } from "@/lib/admin/access";
import { HQ_NOTIFICATION_KINDS } from "@/lib/notificationKinds";
import { prisma } from "@/lib/prisma";

type NotificationTone = "GOOD" | "WATCH" | "BAD";

function s(value: unknown) {
  return String(value ?? "").trim();
}

function truncateText(raw: unknown, max = 220) {
  const value = s(raw);
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function maskOperatorId(staffCode: string) {
  const suffix = s(staffCode).slice(-4);
  return suffix ? `•••• ${suffix}` : "••••";
}

type OperatorInviteMeta = {
  department: AdminDepartment;
  notificationId: string | null;
  notificationAcceptRequired: boolean;
};

function toJsonMeta(meta: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(meta)) as Prisma.JsonObject;
}

export function readOperatorInviteMeta(meta: unknown): OperatorInviteMeta {
  const row = meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};

  return {
    department: normalizeAdminDepartment(row.department),
    notificationId: s(row.notificationId) || null,
    notificationAcceptRequired: row.notificationAcceptRequired === true || s(row.onboardingFlow) === "notification",
  };
}

export function buildOperatorInviteMeta(args: {
  inviteId: string;
  department: AdminDepartment;
  positionTitle: string;
  expiresAt: Date;
  message?: string | null;
  notificationId?: string | null;
}) {
  return {
    entityType: "staff_invite",
    entityId: args.inviteId,
    inviteId: args.inviteId,
    department: args.department,
    positionTitle: args.positionTitle,
    expiresAtISO: args.expiresAt.toISOString(),
    onboardingFlow: "notification",
    notificationAcceptRequired: true,
    notificationId: s(args.notificationId) || null,
    message: args.message ? truncateText(args.message, 220) : null,
    actions: {
      accept: {
        label: "Accept offer",
        href: "/api/admin/staff/invites/accept",
        method: "POST",
        body: {
          inviteId: args.inviteId,
        },
      },
    },
  };
}

async function createNotification(args: {
  userId: string;
  title: string;
  body?: string | null;
  kind: string;
  tone?: NotificationTone;
  meta?: Prisma.JsonObject | null;
}) {
  const userId = s(args.userId);
  const title = truncateText(args.title, 120);
  const body = truncateText(args.body || "", 320) || null;
  const kind = truncateText(args.kind || "GENERIC", 64) || "GENERIC";
  if (!userId || !title) return null;

  const notification = await prisma.notification.create({
    data: {
      userId,
      accountId: null,
      title,
      body,
      kind,
      tone: args.tone || "GOOD",
      metaJson: args.meta || undefined,
    },
    select: { id: true },
  });

  return notification.id;
}

export async function createOperatorOfferNotification(args: {
  userId: string;
  inviteId: string;
  department: AdminDepartment;
  positionTitle: string;
  expiresAt: Date;
  message?: string | null;
}) {
  const departmentLabel = formatAdminDepartmentLabel(args.department);
  const positionTitle = truncateText(args.positionTitle || "Operator", 120) || "Operator";
  const note = truncateText(args.message || "", 120);
  const base = `CavBot HQ wants to onboard you to ${departmentLabel} as ${positionTitle}. Accept within 14 days to activate HQ access.`;
  const body = note ? `${base} Note: ${note}` : base;
  const meta = buildOperatorInviteMeta(args);

  return createNotification({
    userId: args.userId,
    title: "You have a CavBot HQ operator offer",
    body,
    kind: HQ_NOTIFICATION_KINDS.OPERATOR_INVITE_RECEIVED,
    tone: "WATCH",
    meta: toJsonMeta(meta),
  });
}

export async function markOperatorOfferAccepted(args: {
  notificationId?: string | null;
  userId: string;
  inviteId: string;
  staffCode: string;
}) {
  const notificationId = s(args.notificationId);
  if (!notificationId) return;

  await prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId: s(args.userId),
    },
    data: {
      title: "Operator offer accepted",
      body: "Your CavBot HQ onboarding is complete.",
      kind: HQ_NOTIFICATION_KINDS.OPERATOR_INVITE_ACCEPTED,
      tone: "GOOD",
      metaJson: toJsonMeta({
        entityType: "staff_invite",
        entityId: args.inviteId,
        inviteId: args.inviteId,
        staffCodeMasked: maskOperatorId(args.staffCode),
        onboardingFlow: "notification",
        stage: "accepted",
      }),
    },
  });
}

export async function createOperatorIdReadyNotification(args: {
  userId: string;
  staffId: string;
  staffCode: string;
  department?: AdminDepartment | null;
  positionTitle?: string | null;
  title?: string | null;
  body?: string | null;
}) {
  const positionTitle = truncateText(args.positionTitle || "", 120);
  const title = truncateText(args.title || "You have successfully been onboarded", 120) || "You have successfully been onboarded";
  const body = truncateText(args.body || "Click to view your staff ID.", 320) || "Click to view your staff ID.";

  return createNotification({
    userId: args.userId,
    title,
    body,
    kind: HQ_NOTIFICATION_KINDS.OPERATOR_ID_READY,
    tone: "GOOD",
    meta: toJsonMeta({
      entityType: "staff_profile",
      entityId: s(args.staffId),
      revealType: "staff_id",
      ...(args.department
        ? {
            department: args.department,
            departmentLabel: formatAdminDepartmentLabel(args.department),
          }
        : {}),
      ...(positionTitle ? { positionTitle } : {}),
      staffCodeMasked: maskOperatorId(args.staffCode),
    }),
  });
}
