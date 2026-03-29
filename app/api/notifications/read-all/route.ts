import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
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

    await prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        OR: accountId ? [{ accountId }, { accountId: null }] : [{ accountId: null }],
      },
      data: { readAt: new Date() },
    });

    return json({ ok: true }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      const guardPayload = buildGuardDecisionPayload({
        actionId: error.status === 403 ? "NOTIFICATIONS_OWNER_ONLY" : "AUTH_REQUIRED",
      });
      return json({ ok: false, error: error.code, ...(guardPayload || {}) }, error.status);
    }
    return json({ ok: false, error: "NOTIF_READ_ALL_FAILED" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}
