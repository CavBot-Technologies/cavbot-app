import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

import { prisma } from "@/lib/prisma";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
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

/* =========================
  TOTP helpers
  ========================= */

function base32ToBytes(b32: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(b32 || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (!clean) return Buffer.alloc(0);

  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpNow(secretB32: string, stepSeconds = 30, digits = 6, t = Date.now()): string {
  const key = base32ToBytes(secretB32);
  if (!key.length) return "";

  const counter = Math.floor(t / 1000 / stepSeconds);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const h = createHmac("sha1", key).update(buf).digest();
  const offset = h[h.length - 1] & 0x0f;
  const binCode =
    ((h[offset] & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) << 8) |
    (h[offset + 3] & 0xff);

  const mod = binCode % 10 ** digits;
  return String(mod).padStart(digits, "0");
}

function verifyTotp(code: string, secretB32: string): boolean {
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) return false;

  // small drift window
  const now = Date.now();
  const candidates = [
    totpNow(secretB32, 30, 6, now - 30_000),
    totpNow(secretB32, 30, 6, now),
    totpNow(secretB32, 30, 6, now + 30_000),
  ];

  return candidates.includes(c);
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSettingsOwnerSession(req);

    const userId = sess.sub;

    const body = (await readSanitizedJson(req, null)) as null | { code?: string };
    const code = String(body?.code || "").trim();

    if (!/^\d{6}$/.test(code)) {
      return json({ ok: false, error: "BAD_CODE", message: "Enter the 6-digit code." }, 400);
    }

    const auth = await prisma.userAuth.findUnique({
      where: { userId },
      select: { totpSecretPending: true, twoFactorAppEnabled: true, sessionVersion: true },
    });

    if (!auth) return json({ ok: false, error: "AUTH_NOT_FOUND", message: "Auth record not found." }, 404);

    const pending = String(auth.totpSecretPending || "").trim();
    if (!pending) {
      return json({ ok: false, error: "NO_PENDING_SECRET", message: "No authenticator setup in progress." }, 409);
    }

    if (!verifyTotp(code, pending)) {
      return json({ ok: false, error: "INVALID_CODE", message: "Invalid code." }, 403);
    }

    // Commit + enable + rotate sessions (recommended)
    await prisma.userAuth.update({
      where: { userId },
      data: {
        totpSecret: pending,
        totpSecretPending: null,
        twoFactorAppEnabled: true,
        sessionVersion: Number(auth.sessionVersion || 1) + 1,
      },
    });

    return json({ ok: true }, 200);
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ ok: false, error: e.code, message: e.message }, e.status);
    return json({ ok: false, error: "TOTP_CONFIRM_FAILED", message: "Failed to confirm authenticator setup." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
