// lib/apiAuth.ts
import "server-only";

/**
 * CavBot Auth Model (Multi-tenant)
 * - System admin token: INTERNAL ONLY (ops / emergency)
 * - User sessions: cookie-based, signed (HMAC), short-lived, httpOnly
 * - Session carries active account context (accountId + memberRole)
 * - Works on Cloudflare/edge runtimes (Web Crypto) + Node (WebCrypto)
 */

type SystemRole = "system" | "user";
type MemberRole = "OWNER" | "ADMIN" | "MEMBER";

export type CavbotSession = {
  v: 1;

  // Subject: userId (or "system")
  sub: string;

  // System-level role
  systemRole: SystemRole;

  // Active tenant context (set for user sessions)
  accountId?: string;
  memberRole?: MemberRole;

  iat: number;
  exp: number;
};

const SESSION_COOKIE = "cavbot_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Env helper (safe in local + Cloudflare/edge)
 */
function env(name: string) {
  return String((process.env as any)?.[name] || "").trim();
}

/**
 * Origins
 * - CAVBOT_APP_ORIGIN: primary app origin (ex: https://app.cavbot.io)
 * - ALLOWED_ORIGINS: comma-separated origins allowed for state-changing requests
 */
export function getAppOrigin() {
  return env("CAVBOT_APP_ORIGIN") || "http://localhost:3000";
}

export function getAllowedOrigins(): string[] {
  const primary = getAppOrigin();
  const raw = env("ALLOWED_ORIGINS"); // ex: "https://app.cavbot.io,https://cavbot.io"
  const list = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const merged = [primary, ...list].map((s) => s.trim()).filter(Boolean);
  // de-dupe
  return Array.from(new Set(merged));
}

/** Base64 helpers that work in Node + Edge */
function b64Encode(bytes: Uint8Array) {
  if (typeof btoa === "function") {
    let str = "";
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str);
  }
  // Node fallback
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const buf = Buffer.from(bytes);
  return buf.toString("base64");
}

function b64DecodeToBytes(b64: string) {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  const buf = Buffer.from(b64, "base64");
  return new Uint8Array(buf);
}

