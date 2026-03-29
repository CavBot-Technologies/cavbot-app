import { NextResponse } from "next/server";

import { assertWriteOrigin } from "@/lib/apiAuth";
import { evaluateVerifyRisk, parseRiskInteraction, parseVerifyActionType } from "@/lib/auth/cavbotVerify";
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

type RiskBody = {
  actionType?: unknown;
  sessionId?: unknown;
  route?: unknown;
  context?: unknown;
};

export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);

    const body = (await readSanitizedJson(req, ({}))) as RiskBody;
    const actionType = parseVerifyActionType(body?.actionType);
    if (!actionType) {
      return json({ ok: false, error: "BAD_ACTION", message: "Invalid actionType." }, 400);
    }

    const risk = evaluateVerifyRisk(req, {
      actionType,
      route: body?.route ? String(body.route) : "",
      sessionIdHint: body?.sessionId ? String(body.sessionId) : "",
      interaction: parseRiskInteraction(body?.context),
      mutate: true,
    });

    return json(
      {
        ok: true,
        decision: risk.decision,
        reasonCode: risk.reasonCode,
        challengeRequired: risk.challengeRequired,
        retryAfterSec: risk.retryAfterSec,
        sessionId: risk.sessionId,
      },
      200,
    );
  } catch {
    return json(
      {
        ok: true,
        decision: "block",
        reasonCode: "verify_internal_error",
        challengeRequired: false,
        retryAfterSec: 60,
      },
      200,
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
