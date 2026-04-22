import "server-only";

import type { AuditSeverity, Prisma } from "@prisma/client";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { prisma } from "@/lib/prisma";

export type AdminMutationPayload = {
  action: string;
  reason: string | null;
  notifySubject: boolean;
  caseId: string | null;
  customerVisibleNote: string | null;
  meta: Record<string, unknown> | null;
};

function safeId(value: unknown) {
  return String(value || "").trim();
}

function safeText(value: unknown, max = 2000) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return null;
  return normalized.slice(0, Math.max(1, max));
}

function safeMeta(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readAdminMutationPayload(input: Record<string, unknown> | null | undefined): AdminMutationPayload {
  return {
    action: safeId(input?.action),
    reason: safeText(input?.reason, 500),
    notifySubject: Boolean(input?.notifySubject),
    caseId: safeId(input?.caseId) || null,
    customerVisibleNote: safeText(input?.customerVisibleNote, 1600),
    meta: safeMeta(input?.meta),
  };
}

export async function createAdminEntityNote(args: {
  entityType: string;
  entityId: string;
  authorStaffId?: string | null;
  authorUserId?: string | null;
  body: string;
  caseId?: string | null;
  customerVisibleNote?: boolean;
  meta?: Prisma.JsonObject | null;
}) {
  const entityType = safeId(args.entityType);
  const entityId = safeId(args.entityId);
  const body = safeText(args.body, 4000);
  if (!entityType || !entityId || !body) return null;

  return prisma.adminEntityNote.create({
    data: {
      entityType,
      entityId,
      authorStaffId: safeId(args.authorStaffId) || null,
      authorUserId: safeId(args.authorUserId) || null,
      body,
      caseId: safeId(args.caseId) || null,
      customerVisibleNote: Boolean(args.customerVisibleNote),
      metaJson: args.meta || undefined,
    },
  });
}

export async function listAdminEntityNotes(args: {
  entityType: string;
  entityId: string;
  take?: number;
}) {
  const entityType = safeId(args.entityType);
  const entityId = safeId(args.entityId);
  if (!entityType || !entityId) return [];

  return prisma.adminEntityNote.findMany({
    where: {
      entityType,
      entityId,
    },
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take: Math.max(1, Math.min(Number(args.take || 12), 50)),
  });
}

export async function writeAdminOperationalAudit(args: {
  actorStaffId?: string | null;
  actorUserId?: string | null;
  action: string;
  actionLabel: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  severity?: AuditSeverity;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  reason?: string | null;
  notifySubject?: boolean;
  caseId?: string | null;
  campaignId?: string | null;
  threadId?: string | null;
  request?: Request | null;
}) {
  return writeAdminAuditLog({
    actorStaffId: safeId(args.actorStaffId) || null,
    actorUserId: safeId(args.actorUserId) || null,
    action: args.action,
    actionLabel: args.actionLabel,
    entityType: args.entityType,
    entityId: safeId(args.entityId) || null,
    entityLabel: safeText(args.entityLabel, 191),
    severity: args.severity,
    request: args.request,
    beforeJson: args.before || undefined,
    afterJson: args.after || undefined,
    metaJson: {
      entityType: args.entityType,
      entityId: safeId(args.entityId) || null,
      reason: safeText(args.reason, 500),
      before: args.before || null,
      after: args.after || null,
      approvalState: "act_now_audit",
      notifySubject: Boolean(args.notifySubject),
      caseId: safeId(args.caseId) || null,
      campaignId: safeId(args.campaignId) || null,
      threadId: safeId(args.threadId) || null,
      ...(args.meta || {}),
    },
  });
}
