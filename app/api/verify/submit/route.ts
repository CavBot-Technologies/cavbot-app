import { NextResponse } from "next/server";

import { assertWriteOrigin } from "@/lib/apiAuth";
import { submitVerifyChallenge } from "@/lib/auth/cavbotVerify";
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

type SubmitBody = {
  challengeId?: unknown;
  challengeToken?: unknown;
  nonce?: unknown;
  chosenTileId?: unknown;
  answer?: {
    tileId?: unknown;
  } | null;
  gestureSummary?: unknown;
  sessionId?: unknown;
};

export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);
    const body = (await readSanitizedJson(req, ({}))) as SubmitBody;

    const result = submitVerifyChallenge(req, {
      challengeId: body?.challengeId ? String(body.challengeId) : "",
      challengeToken: body?.challengeToken ? String(body.challengeToken) : "",
      nonce: body?.nonce ? String(body.nonce) : "",
      chosenTileId: body?.chosenTileId ? String(body.chosenTileId) : "",
      answer: {
        tileId: body?.answer?.tileId ? String(body.answer.tileId) : "",
      },
      gestureSummary: body?.gestureSummary ?? null,
      sessionIdHint: body?.sessionId ? String(body.sessionId) : "",
    });

    return json(result, result.ok ? 200 : 400);
  } catch {
    return json(
      {
        ok: false,
        error: "VERIFY_SUBMIT_FAILED",
        message: "Verification failed.",
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
