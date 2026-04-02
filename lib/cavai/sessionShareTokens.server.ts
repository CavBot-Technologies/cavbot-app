import "server-only";

import crypto from "crypto";

let shareSecretWarned = false;

function readSecret() {
  const secret =
    String(process.env.CAVAI_SHARE_TOKEN_SECRET || "").trim()
    || String(process.env.CAVCLOUD_TOKEN_SECRET || "").trim()
    || String(process.env.CAVBOT_SESSION_SECRET || "").trim();
  if (!secret && !shareSecretWarned) {
    shareSecretWarned = true;
    console.warn("[cavai/share] Missing share token secret; external CavAi share links are disabled.");
  }
  return secret;
}

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

type CavAiSessionSharePayload = {
  accountId: string;
  sessionId: string;
  expiresAt: number;
};

function b64UrlEncode(value: string) {
  return Buffer.from(value, "utf-8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, "base64").toString("utf-8");
}

function hmacHex(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function clampTtlSeconds(input?: number): number {
  if (!Number.isFinite(Number(input))) return DEFAULT_TTL_SECONDS;
  return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, Math.trunc(Number(input))));
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  if (left.length === 0 || right.length === 0) return false;
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function mintCavAiSessionShareToken(args: {
  accountId: string;
  sessionId: string;
  ttlSeconds?: number;
}): string {
  const secret = readSecret();
  if (!secret) throw new Error("CavAi share token secret is not configured.");
  const accountId = String(args.accountId || "").trim();
  const sessionId = String(args.sessionId || "").trim();
  if (!accountId || !sessionId) {
    throw new Error("accountId and sessionId are required.");
  }

  const payload: CavAiSessionSharePayload = {
    accountId,
    sessionId,
    expiresAt: Date.now() + clampTtlSeconds(args.ttlSeconds) * 1000,
  };
  const encoded = b64UrlEncode(JSON.stringify(payload));
  const signature = hmacHex(encoded, secret);
  return `${encoded}.${signature}`;
}

export function verifyCavAiSessionShareToken(token: string): CavAiSessionSharePayload | null {
  const secret = readSecret();
  if (!secret) return null;
  const raw = String(token || "").trim();
  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) return null;
  const expected = hmacHex(encoded, secret);
  if (!safeEqualHex(signature, expected)) return null;
  try {
    const parsed = JSON.parse(b64UrlDecode(encoded)) as Partial<CavAiSessionSharePayload>;
    const accountId = String(parsed.accountId || "").trim();
    const sessionId = String(parsed.sessionId || "").trim();
    const expiresAt = Number(parsed.expiresAt || 0);
    if (!accountId || !sessionId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    return {
      accountId,
      sessionId,
      expiresAt,
    };
  } catch {
    return null;
  }
}
