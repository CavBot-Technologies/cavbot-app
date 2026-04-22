import type { NextResponse } from "next/server";

import { sessionCookieOptions } from "@/lib/apiAuth";

export type AdminSessionRole = "OWNER" | "ADMIN" | "MEMBER" | "READ_ONLY";
export type AdminStepUpMethod = "email";

export type AdminSession = {
  v: 1;
  sub: string;
  staffId: string;
  staffCode: string;
  role: AdminSessionRole;
  stepUpMethod: AdminStepUpMethod;
  verifiedAt: number;
  iat: number;
  exp: number;
};

const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 4;

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function b64Encode(bytes: Uint8Array) {
  if (typeof btoa === "function") {
    let value = "";
    for (let index = 0; index < bytes.length; index += 1) value += String.fromCharCode(bytes[index]);
    return btoa(value);
  }
  return Buffer.from(bytes).toString("base64");
}

function b64Decode(value: string) {
  if (typeof atob === "function") {
    const decoded = atob(value);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
    return bytes;
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

function base64urlEncode(bytes: Uint8Array) {
  return b64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return b64Decode(padded);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

async function hmacSha256(secret: string, value: string) {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64urlEncode(new Uint8Array(signature));
}

function getAdminSessionSecret() {
  return env("CAVBOT_ADMIN_SESSION_SECRET") || env("CAVBOT_SESSION_SECRET");
}

export function getAdminSessionCookieName() {
  return env("CAVBOT_ADMIN_SESSION_COOKIE_NAME") || "cavbot_admin_session";
}

function parseCookie(header: string, name: string) {
  const parts = String(header || "")
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const part of parts) {
    const divider = part.indexOf("=");
    if (divider === -1) continue;
    const key = part.slice(0, divider).trim();
    const value = part.slice(divider + 1).trim();
    if (key === name) return value;
  }

  return "";
}

export async function createAdminSessionToken(args: {
  userId: string;
  staffId: string;
  staffCode: string;
  role: AdminSessionRole;
  stepUpMethod: AdminStepUpMethod;
}) {
  const secret = getAdminSessionSecret();
  if (!secret) throw new Error("Missing admin session secret.");

  const issuedAt = nowSec();
  const payload: AdminSession = {
    v: 1,
    sub: String(args.userId || "").trim(),
    staffId: String(args.staffId || "").trim(),
    staffCode: String(args.staffCode || "").trim(),
    role: args.role,
    stepUpMethod: args.stepUpMethod,
    verifiedAt: issuedAt,
    iat: issuedAt,
    exp: issuedAt + ADMIN_SESSION_TTL_SECONDS,
  };

  const encodedPayload = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSha256(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifyAdminSessionToken(token: string): Promise<AdminSession | null> {
  const secret = getAdminSessionSecret();
  if (!secret) return null;

  const [payloadB64, signature] = String(token || "").trim().split(".");
  if (!payloadB64 || !signature) return null;

  const expected = await hmacSha256(secret, payloadB64);
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const decoded = new TextDecoder().decode(base64urlDecode(payloadB64));
    const payload = JSON.parse(decoded) as Partial<AdminSession>;
    if (payload.v !== 1) return null;
    if (!payload.sub || !payload.staffId || !payload.staffCode || !payload.role) return null;
    const expiresAt = Number(payload.exp || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowSec()) return null;
    return payload as AdminSession;
  } catch {
    return null;
  }
}

export async function getAdminSession(req: Request) {
  const token = parseCookie(req.headers.get("cookie") || "", getAdminSessionCookieName());
  if (!token) return null;
  return verifyAdminSessionToken(token);
}

export function adminSessionCookieOptions(req?: Request) {
  const base = sessionCookieOptions(req);
  return {
    ...base,
    name: getAdminSessionCookieName(),
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  };
}

export function clearAdminSessionCookie(response: Pick<NextResponse<unknown>, "cookies">) {
  response.cookies.set(getAdminSessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}
