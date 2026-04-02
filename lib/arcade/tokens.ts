import crypto from "crypto";
import { normalizeOriginStrict } from "@/originMatch";

let arcadeSecretWarned = false;

function readSecret() {
  const secret =
    process.env.CAVBOT_ARCADE_ASSET_SECRET ||
    process.env.CAVBOT_EMBED_TOKEN_SECRET ||
    process.env.CAVBOT_SESSION_SECRET ||
    "";
  if (!secret && !arcadeSecretWarned) {
    arcadeSecretWarned = true;
    console.warn(
      "[arcade/tokens] Missing CAVBOT_ARCADE_ASSET_SECRET/CAVBOT_EMBED_TOKEN_SECRET/CAVBOT_SESSION_SECRET; signed assets disabled."
    );
  }
  return secret;
}

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 300;

export type ArcadeAssetTokenPayload = {
  origin: string;
  basePath: string;
  expiresAt: number;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf-8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value: string) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function hmac(value: string, secret: string) {
  return crypto
    .createHmac("sha256", secret)
    .update(value)
    .digest("hex");
}

function normalizeBasePath(value: string) {
  let normalized = String(value || "").trim();
  if (!normalized) normalized = "/";
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  return normalized.replace(/\/+$/, "") || "/";
}

function clampTtl(ttl?: number) {
  if (!ttl || !Number.isFinite(ttl)) return MIN_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, ttl));
}

export function mintArcadeAssetToken(options: {
  origin: string;
  basePath: string;
  ttlSeconds?: number;
}): string {
  const secret = readSecret();
  if (!secret) {
    throw new Error("Arcade asset secret is not configured.");
  }

  const canonicalOrigin = normalizeOriginStrict(options.origin);
  const payload: ArcadeAssetTokenPayload = {
    origin: canonicalOrigin,
    basePath: normalizeBasePath(options.basePath),
    expiresAt: Date.now() + clampTtl(options.ttlSeconds) * 1000,
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = hmac(encoded, secret);
  return `${encoded}.${signature}`;
}

type VerifyResult = { ok: true; payload: ArcadeAssetTokenPayload } | { ok: false; reason: string };

export function verifyArcadeAssetToken(token: string): VerifyResult {
  const secret = readSecret();
  if (!secret) {
    return { ok: false, reason: "SECRET_MISSING" };
  }
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return { ok: false, reason: "TOKEN_INVALID" };
  }
  const expectedSig = hmac(encoded, secret);
  const expectedBuffer = Buffer.from(expectedSig, "utf-8");
  const providedBuffer = Buffer.from(signature, "utf-8");
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { ok: false, reason: "SIGNATURE_MISMATCH" };
  }

  let payload: ArcadeAssetTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded)) as ArcadeAssetTokenPayload;
  } catch {
    return { ok: false, reason: "PAYLOAD_INVALID" };
  }

  if (!payload.basePath || !payload.origin || !payload.expiresAt) {
    return { ok: false, reason: "PAYLOAD_INVALID" };
  }

  if (payload.expiresAt < Date.now()) {
    return { ok: false, reason: "TOKEN_EXPIRED" };
  }

  try {
    payload.origin = normalizeOriginStrict(payload.origin);
  } catch {
    return { ok: false, reason: "ORIGIN_INVALID" };
  }

  payload.basePath = normalizeBasePath(payload.basePath);

  return { ok: true, payload };
}
