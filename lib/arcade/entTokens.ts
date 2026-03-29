import crypto from "crypto";
import { normalizeOriginStrict } from "@/originMatch";

const SECRET =
  process.env.CAVBOT_ARCADE_ENT_ASSET_SECRET ||
  process.env.CAVBOT_ARCADE_ASSET_SECRET ||
  process.env.CAVBOT_EMBED_TOKEN_SECRET ||
  process.env.CAVBOT_SESSION_SECRET ||
  "";

if (!SECRET) {
  console.warn(
    "[arcade/entTokens] Missing CAVBOT_ARCADE_ENT_ASSET_SECRET; entertainment signed assets disabled."
  );
}

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 300;

export type EntertainmentAssetTokenPayload = {
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

function hmac(value: string) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

function normalizeBasePath(value: string) {
  let normalized = String(value || "").trim();
  if (!normalized) normalized = "/";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  return normalized.replace(/\/+$/, "") || "/";
}

function clampTtl(ttl?: number) {
  if (!ttl || !Number.isFinite(ttl)) return MIN_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, ttl));
}

export function mintEntertainmentAssetToken(options: {
  origin: string;
  basePath: string;
  ttlSeconds?: number;
}): string {
  if (!SECRET) {
    throw new Error("Entertainment asset secret is not configured.");
  }

  const canonicalOrigin = normalizeOriginStrict(options.origin);
  const payload: EntertainmentAssetTokenPayload = {
    origin: canonicalOrigin,
    basePath: normalizeBasePath(options.basePath),
    expiresAt: Date.now() + clampTtl(options.ttlSeconds) * 1000,
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = hmac(encoded);
  return `${encoded}.${signature}`;
}

