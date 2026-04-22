import "server-only";

import type { AdminBroadcastStatus, Prisma } from "@prisma/client";

import { getAdminBroadcastThread, postAdminChatMessage } from "@/lib/admin/chat.server";
import { createAdminNotification } from "@/lib/admin/notifications.server";
import { prisma } from "@/lib/prisma";

function safeId(value: unknown) {
  return String(value || "").trim();
}

function safeText(value: unknown, max = 4000) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return null;
  return normalized.slice(0, Math.max(1, max));
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeBroadcastStatus(value: unknown): AdminBroadcastStatus {
  const token = String(value || "").trim().toUpperCase();
  if (token === "SCHEDULED" || token === "SENDING" || token === "SENT" || token === "CANCELED" || token === "FAILED") {
    return token;
  }
  return "DRAFT";
}

function normalizeAudienceType(value: unknown) {
  const token = String(value || "").trim().toUpperCase();
  if (
    token === "ALL_USERS"
    || token === "ALL_STAFF"
    || token === "STAFF_DEPARTMENTS"
    || token === "ACCOUNT_IDS"
    || token === "USER_IDS"
  ) {
    return token;
  }
  return "ALL_USERS";
}

function isStaffAudience(audienceType: string) {
  return audienceType === "ALL_STAFF" || audienceType === "STAFF_DEPARTMENTS";
}

async function resolveCampaignAudience(campaign: {
  audienceType: string;
  targetDepartments: string[];
  targetAccountIds: string[];
  targetUserIds: string[];
}) {
  const audienceType = normalizeAudienceType(campaign.audienceType);
  if (audienceType === "USER_IDS") {
    return Array.from(new Set(campaign.targetUserIds.map((value) => safeId(value)).filter(Boolean))).map((userId) => ({
      userId,
      accountId: null as string | null,
    }));
  }

  if (audienceType === "ACCOUNT_IDS") {
    const memberships = await prisma.membership.findMany({
      where: {
        accountId: { in: campaign.targetAccountIds.map((value) => safeId(value)).filter(Boolean) },
      },
      select: {
        userId: true,
        accountId: true,
      },
    });
    return memberships.map((membership) => ({
      userId: membership.userId,
      accountId: membership.accountId,
    }));
  }

  if (audienceType === "ALL_STAFF" || audienceType === "STAFF_DEPARTMENTS") {
    const staff = await prisma.staffProfile.findMany({
      where: {
        status: "ACTIVE",
      },
      select: {
        userId: true,
        scopes: true,
      },
    });
    const scopedDepartments = new Set(campaign.targetDepartments.map((value) => safeId(value).toUpperCase()).filter(Boolean));
    return staff
      .filter((row) => {
        if (!scopedDepartments.size || audienceType === "ALL_STAFF") return true;
        const scopes = Array.isArray(row.scopes) ? row.scopes : [];
        return scopes.some((scope) => {
          const token = String(scope || "").trim().toLowerCase();
          if (!token.startsWith("department:")) return false;
          return scopedDepartments.has(token.replace("department:", "").toUpperCase());
        });
      })
      .map((row) => ({ userId: row.userId, accountId: null as string | null }));
  }

  const users = await prisma.user.findMany({
    select: { id: true },
  });
  return users.map((user) => ({ userId: user.id, accountId: null as string | null }));
}

