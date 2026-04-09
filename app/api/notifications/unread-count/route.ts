import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireUser, isApiAuthError } from "@/lib/apiAuth";
import { ensureCavCloudShareExpirySoonNotifications } from "@/lib/cavcloud/notifications.server";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";

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

function passiveAuthRequiredCount(errorCode: string) {
  return {
    ok: false,
    authRequired: true,
    error: errorCode,
    count: 0,
  } as const;
}

export async function GET(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);

    const userId = s(sess.sub);
    const accountId = s(sess.accountId);

    if (accountId) {
      try {
        await ensureCavCloudShareExpirySoonNotifications({ accountId, userId });
      } catch {
        // Keep unread badge resilient.
      }
    }

    const count = await prisma.notification.count({
      where: {
        userId,
        readAt: null,
        OR: accountId ? [{ accountId }, { accountId: null }] : [{ accountId: null }],
      },
    });

    return json({ ok: true, count }, 200);
  } catch (error) {
    if (isApiAuthError(error)) {
      const guardPayload = buildGuardDecisionPayload({
        actionId: "AUTH_REQUIRED",
      });
      return json({ ...passiveAuthRequiredCount(error.code), ...(guardPayload || {}) }, 200);
    }
    return json({ ok: true, count: 0 }, 200);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" } });
}
