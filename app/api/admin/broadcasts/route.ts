import "server-only";

import { NextRequest } from "next/server";

import { ApiAuthError, assertWriteOrigin } from "@/lib/apiAuth";
import { adminJson, safeId, safeText } from "@/lib/admin/api";
import {
  createBroadcastCampaign,
  dispatchBroadcastCampaign,
  dispatchDueBroadcastCampaigns,
  listBroadcastCampaigns,
  updateBroadcastCampaign,
} from "@/lib/admin/broadcasts.server";
import { hasAdminScope } from "@/lib/admin/permissions";
import { requireAdminAccess } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasBroadcastAccess(staff: { systemRole: string; scopes?: string[] | null }) {
  return hasAdminScope(staff, "broadcast.users") || hasAdminScope(staff, "broadcast.staff");
}

function requiredScopeForAudience(audienceType: string) {
  const normalized = String(audienceType || "").trim().toUpperCase();
  if (normalized === "ALL_STAFF" || normalized === "STAFF_DEPARTMENTS") return "broadcast.staff" as const;
  return "broadcast.users" as const;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAdminAccess(req);
    if (!hasBroadcastAccess(ctx.staff)) {
      return adminJson({ ok: false, error: "ADMIN_FORBIDDEN" }, 403);
    }
    await dispatchDueBroadcastCampaigns({
      userId: ctx.userSession.sub,
      staffId: ctx.staff.id,
    });
    const campaigns = await listBroadcastCampaigns({ includeDeliveries: true });
    return adminJson({ ok: true, campaigns });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({ ok: false, error: "BROADCASTS_READ_FAILED" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireAdminAccess(req);
    if (!hasBroadcastAccess(ctx.staff)) {
      return adminJson({ ok: false, error: "ADMIN_FORBIDDEN" }, 403);
    }

    const body = (await readSanitizedJson(req, {})) as Record<string, unknown>;
    const action = safeId(body.action).toLowerCase();

    if (action === "dispatch_due") {
      const dispatched = await dispatchDueBroadcastCampaigns({
        userId: ctx.userSession.sub,
        staffId: ctx.staff.id,
      });
      return adminJson({ ok: true, dispatched });
    }

    if (action === "dispatch") {
      const campaignId = safeId(body.campaignId);
      const campaign = campaignId
        ? await prisma.adminBroadcastCampaign.findUnique({ where: { id: campaignId }, select: { audienceType: true } })
        : null;
      if (!campaign) return adminJson({ ok: false, error: "BROADCAST_NOT_FOUND" }, 404);
      if (!hasAdminScope(ctx.staff, requiredScopeForAudience(campaign.audienceType))) {
        return adminJson({ ok: false, error: "ADMIN_FORBIDDEN" }, 403);
      }
      const result = await dispatchBroadcastCampaign(campaignId, {
        userId: ctx.userSession.sub,
        staffId: ctx.staff.id,
      });
      return adminJson({ ok: true, result });
    }

    if (action === "update" || action === "cancel") {
      const campaignId = safeId(body.campaignId);
      const existing = campaignId
        ? await prisma.adminBroadcastCampaign.findUnique({ where: { id: campaignId }, select: { audienceType: true } })
        : null;
      if (!existing) return adminJson({ ok: false, error: "BROADCAST_NOT_FOUND" }, 404);
      if (!hasAdminScope(ctx.staff, requiredScopeForAudience(existing.audienceType))) {
        return adminJson({ ok: false, error: "ADMIN_FORBIDDEN" }, 403);
      }
      const updated = await updateBroadcastCampaign({
        campaignId,
        title: body.title === undefined ? undefined : safeText(body.title, 160),
        body: body.body === undefined ? undefined : safeText(body.body, 6000),
        ctaLabel: body.ctaLabel === undefined ? undefined : safeText(body.ctaLabel, 80),
        ctaHref: body.ctaHref === undefined ? undefined : safeText(body.ctaHref, 400),
        dismissalPolicy: body.dismissalPolicy === undefined ? undefined : safeText(body.dismissalPolicy, 80),
        scheduledFor: body.scheduledFor === undefined ? undefined : (body.scheduledFor ? new Date(String(body.scheduledFor)) : null),
        deliveryWindowStart: body.deliveryWindowStart === undefined ? undefined : (body.deliveryWindowStart ? new Date(String(body.deliveryWindowStart)) : null),
        deliveryWindowEnd: body.deliveryWindowEnd === undefined ? undefined : (body.deliveryWindowEnd ? new Date(String(body.deliveryWindowEnd)) : null),
        dismissAt: body.dismissAt === undefined ? undefined : (body.dismissAt ? new Date(String(body.dismissAt)) : null),
        status: action === "cancel" ? "CANCELED" : (safeId(body.status).toUpperCase() || undefined),
      });
      return adminJson({ ok: true, campaign: updated });
    }

    const audienceType = safeId(body.audienceType).toUpperCase();
    const requiredScope = requiredScopeForAudience(audienceType);
    if (!hasAdminScope(ctx.staff, requiredScope)) {
      return adminJson({ ok: false, error: "ADMIN_FORBIDDEN" }, 403);
    }

    const campaign = await createBroadcastCampaign({
      title: safeText(body.title, 160) || "Broadcast",
      body: safeText(body.body, 6000),
      audienceType,
      targetDepartments: Array.isArray(body.targetDepartments) ? body.targetDepartments.map((value) => safeId(value)) : [],
      targetAccountIds: Array.isArray(body.targetAccountIds) ? body.targetAccountIds.map((value) => safeId(value)) : [],
      targetUserIds: Array.isArray(body.targetUserIds) ? body.targetUserIds.map((value) => safeId(value)) : [],
      channels: Array.isArray(body.channels) ? body.channels.map((value) => safeId(value)) : [],
      ctaLabel: safeText(body.ctaLabel, 80) || null,
      ctaHref: safeText(body.ctaHref, 400) || null,
      dismissalPolicy: safeText(body.dismissalPolicy, 80) || null,
      dismissAt: body.dismissAt ? new Date(String(body.dismissAt)) : null,
      scheduledFor: body.scheduledFor ? new Date(String(body.scheduledFor)) : null,
      deliveryWindowStart: body.deliveryWindowStart ? new Date(String(body.deliveryWindowStart)) : null,
      deliveryWindowEnd: body.deliveryWindowEnd ? new Date(String(body.deliveryWindowEnd)) : null,
      createdByStaffId: ctx.staff.id,
      createdByUserId: ctx.userSession.sub,
      meta: body.meta && typeof body.meta === "object" && !Array.isArray(body.meta) ? (body.meta as never) : undefined,
    });

    return adminJson({ ok: true, campaign });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({
      ok: false,
      error: error instanceof Error ? error.message : "BROADCAST_WRITE_FAILED",
    }, 500);
  }
}
