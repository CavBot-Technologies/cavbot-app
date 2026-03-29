import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertWriteOrigin, isApiAuthError } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value);
}

export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);
    const body = (await readSanitizedJson(req, {} as Record<string, unknown>)) as Record<string, unknown>;
    const email = normalizeEmail(body?.email);
    if (!email) return json({ ok: false, error: "email_required" }, 400);
    if (!isValidEmail(email)) return json({ ok: false, error: "invalid_email" }, 400);

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return json({ ok: true, exists: Boolean(user?.id) }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "lookup_failed" }, 500);
  }
}
