// app/api/notifications/settings/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { CAVBOT_TONES, type CavbotTone } from "@/lib/cavbotTone";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, status = 200, extra?: Record<string, string>) {
  return NextResponse.json(data, { status, headers: { ...NO_STORE_HEADERS, ...(extra || {}) } });
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type NotificationMeta = {
  alertTone?: CavbotTone;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  quietHoursTimezone?: string;
};

function pickAlertTone(value: unknown): CavbotTone | null {
  if (typeof value !== "string") return null;
  if ((CAVBOT_TONES as string[]).includes(value)) {
    return value as CavbotTone;
  }
  return null;
}

function pickMetaPatch(body: unknown): Partial<NotificationMeta> {
  if (!isRecord(body)) return {};
  const patch: Partial<NotificationMeta> = {};
  const tone = pickAlertTone(body.alertTone);
  if (tone) patch.alertTone = tone;
  if (typeof body.quietHoursStart === "string") {
    patch.quietHoursStart = body.quietHoursStart;
  }
  if (typeof body.quietHoursEnd === "string") {
    patch.quietHoursEnd = body.quietHoursEnd;
  }
  if (typeof body.quietHoursTimezone === "string") {
    patch.quietHoursTimezone = body.quietHoursTimezone;
  }
  return patch;
}

function readMetaFields(meta: unknown): NotificationMeta {
  if (!isRecord(meta)) return {};
  const tone = pickAlertTone(meta.alertTone);
  const result: NotificationMeta = {};
  if (tone) result.alertTone = tone;
  if (typeof meta.quietHoursStart === "string") {
    result.quietHoursStart = meta.quietHoursStart;
  }
  if (typeof meta.quietHoursEnd === "string") {
    result.quietHoursEnd = meta.quietHoursEnd;
  }
  if (typeof meta.quietHoursTimezone === "string") {
    result.quietHoursTimezone = meta.quietHoursTimezone;
  }
  return result;
}

// Only allow these keys to be patched (strict allowlist)
const KEYS = [
  "promoEmail",
  "productUpdates",
  "billingEmails",
  "securityEmails",

  "inAppSignals",
  "sound",
  "quietHours",

  // digest controls (wired)
  "digestEmail",
  "digestInApp",

  "evtSubDue",
  "evtSubRenewed",
  "evtSubExpired",
  "evtUpgraded",
  "evtDowngraded",

  "evtSiteCritical",
  "evtSeatInviteAccepted",
  "evtSeatLimitHit",

  "evtNewFeatures",
] as const;

type Key = (typeof KEYS)[number];

type NotificationSettingsRow = Partial<Record<Key, boolean>> & {
  id?: string;
  metaJson?: unknown;
};

function pickPatch(body: unknown) {
  const patch: Partial<Record<Key, boolean>> = {};
  for (const k of KEYS) {
    const b = toBool((body as Record<string, unknown>)?.[k]);
    if (b !== null) patch[k] = b;
  }
  return patch;
}

function defaultSettings(): Record<string, unknown> {
  return {
    promoEmail: false,
    productUpdates: true,
    billingEmails: true,
    securityEmails: true,
    inAppSignals: true,
    sound: true,
    quietHours: false,
    digestEmail: true,
    digestInApp: false,
    evtSubDue: true,
    evtSubRenewed: true,
    evtSubExpired: true,
    evtUpgraded: true,
    evtDowngraded: true,
    evtSiteCritical: true,
    evtSeatInviteAccepted: true,
    evtSeatLimitHit: true,
    evtNewFeatures: true,
  };
}

function mergeSettings(row: NotificationSettingsRow | null, extra?: Record<string, unknown>) {
  return {
    ...defaultSettings(),
    ...(row || {}),
    ...readMetaFields(row?.metaJson),
    ...(extra || {}),
  };
}

