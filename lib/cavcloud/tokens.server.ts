import "server-only";

import crypto from "crypto";
import { normalizeOriginStrict } from "@/originMatch";

const SECRET = process.env.CAVCLOUD_TOKEN_SECRET || "";

if (!SECRET) {
  // Fail closed at runtime, but make misconfig visible in logs.
  console.warn("[cavcloud/tokens] Missing CAVCLOUD_TOKEN_SECRET; CavCloud share tokens disabled.");
}

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 1800; // keep tokens short-lived (revocation relies on re-minting)

export type CavCloudObjectTokenPayload = {
  origin: string;
  expiresAt: number;
  objectKey?: string;
  prefix?: string;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf-8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function hmacHex(value: string) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

function clampTtlSeconds(ttlSeconds?: number) {
  if (!ttlSeconds || !Number.isFinite(ttlSeconds)) return MIN_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, ttlSeconds));
}

export function mintCavCloudObjectToken(options: {
  origin: string;
  objectKey: string;
  ttlSeconds?: number;
}): string {
  if (!SECRET) {
    throw new Error("CavCloud token secret is not configured.");
  }

  const canonicalOrigin = normalizeOriginStrict(options.origin);
  const objectKey = String(options.objectKey || "").trim().replace(/^\/+/, "");
  if (!objectKey) throw new Error("objectKey is required");

  const payload: CavCloudObjectTokenPayload = {
    origin: canonicalOrigin,
    expiresAt: Date.now() + clampTtlSeconds(options.ttlSeconds) * 1000,
    objectKey,
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = hmacHex(encoded);
  // Worker supports payloadB64.hex(hmacBytes(payloadB64)).
  return `${encoded}.${signature}`;
}

export function mintCavCloudPrefixToken(options: {
  origin: string;
  prefix: string;
  ttlSeconds?: number;
}): string {
  if (!SECRET) {
    throw new Error("CavCloud token secret is not configured.");
  }

  const canonicalOrigin = normalizeOriginStrict(options.origin);
  const prefix = String(options.prefix || "").trim().replace(/^\/+/, "");
  if (!prefix) throw new Error("prefix is required");

  const payload: CavCloudObjectTokenPayload = {
    origin: canonicalOrigin,
    expiresAt: Date.now() + clampTtlSeconds(options.ttlSeconds) * 1000,
    prefix,
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = hmacHex(encoded);
  return `${encoded}.${signature}`;
}
