import { NextResponse } from "next/server";

import { assertWriteOrigin } from "@/lib/apiAuth";
import { createVerifyChallenge, parseVerifyActionType } from "@/lib/auth/cavbotVerify";
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

type ChallengeBody = {
  actionType?: unknown;
  sessionId?: unknown;
  route?: unknown;
};

export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);

    const body = (await readSanitizedJson(req, ({}))) as ChallengeBody;
    const actionType = parseVerifyActionType(body?.actionType);
    if (!actionType) {
      return json({ ok: false, error: "BAD_ACTION", message: "Invalid actionType." }, 400);
    }

    const created = createVerifyChallenge(req, {
      actionType,
      route: body?.route ? String(body.route) : "",
      sessionIdHint: body?.sessionId ? String(body.sessionId) : "",
    });

    if (!created.ok) {
      const status = created.error === "RATE_LIMITED" ? 429 : 400;
      return json(created, status);
    }

    return json(created, 200);
  } catch {
    return json({ ok: false, error: "CHALLENGE_CREATE_FAILED", message: "Failed to create challenge." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
