import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
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

function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: { ...NO_STORE_HEADERS } });
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

// Only allow these keys to be patched
const KEYS = [
  "promoEmail",
  "productUpdates",
  "billingEmails",
  "securityEmails",
  "inAppSignals",
  "sound",
  "quietHours",
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

function pickPatch(body: unknown) {
  const patch: Partial<Record<Key, boolean>> = {};
  for (const k of KEYS) {
    const b = toBool((body as Record<string, unknown>)?.[k]);
    if (b !== null) patch[k] = b;
  }
  return patch;
}

async function ensureRow(userId: string, accountId: string | null) {
  if (accountId) {
    return prisma.notificationSettings.upsert({
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
        // Defaults handled by Prisma
      },
    });
  }

  const existing = await prisma.notificationSettings.findFirst({
    where: {
      userId,
      accountId: null,
    },
  });
  if (existing) return existing;

  return prisma.notificationSettings.create({
    data: {
      userId,
      accountId: null,
    },
  });
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

    return json({ ok: true, settings: row }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      const guardPayload = buildGuardDecisionPayload({
        actionId: error.status === 403 ? "NOTIFICATIONS_OWNER_ONLY" : "AUTH_REQUIRED",
      });
      return json({ ok: false, error: error.code, message: error.message, ...(guardPayload || {}) }, error.status);
    }
    return json({ ok: false, error: "NOTIF_SETTINGS_FAILED", message: "Failed to load notification settings." }, 500);
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

    const next = await prisma.notificationSettings.update({
      where: { id: row.id },
      data: patch,
    });

    return json({ ok: true, settings: next }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      const guardPayload = buildGuardDecisionPayload({
        actionId: error.status === 403 ? "NOTIFICATIONS_OWNER_ONLY" : "AUTH_REQUIRED",
      });
      return json({ ok: false, error: error.code, message: error.message, ...(guardPayload || {}) }, error.status);
    }
    return json({ ok: false, error: "NOTIF_SETTINGS_SAVE_FAILED", message: "Failed to update notification settings." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "GET, POST, OPTIONS" } });
}
