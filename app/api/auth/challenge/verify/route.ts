// app/api/auth/challenge/verify/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac } from "crypto";

import {
  assertWriteOrigin,
  createUserSession,
  isApiAuthError,
  sessionCookieOptions,
} from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import {
  findAuthTokenByHash,
  findFirstProjectIdByAccount,
  findMembershipsForUser,
  findUserAuth,
  findUserById,
  getAuthPool,
  markAuthTokenUsed,
  pickPrimaryMembership,
} from "@/lib/authDb";
import { readSanitizedJson } from "@/lib/security/userInput";
import { readCoarseRequestGeo } from "@/lib/requestGeo";
import { getAccountDisciplineState } from "@/lib/admin/accountDiscipline.server";

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

function sha256Hex(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

/* =========================
   TOTP helpers (for app 2FA)
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

function totpAt(secretB32: string, tMs: number, stepSeconds = 30, digits = 6): string {
  const key = base32ToBytes(secretB32);
  if (!key.length) return "";

  const counter = Math.floor(tMs / 1000 / stepSeconds);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const h = createHmac("sha1", key).update(buf).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin =
    ((h[offset] & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) << 8) |
    (h[offset + 3] & 0xff);

  const mod = bin % 10 ** digits;
  return String(mod).padStart(digits, "0");
}

function verifyTotp(code: string, secretB32: string): boolean {
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) return false;
  const now = Date.now();
  const candidates = [
    totpAt(secretB32, now - 30_000),
    totpAt(secretB32, now),
    totpAt(secretB32, now + 30_000),
  ];
  return candidates.includes(c);
}

/* =========================
   API
   ========================= */

type Role = "OWNER" | "ADMIN" | "MEMBER";
function normalizeRole(value: string | null | undefined): Role {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "OWNER") return "OWNER";
  if (normalized === "ADMIN") return "ADMIN";
  return "MEMBER";
}

type AuthTokenMeta = {
  purpose?: string;
  codeHash?: string;
  geoLabel?: string | null;
  location?: string | null;
  accountId?: string | null;
  [key: string]: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const pool = getAuthPool();
    assertWriteOrigin(req);

    const rawBody = await readSanitizedJson(req, null);
    const body = (rawBody && typeof rawBody === "object" ? rawBody : {}) as Record<string, unknown>;

    const challengeId = String(body.challengeId || "").trim();
    const method = String(body.method || "").trim().toLowerCase();
    const code = String(body.code || "").trim();

    if (!challengeId) return json({ ok: false, error: "BAD_INPUT", message: "Missing challengeId." }, 400);
    if (method !== "email" && method !== "app") return json({ ok: false, error: "BAD_INPUT", message: "Invalid method." }, 400);
    if (!/^\d{6}$/.test(code)) return json({ ok: false, error: "BAD_CODE", message: "Enter the 6-digit code." }, 400);

    const tokenHash = sha256Hex(challengeId);

    const token = await findAuthTokenByHash(pool, tokenHash);

    if (!token || token.type !== "EMAIL_RECOVERY") {
      return json({ ok: false, error: "CHALLENGE_NOT_FOUND", message: "Challenge not found." }, 404);
    }
    if (token.usedAt) return json({ ok: false, error: "CHALLENGE_USED", message: "This challenge was already used." }, 409);
    if (token.expiresAt && token.expiresAt.getTime() < Date.now()) {
      return json({ ok: false, error: "CHALLENGE_EXPIRED", message: "This code expired. Resend a new one." }, 410);
    }

    const meta = (token.metaJson || {}) as AuthTokenMeta;
    const purpose = String(meta.purpose || "").trim();

    if (method === "email") {
      if (purpose !== "2fa_email") {
        return json({ ok: false, error: "BAD_CHALLENGE", message: "Challenge is not valid for email verification." }, 400);
      }
      const expectedHash = String(meta.codeHash || "").trim();
      if (!expectedHash) return json({ ok: false, error: "BAD_CHALLENGE", message: "Challenge missing code hash." }, 400);
      if (sha256Hex(code) !== expectedHash) return json({ ok: false, error: "INVALID_CODE", message: "Invalid code." }, 403);
    }

    if (method === "app") {
      if (purpose !== "2fa_app") {
        return json({ ok: false, error: "BAD_CHALLENGE", message: "Challenge is not valid for authenticator verification." }, 400);
      }

      // NOTE: This requires you to have stored a Base32 secret on UserAuth.
      // Field name expected: totpSecret (String?)
      const auth = await findUserAuth(pool, token.userId);

      const secret = String(auth?.totpSecret || "").trim();
      if (!secret) return json({ ok: false, error: "2FA_NOT_CONFIGURED", message: "Authenticator 2FA is not configured." }, 409);
      if (!verifyTotp(code, secret)) return json({ ok: false, error: "INVALID_CODE", message: "Invalid code." }, 403);
    }

    // Resolve tenant context
    const user = await findUserById(pool, token.userId);
    const memberships = user ? await findMembershipsForUser(pool, user.id) : [];

    if (!user || !memberships.length) {
      return json({ ok: false, error: "NO_MEMBERSHIP", message: "No workspace membership found." }, 403);
    }

    const active = pickPrimaryMembership(memberships);
    if (!active) return json({ ok: false, error: "NO_MEMBERSHIP", message: "No workspace membership found." }, 403);
    {
      const discipline = await getAccountDisciplineState(active.accountId);
      if (discipline?.status === "REVOKED") {
        return json({ ok: false, error: "ACCOUNT_REVOKED", message: "This account has been revoked." }, 403);
      }
      if (discipline?.status === "SUSPENDED") {
        return json({ ok: false, error: "ACCOUNT_SUSPENDED", message: "This account is temporarily suspended." }, 403);
      }
    }

    // Mint real session cookie
    const memberRole = normalizeRole(active.role);
    const sessionToken = await createUserSession({
      userId: user.id,
      accountId: active.accountId,
      memberRole,
    });

    const res = json({ ok: true, accountId: active.accountId, memberRole }, 200);

    const { name, ...cookieOptsFromLib } = sessionCookieOptions(req);
    const cookieOpts = {
      ...cookieOptsFromLib,
      secure: process.env.NODE_ENV === "production" ? cookieOptsFromLib.secure : false,
    };
    res.cookies.set(name, sessionToken, cookieOpts);

    // pointer cookies
    const firstProject = await findFirstProjectIdByAccount(pool, active.accountId);

    if (firstProject?.id) {
      const pointerCookieOpts = {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      };
      res.cookies.set("cb_active_project_id", String(firstProject.id), pointerCookieOpts);
      res.cookies.set("cb_pid", String(firstProject.id), pointerCookieOpts);
    }

    // Mark used
    const geo = readCoarseRequestGeo(req);
    const loc = String(meta.geoLabel || meta.location || geo.label || "").trim() || null;

    await markAuthTokenUsed(pool, token.id);

    await auditLogWrite({
      request: req,
      action: "AUTH_SIGNED_IN",
      accountId: active.accountId,
      operatorUserId: user.id,
      targetType: "auth",
      targetId: user.id,
      targetLabel: user.email || user.username || user.id,
      metaJson: {
        security_event: "2fa_verified",
        method,
        location: loc,
        geoRegion: geo.region,
        geoCountry: geo.country,
      },
    });

    return res;
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "CHALLENGE_VERIFY_FAILED", message: "Verification failed." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
