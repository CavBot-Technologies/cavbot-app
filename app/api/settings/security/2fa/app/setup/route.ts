import "server-only";

import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { readSecurityUserAuth, storePendingTotpSecret } from "@/lib/settings/securityRuntime.server";

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

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function base32Encode(buf: Buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function maskSecret(secretB32: string) {
  const s = String(secretB32 || "");
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

async function makeQrSvg(otpauthUrl: string): Promise<string | null> {
  try {
    const mod = await import("qrcode");
    const QRCode = mod as unknown as {
      toString: (text: string, opts: { type: "svg"; margin: number; width: number }) => Promise<string>;
    };
    return await QRCode.toString(otpauthUrl, { type: "svg", margin: 1, width: 180 });
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSettingsOwnerSession(req);
    const userId = sess.sub;

    const auth = await readSecurityUserAuth(userId);
    if (!auth) return json({ ok: false, error: "AUTH_NOT_FOUND", message: "Auth record not found." }, 404);

    if (auth.twoFactorAppEnabled && auth.totpSecret) {
      return json(
        {
          ok: true,
          alreadyEnabled: true,
          secretMasked: maskSecret(String(auth.totpSecret)),
        },
        200,
      );
    }

    const secretRaw = randomBytes(20);
    const secretB32 = base32Encode(secretRaw);

    const issuer = "CavBot";
    const label = encodeURIComponent(`CavBot:${safeStr(sess.accountId) || "account"}`);
    const otpauthUrl = `otpauth://totp/${label}?secret=${encodeURIComponent(secretB32)}&issuer=${encodeURIComponent(
      issuer,
    )}&digits=6&period=30`;

    const updated = await storePendingTotpSecret(userId, secretB32);
    if (!updated) return json({ ok: false, error: "AUTH_NOT_FOUND", message: "Auth record not found." }, 404);

    const qrSvg = await makeQrSvg(otpauthUrl);

    return json(
      {
        ok: true,
        otpauthUrl,
        secretOnce: secretB32,
        secretMasked: maskSecret(secretB32),
        qrSvg,
      },
      200,
    );
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "TOTP_SETUP_FAILED", message: "Failed to start authenticator setup." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
