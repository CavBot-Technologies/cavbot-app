// lib/apiAuth.ts
import "server-only";

import { createHmac as nodeCreateHmac, pbkdf2 as nodePbkdf2, webcrypto as nodeCrypto } from "crypto";
import type { NextResponse } from "next/server";
import { isAdminHost } from "@/lib/admin/config";
import {
  findMembershipsForUser,
  findSessionMembership,
  findUserAuth,
  pickPrimaryMembership,
  withDedicatedAuthClient,
  userHasOAuthIdentity,
} from "@/lib/authDb";
import { getAccountDisciplineState } from "@/lib/admin/accountDiscipline.server";

/**
 * CavBot Auth Model (Multi-tenant)
 * - System admin token: INTERNAL ONLY (ops / emergency)
 * - User sessions: cookie-based, signed (HMAC), short-lived, httpOnly
 * - Session carries active tenant context (accountId + memberRole)
 *
 * HARDENING:
 * - Origin enforcement for write methods
 * - Dev-safe cookie settings (Secure never set on http://localhost)
 * - Normalized allowed origins
 *
 * NOTE:
 * - This file is Node/runtime oriented (uses Prisma for session revocation checks).
 */

type SystemRole = "system" | "user";
export type MemberRole = "OWNER" | "ADMIN" | "MEMBER";

export type CavbotSession = {
  v: 1;

  // Subject: userId (or "system")
  sub: string;

  // System-level role
  systemRole: SystemRole;

  // Active tenant context (set for user sessions)
  accountId?: string;
  memberRole?: MemberRole;

  // Session version (DB-backed revocation)
  // Token carries `sv`; DB stores sessionVersion; mismatch => revoked
  sv?: number;

  iat: number;
  exp: number;
};

export type CavbotUserSession = CavbotSession & {
  systemRole: "user";
  sub: string;
};

export type CavbotAccountSession = CavbotUserSession & {
  accountId: string;
  memberRole: MemberRole;
};

export class ApiAuthError extends Error {
  code: string;
  status: number;

