import { NextRequest } from "next/server";
import crypto from "crypto";
import { normalizeOriginStrict, originsShareWebsiteContext } from "@/originMatch";
import {
  findEmbedKeyById,
  findActiveEmbedSite,
} from "@/lib/security/embedKeyRuntime.server";

let embedSecretWarned = false;

function readSecret() {
  const secret =
    process.env.CAVBOT_EMBED_TOKEN_SECRET || process.env.CAVBOT_SESSION_SECRET || "";
  if (!secret && !embedSecretWarned) {
    embedSecretWarned = true;
    console.warn(
      "[embedToken] Missing CAVBOT_EMBED_TOKEN_SECRET/CAVBOT_SESSION_SECRET; token operations will fail."
    );
  }
  return secret;
}

const DEFAULT_TTL_SECONDS = 600;
const DEFAULT_SCOPES = [
  "widget:config",
  "widget:render",
  "analytics:events",
  "cavai:diagnostics",
];

type EmbedTokenClaims = {
  sub: string;
  accountId: string;
  projectId: number;
  siteId: string;
  origin: string;
  scopes: string[];
  keyId: string;
  keyVersion: string;
  kind: string;
  iat: number;
  exp: number;
};

type EmbedTokenOptions = {
  sub: string;
  accountId: string;
  projectId: number;
  siteId: string;
  origin: string;
  keyId: string;
  keyVersion: string;
  scopes?: string[];
  kind?: string;
  ttlSeconds?: number;
};

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value: string) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function hmac(payload: string, secret: string) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizeScopes(scopes?: string[]) {
  const combined = Array.isArray(scopes) ? [...DEFAULT_SCOPES, ...scopes] : [...DEFAULT_SCOPES];
  return Array.from(new Set(combined)).filter(Boolean);
}

export function mintEmbedToken(options: EmbedTokenOptions) {
  const secret = readSecret();
  if (!secret) {
    throw new Error("Embed token secret is not configured.");
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const claims: EmbedTokenClaims = {
    sub: options.sub,
    accountId: options.accountId,
    projectId: options.projectId,
    siteId: options.siteId,
    origin: options.origin,
    scopes: normalizeScopes(options.scopes),
    keyId: options.keyId,
    keyVersion: options.keyVersion,
    kind: options.kind ?? "widget",
    iat: now,
    exp: now + ttl,
  };

  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signature = hmac(`${encodedHeader}.${encodedPayload}`, secret);

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function inferRequestOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const parsed = new URL(referer);
      return parsed.origin;
    } catch {
      return null;
    }
  }
  return null;
}

type EmbedTokenVerifyResultOk = {
  ok: true;
  accountId: string;
  projectId: number;
  siteId: string;
  siteOrigin: string;
  origin: string;
  keyId: string;
  projectKey: string;
  scopes: string[];
  keyLast4: string | null;
  keyVersion: string;
};

type EmbedTokenVerifyResultError = {
  ok: false;
  status: number;
  code: string;
};

export type EmbedTokenVerifyResult = EmbedTokenVerifyResultOk | EmbedTokenVerifyResultError;

type VerifyOptions = {
  req: NextRequest;
  requiredScopes?: string[];
  expectedSiteId?: string | null;
  expectedOrigin?: string | null;
};

export async function verifyEmbedToken(options: VerifyOptions): Promise<EmbedTokenVerifyResult> {
  const secret = readSecret();
  if (!secret) {
    return { ok: false, status: 401, code: "TOKEN_DISABLED" };
  }

  const auth = options.req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return { ok: false, status: 401, code: "TOKEN_MISSING" };
  }

  const token = auth.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, status: 401, code: "TOKEN_INVALID" };
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const payloadStr = base64UrlDecode(encodedPayload);
  let claims: EmbedTokenClaims;
  try {
    claims = JSON.parse(payloadStr);
  } catch {
    return { ok: false, status: 401, code: "TOKEN_INVALID" };
  }

  const expectedSig = hmac(`${encodedHeader}.${encodedPayload}`, secret);
  const expectedBuffer = Buffer.from(expectedSig, "utf-8");
  const providedBuffer = Buffer.from(signature, "utf-8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return { ok: false, status: 401, code: "TOKEN_SIGNATURE" };
  }
  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { ok: false, status: 401, code: "TOKEN_SIGNATURE" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) {
    return { ok: false, status: 401, code: "TOKEN_EXPIRED" };
  }

  const canonicalOrigin = inferRequestOrigin(options.req);
  if (!canonicalOrigin) {
    return { ok: false, status: 400, code: "ORIGIN_MISSING" };
  }

  let parsedOrigin: string;
  try {
    parsedOrigin = normalizeOriginStrict(canonicalOrigin);
  } catch {
    return { ok: false, status: 400, code: "ORIGIN_INVALID" };
  }

  if (!originsShareWebsiteContext(parsedOrigin, claims.origin)) {
    return { ok: false, status: 403, code: "TOKEN_ORIGIN_MISMATCH" };
  }

  if (options.expectedOrigin && !originsShareWebsiteContext(options.expectedOrigin, parsedOrigin)) {
    return { ok: false, status: 403, code: "ORIGIN_MISMATCH" };
  }

  if (options.expectedSiteId && options.expectedSiteId !== claims.siteId) {
    return { ok: false, status: 403, code: "SITE_MISMATCH" };
  }

  const requiredScopes = Array.isArray(options.requiredScopes)
    ? options.requiredScopes
    : [];
  for (const scope of requiredScopes) {
    if (!claims.scopes.includes(scope)) {
      return { ok: false, status: 403, code: "SCOPE_MISSING" };
    }
  }

  const keyRecord = await findEmbedKeyById(claims.keyId);

  if (!keyRecord) {
    return { ok: false, status: 401, code: "TOKEN_KEY_NOT_FOUND" };
  }

  if (keyRecord.status !== "ACTIVE") {
    return { ok: false, status: 403, code: "TOKEN_KEY_INACTIVE" };
  }

  if (keyRecord.type !== "PUBLISHABLE") {
    return { ok: false, status: 403, code: "TOKEN_KEY_TYPE" };
  }

  if (!keyRecord.projectId || keyRecord.projectId !== claims.projectId) {
    return { ok: false, status: 403, code: "TOKEN_PROJECT_MISMATCH" };
  }

  if (keyRecord.siteId && keyRecord.siteId !== claims.siteId) {
    return { ok: false, status: 403, code: "TOKEN_SITE_MISMATCH" };
  }

  const updatedAtVersion = keyRecord.updatedAt ? keyRecord.updatedAt.toISOString() : "";
  if (claims.keyVersion !== updatedAtVersion) {
    return { ok: false, status: 403, code: "TOKEN_KEY_STALE" };
  }

  const siteRecord = await findActiveEmbedSite(claims.siteId, claims.projectId);
  if (!siteRecord) {
    return { ok: false, status: 404, code: "TOKEN_SITE_NOT_FOUND" };
  }

  return {
    ok: true,
    accountId: keyRecord.accountId ?? "",
    projectId: keyRecord.projectId ?? 0,
    siteId: claims.siteId,
    siteOrigin: siteRecord.origin,
    origin: parsedOrigin,
    keyId: claims.keyId,
    projectKey: "",
    scopes: claims.scopes,
    keyLast4: keyRecord.last4 ?? null,
    keyVersion: claims.keyVersion,
  };
}
