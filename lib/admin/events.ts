import "server-only";

import { prisma } from "@/lib/prisma";

type RecordAdminEventArgs = {
  name: string;
  actorStaffId?: string | null;
  actorUserId?: string | null;
  subjectUserId?: string | null;
  accountId?: string | null;
  projectId?: number | null;
  siteId?: string | null;
  origin?: string | null;
  sessionKey?: string | null;
  planTier?: string | null;
  environment?: string | null;
  status?: string | null;
  result?: string | null;
  country?: string | null;
  region?: string | null;
  metaJson?: Record<string, unknown> | null;
};

function cleanString(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toJson(value?: Record<string, unknown> | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

export async function recordAdminEvent(args: RecordAdminEventArgs) {
  const name = cleanString(args.name);
  if (!name) return null;

  return prisma.adminEvent.create({
    data: {
      name,
      actorStaffId: cleanString(args.actorStaffId),
      actorUserId: cleanString(args.actorUserId),
      subjectUserId: cleanString(args.subjectUserId),
      accountId: cleanString(args.accountId),
      projectId: Number.isFinite(Number(args.projectId)) ? Number(args.projectId) : null,
      siteId: cleanString(args.siteId),
      origin: cleanString(args.origin),
      sessionKey: cleanString(args.sessionKey),
      planTier: cleanString(args.planTier),
      environment: cleanString(args.environment) || process.env.NODE_ENV || "development",
      status: cleanString(args.status),
      result: cleanString(args.result),
      country: cleanString(args.country),
      region: cleanString(args.region),
      metaJson: toJson(args.metaJson),
    },
  });
}

export async function recordAdminEventSafe(args: RecordAdminEventArgs) {
  try {
    return await recordAdminEvent(args);
  } catch (error) {
    console.error("[admin:event] write failed", error);
    return null;
  }
}
