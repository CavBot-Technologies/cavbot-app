import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireUser, isApiAuthError } from "@/lib/apiAuth";
import { getAuthPool } from "@/lib/authDb";
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

async function withUnreadCountDeadline<T>(promise: Promise<T>, label: string, timeoutMs = 2_500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function countUnreadNotifications(args: { userId: string; accountId: string }) {
  const result = await getAuthPool().query<{ count: string | number }>(
    `SELECT COUNT(*) AS "count"
     FROM "Notification"
     WHERE "userId" = $1
       AND "readAt" IS NULL
       AND (
         "accountId" IS NULL
         OR ($2::text <> '' AND "accountId" = $2)
       )`,
    [args.userId, args.accountId],
  );
  const raw = result.rows[0]?.count ?? 0;
  const count = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(count) ? count : 0;
}

export async function GET(req: NextRequest) {
  try {
    const sess = await withUnreadCountDeadline(requireSession(req), "UNREAD_SESSION", 2_500);
    requireUser(sess);

    const userId = s(sess.sub);
    const accountId = s(sess.accountId);

    if (accountId) {
      void ensureCavCloudShareExpirySoonNotifications({ accountId, userId }).catch(() => {
        // Keep unread badge resilient.
      });
    }

    const count = await withUnreadCountDeadline(
      countUnreadNotifications({
        userId,
        accountId,
      }),
      "UNREAD_COUNT",
      2_500,
    ).catch(() => 0);

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
