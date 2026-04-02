import "server-only";

import crypto from "crypto";
import { normalizeOriginStrict } from "@/originMatch";

let cavSafeTokenWarned = false;

function readSecret() {
  const secret = process.env.CAVCLOUD_TOKEN_SECRET || "";
  if (!secret && !cavSafeTokenWarned) {
    cavSafeTokenWarned = true;
    console.warn("[cavsafe/tokens] Missing CAVCLOUD_TOKEN_SECRET; CavSafe share tokens disabled.");
  }
  return secret;
}

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 1800; // keep tokens short-lived (revocation relies on re-minting)

export type CavSafeObjectTokenPayload = {
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

function hmacHex(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function clampTtlSeconds(ttlSeconds?: number) {
  if (!ttlSeconds || !Number.isFinite(ttlSeconds)) return MIN_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, ttlSeconds));
}

export function mintCavSafeObjectToken(options: {
  origin: string;
  objectKey: string;
  ttlSeconds?: number;
}): string {
  const secret = readSecret();
  if (!secret) {
    throw new Error("CavSafe token secret is not configured.");
  }

  const canonicalOrigin = normalizeOriginStrict(options.origin);
  const objectKey = String(options.objectKey || "").trim().replace(/^\/+/, "");
  if (!objectKey) throw new Error("objectKey is required");

  const payload: CavSafeObjectTokenPayload = {
    origin: canonicalOrigin,
    expiresAt: Date.now() + clampTtlSeconds(options.ttlSeconds) * 1000,
    objectKey,
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = hmacHex(encoded, secret);
  // Worker supports payloadB64.hex(hmacBytes(payloadB64)).
  return `${encoded}.${signature}`;
}

export function mintCavSafePrefixToken(options: {
  origin: string;
  prefix: string;
  ttlSeconds?: number;
}): string {
  const secret = readSecret();
  if (!secret) {
    throw new Error("CavSafe token secret is not configured.");
  }

  const canonicalOrigin = normalizeOriginStrict(options.origin);
  const prefix = String(options.prefix || "").trim().replace(/^\/+/, "");
  if (!prefix) throw new Error("prefix is required");

  const payload: CavSafeObjectTokenPayload = {
    origin: canonicalOrigin,
    expiresAt: Date.now() + clampTtlSeconds(options.ttlSeconds) * 1000,
    prefix,
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = hmacHex(encoded, secret);
  return `${encoded}.${signature}`;
}
