import { NextResponse } from "next/server";

import { assertWriteOrigin, getSession } from "@/lib/apiAuth";
import { recordAdminEventSafe } from "@/lib/admin/events";
import { confirmVerifyOtp, parseVerifyActionType } from "@/lib/auth/cavbotVerify";
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

type OtpConfirmBody = {
  otpChallengeId?: unknown;
  code?: unknown;
  actionType?: unknown;
  sessionId?: unknown;
};

export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);
    const session = await getSession(req);
    const body = (await readSanitizedJson(req, ({}))) as OtpConfirmBody;

    const actionType = body?.actionType ? parseVerifyActionType(body.actionType) : null;
    if (body?.actionType && !actionType) {
      return json({ ok: false, error: "BAD_ACTION", message: "Invalid actionType." }, 400);
    }

    const result = confirmVerifyOtp(req, {
      otpChallengeId: body?.otpChallengeId ? String(body.otpChallengeId) : "",
      code: body?.code ? String(body.code) : "",
      actionType,
      sessionIdHint: body?.sessionId ? String(body.sessionId) : "",
    });

    await recordAdminEventSafe({
      name: result.ok ? "cavverify_passed" : "cavverify_failed",
      actorUserId: session?.systemRole === "user" ? session.sub : null,
      accountId: session?.systemRole === "user" ? session.accountId || null : null,
      sessionKey: body?.sessionId ? String(body.sessionId) : null,
      result: result.ok ? "otp_passed" : `otp_${String(result.error || "failed").toLowerCase()}`,
      metaJson: {
        actionType: actionType || null,
      },
    });

    return json(result, result.ok ? 200 : 400);
  } catch {
    return json(
      {
        ok: false,
        error: "OTP_CONFIRM_FAILED",
        message: "Could not confirm OTP.",
        attemptsRemaining: 0,
        fallbackAllowed: true,
      },
      500,
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