export async function dispatchBroadcastCampaign(campaignId: string, actor: { userId: string; staffId: string }) {
  const campaign = await prisma.adminBroadcastCampaign.findUnique({
    where: { id: safeId(campaignId) },
  });
  if (!campaign?.id) return null;

  const body = safeText(campaign.body, 4000);
  if (!body) return null;

  const channels = campaign.channels.length
    ? campaign.channels
    : isStaffAudience(campaign.audienceType)
      ? ["NOTIFICATION", "CAVCHAT"]
      : ["NOTIFICATION"];
  const audience = await resolveCampaignAudience(campaign);
  const recipients = Array.from(new Map(audience.map((row) => [`${row.userId}:${row.accountId || ""}`, row])).values());

  await prisma.adminBroadcastCampaign.update({
    where: { id: campaign.id },
    data: {
      status: "SENDING",
    },
  });

  let broadcastThreadId: string | null = null;
  let broadcastMessageId: string | null = null;
  if (channels.includes("CAVCHAT") && isStaffAudience(campaign.audienceType)) {
    const thread = await getAdminBroadcastThread();
    const message = await postAdminChatMessage({
      viewer: {
        id: actor.staffId,
        userId: actor.userId,
        systemRole: "OWNER",
        scopes: ["*"],
      },
      threadId: thread.id,
      body: `${campaign.title}\n\n${body}`,
    });
    broadcastThreadId = thread.id;
    broadcastMessageId = message.id;
  }

  for (const recipient of recipients) {
    if (channels.includes("NOTIFICATION")) {
      const notification = await createAdminNotification({
        userId: recipient.userId,
        accountId: recipient.accountId,
        title: campaign.title,
        body,
        href: safeText(campaign.ctaHref, 400) || "/notifications",
        kind: isStaffAudience(campaign.audienceType) ? "HQ_BROADCAST_STAFF" : "HQ_BROADCAST_USER",
        tone: "WATCH",
        meta: {
          audienceType: campaign.audienceType,
          campaignId: campaign.id,
          dismissalPolicy: campaign.dismissalPolicy || null,
          dismissAt: campaign.dismissAt?.toISOString() || null,
          ctaLabel: campaign.ctaLabel || null,
        },
      });

      await prisma.adminBroadcastDelivery.upsert({
        where: {
          campaignId_recipientUserId_channel: {
            campaignId: campaign.id,
            recipientUserId: recipient.userId,
            channel: "NOTIFICATION",
          },
        },
        update: {
          status: "DELIVERED",
          deliveredAt: new Date(),
          notificationId: notification?.id || null,
          recipientAccountId: recipient.accountId,
        },
        create: {
          campaignId: campaign.id,
          recipientUserId: recipient.userId,
          recipientAccountId: recipient.accountId,
          channel: "NOTIFICATION",
          status: "DELIVERED",
          deliveredAt: new Date(),
          notificationId: notification?.id || null,
        },
      });
    }

    if (broadcastThreadId && broadcastMessageId) {
      await prisma.adminBroadcastDelivery.upsert({
        where: {
          campaignId_recipientUserId_channel: {
            campaignId: campaign.id,
            recipientUserId: recipient.userId,
            channel: "CAVCHAT",
          },
        },
        update: {
          status: "DELIVERED",
          deliveredAt: new Date(),
          threadId: broadcastThreadId,
          messageId: broadcastMessageId,
        },
        create: {
          campaignId: campaign.id,
          recipientUserId: recipient.userId,
          channel: "CAVCHAT",
          status: "DELIVERED",
          deliveredAt: new Date(),
          threadId: broadcastThreadId,
          messageId: broadcastMessageId,
        },
      });
    }
  }

  await prisma.adminBroadcastCampaign.update({
    where: { id: campaign.id },
    data: {
      status: "SENT",
      sentAt: new Date(),
    },
  });

  return prisma.adminBroadcastCampaign.findUnique({
    where: { id: campaign.id },
    include: {
      deliveries: true,
    },
  });
}

export async function dispatchDueBroadcastCampaigns(actor: { userId: string; staffId: string }) {
  const due = await prisma.adminBroadcastCampaign.findMany({
    where: {
      status: "SCHEDULED",
      scheduledFor: { lte: new Date() },
    },
    orderBy: { scheduledFor: "asc" },
    take: 25,
  });

  for (const campaign of due) {
    await dispatchBroadcastCampaign(campaign.id, actor);
  }

  return due.length;
}

export async function listBroadcastCampaigns(args?: { includeDeliveries?: boolean }) {
  return prisma.adminBroadcastCampaign.findMany({
    include: args?.includeDeliveries ? { deliveries: true } : undefined,
    orderBy: [
      { updatedAt: "desc" },
      { createdAt: "desc" },
    ],
    take: 60,
  });
}