function base64urlEncode(bytes: Uint8Array) {
  const b64 = b64Encode(bytes);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecodeToBytes(s: string) {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return b64DecodeToBytes(b64);
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacSha256(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64urlEncode(new Uint8Array(sig));
}

function parseCookie(header: string, name: string) {
  const parts = header.split(";").map((v) => v.trim());
  for (const p of parts) {
    if (!p) continue;
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k === name) return v;
  }
  return "";
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

/**
 * Same-origin enforcement (CSRF hardening)
 * - Enforce only for state-changing requests
 * - Allows multiple trusted origins (ALLOWED_ORIGINS)
 */
export function assertWriteOrigin(req: Request) {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const origin = String(req.headers.get("origin") || "").trim();

  // If no Origin header exists (some server-to-server calls), allow.
  if (!origin) return;

  const allowed = getAllowedOrigins();
  if (!allowed.includes(origin)) {
    const err = new Error("BAD_ORIGIN");
    (err as any).code = "bad_origin";
    throw err;
  }
}

/**
 * SYSTEM ADMIN TOKEN (internal only)
 * - keep for ops / emergency tooling / secure admin endpoints
 */
export function requireSystemToken(req: Request) {
  if (process.env.NODE_ENV !== "production" && env("CAVBOT_DEV_NO_ADMIN") === "1") return;

  const expected = env("CAVBOT_ADMIN_TOKEN");
  if (!expected) throw new Error("Missing env: CAVBOT_ADMIN_TOKEN");

  const token = getBearerToken(req) || String(req.headers.get("x-admin-token") || "").trim();
  if (!token) throw new Error("UNAUTHORIZED");
  if (!constantTimeEqual(token, expected)) throw new Error("UNAUTHORIZED");
}

/**
 * PASSWORD HASHING (Edge-safe)
 * PBKDF2-SHA256, per-user random salt
 * Stores: algo + iters + salt + hash in DB (UserAuth)
 */
export async function hashPassword(password: string) {
  const algo = "pbkdf2_sha256";
  const iters = 210000;

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = base64urlEncode(salt);

  const hashB64 = await pbkdf2Sha256(password, salt, iters, 32);
  return { algo, iters, salt: saltB64, hash: hashB64 };
}

export async function verifyPassword(password: string, saltB64: string, iters: number, expectedHashB64: string) {
  const salt = base64urlDecodeToBytes(saltB64);
  const hashB64 = await pbkdf2Sha256(password, salt, iters, 32);
  return constantTimeEqual(hashB64, expectedHashB64);
}

async function pbkdf2Sha256(password: string, salt: Uint8Array, iters: number, byteLen: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

const algo = {
  name: "PBKDF2",
  hash: { name: "SHA-256" },
  salt: salt.byteOffset === 0 && salt.byteLength === salt.buffer.byteLength
    ? salt.buffer
    : salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength),
  iterations: iters,
} as Pbkdf2Params;

const bits = await crypto.subtle.deriveBits(algo, key, byteLen * 8);

  return base64urlEncode(new Uint8Array(bits));
}

/**
 * SESSION TOKENS
 * Format: base64url(payloadJson).base64url(signature)
 */
async function signSession(payload: CavbotSession) {
  const secret = env("CAVBOT_SESSION_SECRET");
  if (!secret) throw new Error("Missing env: CAVBOT_SESSION_SECRET");

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64urlEncode(new TextEncoder().encode(payloadJson));
  const sig = await hmacSha256(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

async function verifySession(token: string): Promise<CavbotSession> {
  const secret = env("CAVBOT_SESSION_SECRET");
  if (!secret) throw new Error("Missing env: CAVBOT_SESSION_SECRET");

  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("UNAUTHORIZED");

  const payloadB64 = parts[0];
  const sig = parts[1];

  const expected = await hmacSha256(secret, payloadB64);
  if (!constantTimeEqual(sig, expected)) throw new Error("UNAUTHORIZED");

  const payloadJson = new TextDecoder().decode(base64urlDecodeToBytes(payloadB64));
  const payload = JSON.parse(payloadJson) as CavbotSession;

  if (!payload?.exp || nowSec() > payload.exp) throw new Error("UNAUTHORIZED");
  if (!payload?.sub || !payload?.systemRole) throw new Error("UNAUTHORIZED");
  if (payload.v !== 1) throw new Error("UNAUTHORIZED");

  return payload;
}

/**
 * Create a system session token (rare: internal tools, sealed admin surfaces)
 */
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

/**
 * Create a user session token (multi-tenant)
 * - userId is sub
 * - accountId/memberRole define the ACTIVE dashboard tenant context
 */
export async function createUserSession(args: {
  userId: string;
  accountId: string;
  memberRole: MemberRole;
}) {
  const iat = nowSec();
  const session: CavbotSession = {
    v: 1,
    sub: args.userId,
    systemRole: "user",
    accountId: args.accountId,
    memberRole: args.memberRole,
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  };
  return await signSession(session);
}

/**
 * Cookie headers
 */
export function sessionCookieHeader(token: string) {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=${SESSION_TTL_SECONDS};`;
}

export function clearSessionCookieHeader() {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=0;`;
}

/**
 * Get session (non-throwing)
 */
export async function getSession(req: Request): Promise<CavbotSession | null> {
  try {
    const cookieHeader = req.headers.get("cookie") || "";
    const cookieToken = parseCookie(cookieHeader, SESSION_COOKIE);
    const bearer = getBearerToken(req);
    const token = bearer || cookieToken;
    if (!token) return null;
    return await verifySession(token);
  } catch {
    return null;
  }
}

/**
 * Require session (throwing)
 */
export async function requireSession(req: Request): Promise<CavbotSession> {
  assertWriteOrigin(req);
  const sess = await getSession(req);
  if (!sess) throw new Error("UNAUTHORIZED");
  return sess;
}

/**
 * Guards
 */
export function requireUser(sess: CavbotSession) {
  if (sess.systemRole !== "user") throw new Error("UNAUTHORIZED");
  if (!sess.sub || sess.sub === "system") throw new Error("UNAUTHORIZED");
}

export function requireAccountContext(sess: CavbotSession) {
  requireUser(sess);
  if (!sess.accountId || !sess.memberRole) throw new Error("UNAUTHORIZED");
}

export function requireAccountRole(sess: CavbotSession, roles: MemberRole[]) {
  requireAccountContext(sess);
  if (!roles.includes(sess.memberRole!)) throw new Error("UNAUTHORIZED");
}