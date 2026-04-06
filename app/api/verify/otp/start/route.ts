import { NextResponse } from "next/server";

import { assertWriteOrigin, getSession } from "@/lib/apiAuth";
import { recordAdminEventSafe } from "@/lib/admin/events";
import { parseVerifyActionType, startVerifyOtp } from "@/lib/auth/cavbotVerify";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

type OtpStartBody = {
  actionType?: unknown;
  challengeId?: unknown;
  challengeToken?: unknown;
  sessionId?: unknown;
  identifier?: unknown;
  email?: unknown;
};

export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);
    const session = await getSession(req);
    const body = (await readSanitizedJson(req, ({}))) as OtpStartBody;

    const actionType = parseVerifyActionType(body?.actionType);
    if (!actionType) {
      return json({ ok: false, error: "BAD_ACTION", message: "Invalid actionType." }, 400);
    }

    const result = await startVerifyOtp(req, {
      actionType,
      challengeId: body?.challengeId ? String(body.challengeId) : "",
      challengeToken: body?.challengeToken ? String(body.challengeToken) : "",
      sessionIdHint: body?.sessionId ? String(body.sessionId) : "",
      identifier: body?.identifier ? String(body.identifier) : "",
      email: body?.email ? String(body.email) : "",
    });

    await recordAdminEventSafe({
      name: "cavverify_started",
      actorUserId: session?.systemRole === "user" ? session.sub : null,
      accountId: session?.systemRole === "user" ? session.accountId || null : null,
      sessionKey: result.ok ? (result.sessionId || (body?.sessionId ? String(body.sessionId) : null)) : (body?.sessionId ? String(body.sessionId) : null),
      result: `otp:${result.ok ? "sent" : String(result.error || "failed")}`,
      metaJson: {
        actionType,
      },
    });

    const status = result.ok ? 200 : result.error === "RATE_LIMITED" ? 429 : 400;
    return json(result, status);
  } catch {
    return json({ ok: false, error: "OTP_START_FAILED", message: "Could not start OTP." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
