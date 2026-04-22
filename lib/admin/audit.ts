import "server-only";

import type { AuditSeverity } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { recordAdminEventSafe } from "@/lib/admin/events";

type WriteAdminAuditLogArgs = {
  actorStaffId?: string | null;
  actorUserId?: string | null;
  action: string;
  actionLabel: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  severity?: AuditSeverity;
  sessionKey?: string | null;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  metaJson?: Record<string, unknown> | null;
  request?: Request | null;
};

function safeString(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function requestHeader(request: Request | null | undefined, header: string) {
  if (!request) return null;
  const raw = request.headers.get(header);
  return safeString(raw);
}

function pickClientIp(request?: Request | null) {
  const candidates = [
    requestHeader(request, "cf-connecting-ip"),
    requestHeader(request, "true-client-ip"),
    requestHeader(request, "x-forwarded-for"),
    requestHeader(request, "x-real-ip"),
  ].filter(Boolean) as string[];

  if (!candidates.length) return null;
  return candidates[0].split(",")[0].trim() || null;
}

function toJson(value?: Record<string, unknown> | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

export async function writeAdminAuditLog(args: WriteAdminAuditLogArgs) {
  const action = safeString(args.action);
  const actionLabel = safeString(args.actionLabel);
  const entityType = safeString(args.entityType);
  if (!action || !actionLabel || !entityType) return null;

  const row = await prisma.adminAuditLog.create({
    data: {
      actorStaffId: safeString(args.actorStaffId),
      actorUserId: safeString(args.actorUserId),
      action,
      actionLabel,
      entityType,
      entityId: safeString(args.entityId),
      entityLabel: safeString(args.entityLabel),
      severity: args.severity || "info",
      ip: pickClientIp(args.request),
      userAgent: requestHeader(args.request, "user-agent"),
      requestHost: requestHeader(args.request, "x-forwarded-host") || requestHeader(args.request, "host"),
      sessionKey: safeString(args.sessionKey),
      beforeJson: toJson(args.beforeJson),
      afterJson: toJson(args.afterJson),
      metaJson: toJson(args.metaJson),
    },
  });

  void recordAdminEventSafe({
    name: "admin_sensitive_action",
    actorStaffId: row.actorStaffId,
    actorUserId: row.actorUserId,
    sessionKey: row.sessionKey,
    status: row.severity,
    result: action,
    metaJson: {
      entityType: row.entityType,
      entityId: row.entityId,
      entityLabel: row.entityLabel,
      actionLabel: row.actionLabel,
    },
  });

  return row;
}
