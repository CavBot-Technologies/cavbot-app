import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, verifyPassword } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { disableTotpForUser, readSecurityUserAuth } from "@/lib/settings/securityRuntime.server";
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

function json<T>(data: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, { ...resInit, headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS } });
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSettingsOwnerSession(req);
    const userId = sess.sub;

    const body = (await readSanitizedJson(req, null)) as null | { password?: string };
    const password = String(body?.password || "");
    if (!password) return json({ ok: false, error: "BAD_INPUT", message: "Password is required." }, 400);

    const auth = await readSecurityUserAuth(userId);
    if (!auth) return json({ ok: false, error: "AUTH_NOT_FOUND", message: "Auth record not found." }, 404);

    const salt = String(auth.passwordSalt || "");
    const hash = String(auth.passwordHash || "");
    const iters = Number(auth.passwordIters ?? 210000);

    const ok = await verifyPassword(password, salt, iters, hash);
    if (!ok) return json({ ok: false, error: "INVALID_PASSWORD", message: "Password is incorrect." }, 403);

    const sv = Number(auth.sessionVersion ?? 1);
    const disabled = await disableTotpForUser({
      userId,
      nextSessionVersion: sv + 1,
    });
    if (!disabled) return json({ ok: false, error: "AUTH_NOT_FOUND", message: "Auth record not found." }, 404);

    return json({ ok: true }, 200);
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ ok: false, error: e.code, message: e.message }, e.status);
    return json({ ok: false, error: "TOTP_DISABLE_FAILED", message: "Failed to disable authenticator." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