export async function createBroadcastCampaign(args: {
  title: string;
  body: string;
  audienceType: string;
  targetDepartments?: string[];
  targetAccountIds?: string[];
  targetUserIds?: string[];
  channels?: string[];
  ctaLabel?: string | null;
  ctaHref?: string | null;
  dismissalPolicy?: string | null;
  dismissAt?: Date | null;
  scheduledFor?: Date | null;
  deliveryWindowStart?: Date | null;
  deliveryWindowEnd?: Date | null;
  status?: string | null;
  createdByStaffId?: string | null;
  createdByUserId?: string | null;
  meta?: Prisma.JsonObject | null;
}) {
  const status = normalizeBroadcastStatus(args.status);
  return prisma.adminBroadcastCampaign.create({
    data: {
      title: safeText(args.title, 160) || "Broadcast",
      body: safeText(args.body, 6000) || "",
      audienceType: normalizeAudienceType(args.audienceType),
      targetDepartments: Array.isArray(args.targetDepartments)
        ? args.targetDepartments.map((value) => safeId(value)).filter(Boolean)
        : [],
      targetAccountIds: Array.isArray(args.targetAccountIds)
        ? args.targetAccountIds.map((value) => safeId(value)).filter(Boolean)
        : [],
      targetUserIds: Array.isArray(args.targetUserIds)
        ? args.targetUserIds.map((value) => safeId(value)).filter(Boolean)
        : [],
      channels: Array.isArray(args.channels)
        ? args.channels.map((value) => safeId(value).toUpperCase()).filter(Boolean)
        : [],
      ctaLabel: safeText(args.ctaLabel, 80),
      ctaHref: safeText(args.ctaHref, 400),
      dismissalPolicy: safeText(args.dismissalPolicy, 80),
      dismissAt: args.dismissAt || null,
      scheduledFor: args.scheduledFor || null,
      deliveryWindowStart: args.deliveryWindowStart || null,
      deliveryWindowEnd: args.deliveryWindowEnd || null,
      status,
      createdByStaffId: safeId(args.createdByStaffId) || null,
      createdByUserId: safeId(args.createdByUserId) || null,
      metaJson: (asRecord(args.meta) as Prisma.InputJsonValue | null) || undefined,
    },
  });
}

export async function updateBroadcastCampaign(args: {
  campaignId: string;
  status?: string | null;
  title?: string | null;
  body?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  dismissalPolicy?: string | null;
  dismissAt?: Date | null;
  scheduledFor?: Date | null;
  deliveryWindowStart?: Date | null;
  deliveryWindowEnd?: Date | null;
}) {
  const campaignId = safeId(args.campaignId);
  if (!campaignId) return null;
  return prisma.adminBroadcastCampaign.update({
    where: { id: campaignId },
    data: {
      status: args.status ? normalizeBroadcastStatus(args.status) : undefined,
      title: args.title === undefined ? undefined : (safeText(args.title, 160) || "Broadcast"),
      body: args.body === undefined ? undefined : (safeText(args.body, 6000) || ""),
      ctaLabel: args.ctaLabel === undefined ? undefined : safeText(args.ctaLabel, 80),
      ctaHref: args.ctaHref === undefined ? undefined : safeText(args.ctaHref, 400),
      dismissalPolicy: args.dismissalPolicy === undefined ? undefined : safeText(args.dismissalPolicy, 80),
      dismissAt: args.dismissAt === undefined ? undefined : (args.dismissAt || null),
      scheduledFor: args.scheduledFor === undefined ? undefined : (args.scheduledFor || null),
      deliveryWindowStart: args.deliveryWindowStart === undefined ? undefined : (args.deliveryWindowStart || null),
      deliveryWindowEnd: args.deliveryWindowEnd === undefined ? undefined : (args.deliveryWindowEnd || null),
      canceledAt: args.status && normalizeBroadcastStatus(args.status) === "CANCELED" ? new Date() : undefined,
    },
  });
}