async function ensureRow(userId: string, accountId: string | null) {
  if (accountId) {
    try {
      return await prisma.notificationSettings.upsert({
        where: {
          userId_accountId: {
            userId,
            accountId,
          },
        },
        update: {},
        create: {
          userId,
          accountId,
        },
      });
    } catch (error) {
      console.error("[notifications/settings] scoped upsert failed", error);
      try {
        return await prisma.notificationSettings.findFirst({
          where: { userId, accountId },
        });
      } catch (fallbackError) {
        console.error("[notifications/settings] scoped fallback lookup failed", fallbackError);
        return null;
      }
    }
  }

  try {
    const existing = await prisma.notificationSettings.findFirst({
      where: {
        userId,
        accountId: null,
      },
    });
    if (existing) return existing;

    return await prisma.notificationSettings.create({
      data: {
        userId,
        accountId: null,
      },
    });
  } catch (error) {
    console.error("[notifications/settings] global row bootstrap failed", error);
    return null;
  }
}


export async function GET(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    if (sess.memberRole !== "OWNER") {
      const guardPayload = buildGuardDecisionPayload({
        actionId: "NOTIFICATIONS_OWNER_ONLY",
        role: sess.memberRole || "ANON",
      });
      return json({ ok: false, error: "UNAUTHORIZED", ...(guardPayload || {}) }, 403);
    }

    const userId = s(sess.sub);
    const accountId = s(sess.accountId) || null;

    const row = await ensureRow(userId, accountId);
    const mergedSettings = mergeSettings(row);
    return json({ ok: true, settings: mergedSettings }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      const guardPayload = buildGuardDecisionPayload({
        actionId: error.status === 403 ? "NOTIFICATIONS_OWNER_ONLY" : "AUTH_REQUIRED",
      });
      return json({ ok: false, error: error.code, message: error.message, ...(guardPayload || {}) }, error.status);
    }
    return json(
      { ok: false, error: "NOTIF_SETTINGS_FAILED", message: "Failed to load notification settings." },
      500
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    if (sess.memberRole !== "OWNER") {
      const guardPayload = buildGuardDecisionPayload({
        actionId: "NOTIFICATIONS_OWNER_ONLY",
        role: sess.memberRole || "ANON",
      });
      return json({ ok: false, error: "UNAUTHORIZED", ...(guardPayload || {}) }, 403);
    }

    const userId = s(sess.sub);
    const accountId = s(sess.accountId) || null;

    const body = (await readSanitizedJson(req, null)) as unknown;
    const patch = pickPatch(body);

    const row = await ensureRow(userId, accountId);
    const metaPatch = pickMetaPatch(body);
    const existingMeta = isRecord(row?.metaJson) ? { ...row.metaJson } : {};
    const nextMeta = { ...existingMeta, ...metaPatch };
    const metaToSave = Object.keys(nextMeta).length ? nextMeta : null;

    if (!row?.id) {
      return json({ ok: true, settings: mergeSettings(null, { ...patch, ...metaPatch }) }, 200);
    }

    let next: NotificationSettingsRow | null = null;
    try {
      next = await prisma.notificationSettings.update({
        where: { id: row.id },
        data: {
          ...patch,
          metaJson: metaToSave ?? Prisma.JsonNull,
        },
      });
    } catch (error) {
      console.error("[notifications/settings] full update failed", error);
      try {
        next = await prisma.notificationSettings.update({
          where: { id: row.id },
          data: {
            ...patch,
          },
        });
      } catch (fallbackError) {
        console.error("[notifications/settings] fallback update failed", fallbackError);
      }
    }

    const mergedSettings = mergeSettings(next || row, metaPatch);
    return json({ ok: true, settings: mergedSettings }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      const guardPayload = buildGuardDecisionPayload({
        actionId: error.status === 403 ? "NOTIFICATIONS_OWNER_ONLY" : "AUTH_REQUIRED",
      });
      return json({ ok: false, error: error.code, message: error.message, ...(guardPayload || {}) }, error.status);
    }
    return json(
      { ok: false, error: "NOTIF_SETTINGS_SAVE_FAILED", message: "Failed to update notification settings." },
      500
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "GET, POST, OPTIONS" } });
}

export async function PUT() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET, POST, OPTIONS" });
}

export async function DELETE() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET, POST, OPTIONS" });
}