  constructor(code: string, status = 401) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function isApiAuthError(e: unknown): e is ApiAuthError {
  return !!e && typeof e === "object" && e !== null && "status" in e && "code" in e;
}

function authBackendUnavailableError() {
  return new ApiAuthError("AUTH_BACKEND_UNAVAILABLE", 503);
}

const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours
const CLOUDFLARE_PBKDF2_ITER_LIMIT = 100_000;
const AUTH_BACKEND_READ_TIMEOUT_MS = 1_200;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

async function withAuthBackendReadDeadline<T>(
  promise: Promise<T>,
  timeoutMs = AUTH_BACKEND_READ_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("AUTH_BACKEND_READ_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function env(name: string) {
  const envRecord = process.env as Record<string, string | undefined>;
  return String(envRecord[name] || "").trim();
}

function isWorkerdRuntime() {
  const versions = process.versions as NodeJS.ProcessVersions & { workerd?: string };
  return Boolean(versions.workerd) || env("CF_PAGES") === "1";
}

function resolvePasswordHashIterations(requestedIters: number) {
  if (isWorkerdRuntime() && requestedIters > CLOUDFLARE_PBKDF2_ITER_LIMIT) {
    return CLOUDFLARE_PBKDF2_ITER_LIMIT;
  }
  return requestedIters;
}

const SESSION_COOKIE = env("CAVBOT_SESSION_COOKIE_NAME") || "cavbot_session";

function getCrypto(): Crypto {
  if (globalThis.crypto?.subtle) return globalThis.crypto;
  return nodeCrypto as Crypto;
}

/* ==========================
   ORIGIN NORMALIZATION
========================== */

function normalizeOriginValue(raw: string): string | null {
  const v = (raw || "").trim();
  if (!v) return null;

  const hasScheme = /^https?:\/\//i.test(v);
  const withScheme = hasScheme
    ? v
    : v.includes("localhost") || v.startsWith("127.") || v.endsWith(".local")
    ? `http://${v}`
    : `https://${v}`;

  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

function normalizeHostValue(raw: string): string {
  return String(raw || "")
    .trim()
    .split(",")[0]
    .trim()
    .replace(/:\d+$/, "")
    .toLowerCase();
}

function hostnameFromOriginValue(raw: string): string {
  const normalized = normalizeOriginValue(raw);
  if (!normalized) return normalizeHostValue(raw);
  try {
    return normalizeHostValue(new URL(normalized).hostname);
  } catch {
    return normalizeHostValue(raw);
  }
}

function normalizeCookieDomainValue(raw: string): string {
  return normalizeHostValue(raw).replace(/^\.+/, "");
}

function inferFirstPartyCookieDomain(host: string): string {
  const normalizedHost = normalizeHostValue(host);
  if (!normalizedHost || isLocalhostHost(normalizedHost)) return "";
  if (normalizedHost === "cavbot.io" || normalizedHost.endsWith(".cavbot.io")) return "cavbot.io";
  return "";
}

function isConfiguredAdminOrigin(origin: string) {
  const normalized = normalizeOriginValue(origin);
  if (!normalized) return false;

  try {
    return isAdminHost(new URL(normalized).host.toLowerCase());
  } catch {
    return false;
  }
}

function inferRequestOrigin(req: Request): string {
  const origin = String(req.headers.get("origin") || "").trim();
  if (origin) return origin;

  const proto = String(req.headers.get("x-forwarded-proto") || "").trim();
  const host = String(req.headers.get("x-forwarded-host") || req.headers.get("host") || "").trim();
  if (proto && host) return `${proto}://${host}`;

  return "";
}

export function getAppOrigin() {
  const candidates = [
    env("CAVBOT_APP_ORIGIN"),
    env("APP_URL"),
    env("NEXT_PUBLIC_APP_URL"),
    env("NEXT_PUBLIC_APP_ORIGIN"),
    env("APP_ORIGIN"),
    env("NEXTAUTH_URL"),
  ];
  for (const candidate of candidates) {
    const normalized = normalizeOriginValue(candidate);
    if (normalized) return normalized;
  }

  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  throw new Error("Missing app origin env. Set CAVBOT_APP_ORIGIN for production.");
}

export function getAllowedOrigins(): string[] {
  const primary = getAppOrigin();
  const firstPartyDomain = resolveSessionCookieDomain();

  const raw = env("ALLOWED_ORIGINS");
  const list = raw
    ? raw
        .split(",")
        .map((s) => normalizeOriginValue(s))
        .filter(Boolean) as string[]
    : [];

  const devDefaults =
    process.env.NODE_ENV === "production"
      ? []
      : [
          "http://localhost:3000",
          "http://127.0.0.1:3000",
          "http://localhost:3001",
          "http://127.0.0.1:3001",
        ];

  const firstPartyOrigins = firstPartyDomain
    ? [
        `https://${firstPartyDomain}`,
        `https://www.${firstPartyDomain}`,
        `https://app.${firstPartyDomain}`,
        `https://ai.${firstPartyDomain}`,
        env("CAVAI_URL"),
        env("NEXT_PUBLIC_CAVAI_URL"),
        env("NEXT_PUBLIC_CAVAI_ORIGIN"),
        env("AUTH_REDIRECT_BASE_URL"),
      ]
        .map((candidate) => normalizeOriginValue(candidate))
        .filter(Boolean) as string[]
    : [];

  return Array.from(new Set([primary, ...list, ...firstPartyOrigins, ...devDefaults]));
}

/* ==========================
   BASE64 / BASE64URL HELPERS
========================== */

function isBase64Url(s: string) {
  const v = String(s || "");
  return v.includes("-") || v.includes("_");
}

function b64Encode(bytes: Uint8Array) {
  if (typeof btoa === "function") {
    let str = "";
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str);
  }
  return Buffer.from(bytes).toString("base64");
}

function b64DecodeToBytes(b64: string) {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function base64urlEncode(bytes: Uint8Array) {
  const b64 = b64Encode(bytes);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlToBase64(s: string) {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return s.replace(/-/g, "+").replace(/_/g, "/") + pad;
}

function decodeAnyBase64ToBytes(s: string) {
  const v = String(s || "").trim();
  if (!v) return new Uint8Array();

  if (isBase64Url(v)) return b64DecodeToBytes(base64urlToBase64(v));
  return b64DecodeToBytes(v);
}

function encodeLikeExpected(bytes: Uint8Array, expected: string) {
  return isBase64Url(expected) ? base64urlEncode(bytes) : b64Encode(bytes);
}

/* ==========================
   CONSTANT TIME COMPARE
========================== */

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/* ==========================
   HMAC SIGNING
========================== */

async function hmacSha256(secret: string, data: string) {
  const c = getCrypto();
  const key = await c.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await c.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64urlEncode(new Uint8Array(sig));
}

/* ==========================
   COOKIE PARSING
========================== */

function parseCookieValues(header: string, name: string) {
  const parts = (header || "")
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean);

  const values: string[] = [];
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k === name && v) values.push(v);
  }

  return values;
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

/* ==========================
   WRITE ORIGIN ENFORCEMENT
========================== */

export function assertWriteOrigin(req: Request) {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const inferred = inferRequestOrigin(req);
  const origin = normalizeOriginValue(inferred) || inferred;
  if (!origin) return;

  const allowed = getAllowedOrigins();
  if (allowed.includes(origin)) return;

  if (isConfiguredAdminOrigin(origin)) return;

  if (process.env.NODE_ENV !== "production") {
    if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return;
  }

  throw new ApiAuthError("BAD_ORIGIN", 403);
}

/* ==========================
   SYSTEM ADMIN TOKEN
========================== */

export function requireSystemToken(req: Request) {
  if (process.env.NODE_ENV !== "production" && env("CAVBOT_DEV_NO_ADMIN") === "1") return;

  const expected = env("CAVBOT_ADMIN_TOKEN");
  if (!expected) throw new ApiAuthError("MISSING_ADMIN_TOKEN_ENV", 500);

  const token = getBearerToken(req) || String(req.headers.get("x-admin-token") || "").trim();
  if (!token) throw new ApiAuthError("UNAUTHORIZED", 401);
  if (!constantTimeEqual(token, expected)) throw new ApiAuthError("UNAUTHORIZED", 401);
}

/* ==========================
   PASSWORD HASHING
========================== */

export async function hashPassword(password: string) {
  const algo = "pbkdf2_sha256";
  const requestedIters = Number(env("CAVBOT_PBKDF2_ITERS") || 210_000);
  const iters = resolvePasswordHashIterations(requestedIters);

  const c = getCrypto();
  const salt = c.getRandomValues(new Uint8Array(16));

  const saltB64 = base64urlEncode(salt);

  const bits = await pbkdf2Sha256Bits(password, salt, iters, 32);
  const hashB64 = base64urlEncode(new Uint8Array(bits));

  return { algo, iters, salt: saltB64, hash: hashB64 };
}

export async function verifyPassword(password: string, saltB64: string, iters: number, expectedHashB64: string) {
  const salt = decodeAnyBase64ToBytes(saltB64);

  const bits = await pbkdf2Sha256Bits(password, salt, iters, 32);
  const derivedBytes = new Uint8Array(bits);

  const derived = encodeLikeExpected(derivedBytes, expectedHashB64);
  return constantTimeEqual(String(expectedHashB64 || ""), derived);
}

async function pbkdf2Sha256Bits(password: string, salt: Uint8Array, iters: number, byteLen: number) {
  // Prefer Node's PBKDF2 implementation under nodejs_compat. Cloudflare's WebCrypto
  // PBKDF2 currently rejects iteration counts above 100000, but existing CavBot auth
  // records and env defaults can legitimately exceed that.
  try {
    const derived = await new Promise<Buffer>((resolve, reject) => {
      nodePbkdf2(password, Buffer.from(salt), iters, byteLen, "sha256", (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
    return derived.buffer.slice(derived.byteOffset, derived.byteOffset + derived.byteLength);
  } catch {
    // Fall back when Node PBKDF2 is unavailable or runtime-limited.
  }

  if (iters > CLOUDFLARE_PBKDF2_ITER_LIMIT) {
    return pbkdf2Sha256BitsWithHmac(password, salt, iters, byteLen);
  }

  const c = getCrypto();

  const key = await c.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const algo = {
    name: "PBKDF2",
    hash: { name: "SHA-256" },
    salt:
      salt.byteOffset === 0 && salt.byteLength === salt.buffer.byteLength
        ? salt.buffer
        : salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength),
    iterations: iters,
  } as Pbkdf2Params;

  return await c.subtle.deriveBits(algo, key, byteLen * 8);
}

function pbkdf2Sha256BitsWithHmac(password: string, salt: Uint8Array, iters: number, byteLen: number) {
  const blockSize = 32;
  const blockCount = Math.ceil(byteLen / blockSize);
  const derived = new Uint8Array(blockCount * blockSize);
  const blockIndex = Buffer.alloc(4);

  for (let block = 1; block <= blockCount; block++) {
    blockIndex.writeUInt32BE(block, 0);

    let u = Uint8Array.from(
      nodeCreateHmac("sha256", password)
        .update(Buffer.from(salt))
        .update(blockIndex)
        .digest()
    );
    const t = Uint8Array.from(u);

    for (let iteration = 1; iteration < iters; iteration++) {
      u = Uint8Array.from(nodeCreateHmac("sha256", password).update(u).digest());
      for (let i = 0; i < t.length; i++) {
        t[i] ^= u[i];
      }
    }

    derived.set(t, (block - 1) * blockSize);
  }

  return derived.slice(0, byteLen).buffer;
}

/* ==========================
   SESSION TOKENS
   Format: base64url(payloadJson).base64url(signature)
========================== */

async function signSession(payload: CavbotSession) {
  const secret = env("CAVBOT_SESSION_SECRET");
  if (!secret) throw new ApiAuthError("MISSING_SESSION_SECRET_ENV", 500);

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64urlEncode(new TextEncoder().encode(payloadJson));
  const sig = await hmacSha256(secret, payloadB64);

  return `${payloadB64}.${sig}`;
}

async function verifySession(token: string): Promise<CavbotSession> {
  const secret = env("CAVBOT_SESSION_SECRET");
  if (!secret) throw new ApiAuthError("MISSING_SESSION_SECRET_ENV", 500);

  const parts = token.split(".");
  if (parts.length !== 2) throw new ApiAuthError("BAD_TOKEN_FORMAT", 401);

  const payloadB64 = parts[0];
  const sig = parts[1];

  const expected = await hmacSha256(secret, payloadB64);
  if (!constantTimeEqual(sig, expected)) throw new ApiAuthError("BAD_SIGNATURE", 401);

  let payload: CavbotSession;
  try {
    const payloadJson = new TextDecoder().decode(decodeAnyBase64ToBytes(payloadB64));
    payload = JSON.parse(payloadJson) as CavbotSession;
  } catch {
    throw new ApiAuthError("BAD_PAYLOAD", 401);
  }

  if (!payload?.exp || !payload?.iat) throw new ApiAuthError("BAD_PAYLOAD", 401);
  if (payload.v !== 1) throw new ApiAuthError("BAD_VERSION", 401);
  if (!payload.sub || !payload.systemRole) throw new ApiAuthError("BAD_PAYLOAD", 401);
  if (nowSec() > payload.exp) throw new ApiAuthError("EXPIRED", 401);

  return payload;
}

/* ==========================
   CREATE SESSIONS
========================== */

export async function createSystemSession() {
  const iat = nowSec();
  const session: CavbotSession = {
    v: 1,
    sub: "system",
    systemRole: "system",
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  };
  return await signSession(session);
}

export async function createUserSession(args: {
  userId: string;
  accountId: string;
  memberRole: MemberRole;
  sessionVersion?: number; // ✅ now supported
}) {
  const iat = nowSec();

  const sv = Number.isFinite(Number(args.sessionVersion)) ? Number(args.sessionVersion) : 1;

  const session: CavbotSession = {
    v: 1,
    sub: args.userId,
    systemRole: "user",
    accountId: args.accountId,
    memberRole: args.memberRole,
    sv,
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  };

  return await signSession(session);
}

/* ==========================
   COOKIE OPTIONS
========================== */

function isProd() {
  return process.env.NODE_ENV === "production";
}

function isLocalhostHost(host: string) {
  const h = (host || "").toLowerCase();
  return h.includes("localhost") || h.startsWith("127.0.0.1") || h.startsWith("0.0.0.0");
}

export function resolveSessionCookieDomain(req?: Request) {
  const explicit = normalizeCookieDomainValue(env("CAVBOT_SESSION_COOKIE_DOMAIN"));
  if (explicit) return explicit;

  const requestHost = normalizeHostValue(
    req ? String(req.headers.get("x-forwarded-host") || req.headers.get("host") || "") : ""
  );
  const requestDerived = inferFirstPartyCookieDomain(requestHost);
  if (requestDerived) return requestDerived;

  const appHost = hostnameFromOriginValue(getAppOrigin());
  return inferFirstPartyCookieDomain(appHost);
}

export function sessionCookieOptions(req?: Request) {
  const prod = isProd();
  let secure = prod;
  const cookieDomain = resolveSessionCookieDomain(req);

  if (!prod) {
    secure = false;

    const allowDevSecure = env("CAVBOT_DEV_SECURE_COOKIE") === "1";
    if (allowDevSecure && req) {
      const host = String(req.headers.get("host") || "");
      const fp = String(req.headers.get("x-forwarded-proto") || "").toLowerCase();
      if (!isLocalhostHost(host) && fp === "https") secure = true;
    }
  }

  return {
    name: SESSION_COOKIE,
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

function sessionCookieWriteOptions(req?: Request) {
  const { name, ...cookieOptsFromLib } = sessionCookieOptions(req);
  return {
    name,
    cookieOpts: {
      ...cookieOptsFromLib,
      secure: process.env.NODE_ENV === "production" ? cookieOptsFromLib.secure : false,
    },
  };
}

function hostOnlyCookieOptions<T extends { domain?: string }>(cookieOpts: T) {
  const hostOnlyOpts = { ...cookieOpts };
  delete hostOnlyOpts.domain;
  return hostOnlyOpts;
}

export function writeSessionCookie(req: Request, res: NextResponse<unknown>, token: string): NextResponse<unknown> {
  const { name, cookieOpts } = sessionCookieWriteOptions(req);
  if (!cookieOpts.domain) {
    res.cookies.set(name, token, cookieOpts);
    return res;
  }

  const hostOnlyOpts = hostOnlyCookieOptions(cookieOpts);

  // Pages can collapse same-name Set-Cookie headers, so avoid a follow-up host-only clear here.
  try {
    res.cookies.set(name, token, cookieOpts);
    return res;
  } catch (error) {
    console.warn("[auth] shared session cookie write failed; falling back to host-only cookie", error);
    res.cookies.set(name, token, hostOnlyOpts);
    return res;
  }
}

export function expireSessionCookie(req: Request, res: NextResponse<unknown>): NextResponse<unknown> {
  const { name, cookieOpts } = sessionCookieWriteOptions(req);
  if (!cookieOpts.domain) {
    res.cookies.set(name, "", { ...cookieOpts, maxAge: 0 });
    return res;
  }

  const hostOnlyOpts = hostOnlyCookieOptions(cookieOpts);

  // Clear host-only first so the shared-domain clear is the final cookie write if the platform dedupes.
  try {
    res.cookies.set(name, "", { ...hostOnlyOpts, maxAge: 0 });
  } catch (error) {
    console.warn("[auth] legacy host-only session cookie clear failed", error);
  }

  try {
    res.cookies.set(name, "", { ...cookieOpts, maxAge: 0 });
  } catch (error) {
    console.warn("[auth] shared session cookie clear failed", error);
  }

  return res;
}

/* ==========================
   SESSION READERS
========================== */

export async function readVerifiedSession(req: Request): Promise<CavbotSession | null> {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const cookieTokens = parseCookieValues(cookieHeader, SESSION_COOKIE);
    const bearer = getBearerToken(req);
    const cookieFirstCandidates = Array.from(
      new Set(
        [...cookieTokens, bearer].map((token) => String(token || "").trim()).filter(Boolean),
      ),
    );

    if (!cookieFirstCandidates.length) return null;
    for (const token of cookieFirstCandidates) {
      try {
        return await verifySession(token);
      } catch {
        // try next candidate token
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function getSession(req: Request): Promise<CavbotSession | null> {
  try {
    const sess = await readVerifiedSession(req);
    if (!sess) return null;
    if (sess?.systemRole === "user" && sess.sub && sess.sub !== "system") {
      try {
        const userId = String(sess.sub);
        await withDedicatedAuthClient(async (authClient) => {
          let activeMembership = null;

          if (sess.accountId) {
            activeMembership = await withAuthBackendReadDeadline(
              findSessionMembership(authClient, userId, String(sess.accountId)),
            );
          }

          if (!activeMembership || !sess.memberRole) {
            const memberships = await withAuthBackendReadDeadline(findMembershipsForUser(authClient, userId));
            const active = pickPrimaryMembership(memberships);
            if (active?.accountId) {
              sess.accountId = String(active.accountId);
              sess.memberRole = active.role;
            }
          } else {
            sess.accountId = String(activeMembership.accountId);
            sess.memberRole = activeMembership.role;
          }
        });
      } catch {}
    }
    return sess;
  } catch {
    return null;
  }
}

// Low-risk write routes such as UI preference sync and active-project cookie updates
// may proceed from a valid signed session token even when the auth backend is
// temporarily unavailable. Route handlers must still enforce their own account
// ownership checks after calling this helper.
export async function requireLowRiskWriteSession(req: Request): Promise<CavbotSession> {
  assertWriteOrigin(req);
  const verified = await readVerifiedSession(req);
  if (!verified) throw new ApiAuthError("UNAUTHORIZED", 401);

  // Low-risk routes should continue to work from a valid signed session even when
  // the auth backend is slow or temporarily unavailable.
  if (verified.systemRole !== "user" || (verified.accountId && verified.memberRole)) {
    return verified;
  }

  try {
    const hydrated = await Promise.race([
      getSession(req),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 1_200);
      }),
    ]);
    return hydrated || verified;
  } catch {
    return verified;
  }
}

function canFailOpenAuthenticatedRead(req: Request) {
  if (process.env.NODE_ENV !== "production") return true;
  const method = String(req.method || "GET").trim().toUpperCase();
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export async function requireSession(req: Request): Promise<CavbotSession> {
  assertWriteOrigin(req);

  const sess = await getSession(req);
  if (!sess) throw new ApiAuthError("UNAUTHORIZED", 401);

  // DB-backed session invalidation for user sessions
  if (sess.systemRole === "user" && sess.sub && sess.sub !== "system") {
    const userId = String(sess.sub);
    try {
      await withDedicatedAuthClient(async (authClient) => {
        if (!sess.accountId || !sess.memberRole) {
          const memberships = await withAuthBackendReadDeadline(findMembershipsForUser(authClient, userId));
          const active = pickPrimaryMembership(memberships);

          if (!active?.accountId) throw new ApiAuthError("UNAUTHORIZED", 401);

          sess.accountId = String(active.accountId);
          sess.memberRole = active.role;
        }

        // Requires UserAuth.sessionVersion. In dev/bootstrap, schema may lag; don't brick the app.
        const auth = await withAuthBackendReadDeadline(findUserAuth(authClient, userId));

        if (!auth) {
          // OAuth-only users may not have a UserAuth row yet; allow signed session tokens
          // for those identities so protected APIs do not hard-fail.
          if (await withAuthBackendReadDeadline(userHasOAuthIdentity(authClient, userId))) return;

          if (process.env.NODE_ENV !== "production") return;
          throw new ApiAuthError("UNAUTHORIZED", 401);
        }

        // Backward compatibility: legacy tokens minted before sv existed are treated as sv=1.
        const tokenSvRaw = Number(sess.sv ?? 1);
        const tokenSv =
          Number.isFinite(tokenSvRaw) && Number.isInteger(tokenSvRaw) && tokenSvRaw > 0
            ? tokenSvRaw
            : 1;
        const dbSv = Number(auth.sessionVersion ?? 0);

        // If DB hasn't been initialized yet, treat as 1
        const dbEffective = dbSv > 0 ? dbSv : 1;

        if (!tokenSv || tokenSv !== dbEffective) {
          if (process.env.NODE_ENV !== "production") return;
          throw new ApiAuthError("SESSION_REVOKED", 401);
        }
      });
    } catch (error) {
      if (error instanceof ApiAuthError) throw error;
      if (canFailOpenAuthenticatedRead(req)) return sess;
      throw authBackendUnavailableError();
    }

    try {
      const discipline = await withAuthBackendReadDeadline(
        getAccountDisciplineState(String(sess.accountId || "")),
      );
      if (discipline?.status === "REVOKED") {
        throw new ApiAuthError("ACCOUNT_REVOKED", 403);
      }
      if (discipline?.status === "SUSPENDED") {
        throw new ApiAuthError("ACCOUNT_SUSPENDED", 403);
      }
    } catch (error) {
      if (error instanceof ApiAuthError) throw error;
      if (canFailOpenAuthenticatedRead(req)) return sess;
      throw authBackendUnavailableError();
    }
  }

  return sess;
}

/* ==========================
   GUARDS
========================== */

export function requireUser(sess: CavbotSession): asserts sess is CavbotUserSession {
  if (sess.systemRole !== "user") throw new ApiAuthError("UNAUTHORIZED", 401);
  if (!sess.sub || sess.sub === "system") throw new ApiAuthError("UNAUTHORIZED", 401);
}

export function requireAccountContext(sess: CavbotSession): asserts sess is CavbotAccountSession {
  requireUser(sess);
  if (!sess.accountId || !sess.memberRole) throw new ApiAuthError("UNAUTHORIZED", 401);
}

export function requireAccountRole(sess: CavbotSession, roles: MemberRole[]): asserts sess is CavbotAccountSession {
  requireAccountContext(sess);
  if (!roles.includes(sess.memberRole)) throw new ApiAuthError("UNAUTHORIZED", 403);
}
