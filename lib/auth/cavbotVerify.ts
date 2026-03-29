import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { sendEmail } from "@/lib/email/sendEmail";
import { normalizeUsername } from "@/lib/username";
import {
  CAVBOT_WORDMARK_GLYPHS,
  CAVBOT_WORDMARK_MODEL,
  CAVBOT_WORDMARK_VIEWBOX,
  type CavBotWordmarkFillRule,
} from "@/lib/cavbotVerify/wordmarkGlyphs";

export type VerifyActionType = "signup" | "login" | "reset" | "invite";
export type VerifyDecision = "allow" | "monitor" | "step_up_required" | "block";
export type VerifyChallengeStatus = "PENDING" | "PASSED" | "FAILED" | "EXPIRED" | "CONSUMED";

type VerifyGrantMethod = "challenge" | "otp";

type VerifyRiskInteraction = {
  submitLatencyMs?: number;
  dwellMs?: number;
  pointerMoves?: number;
};

export type VerifyRiskInput = {
  actionType: VerifyActionType;
  route?: string | null;
  sessionIdHint?: string | null;
  interaction?: VerifyRiskInteraction | null;
  mutate?: boolean;
};

export type VerifyRiskResult = {
  actionType: VerifyActionType;
  decision: VerifyDecision;
  reasonCode: string;
  reasonCodes: string[];
  challengeRequired: boolean;
  sessionId: string;
  ipHash: string;
  fingerprintHash: string;
  score: number;
  retryAfterSec: number;
};

export type EnsureVerifyInput = {
  actionType: VerifyActionType;
  route?: string | null;
  interaction?: VerifyRiskInteraction | null;
  sessionIdHint?: string | null;
  verificationGrantToken?: string | null;
};

export type EnsureVerifyResult = VerifyRiskResult & {
  ok: boolean;
  usedGrant: boolean;
};

type VerifyGlyphFillRule = CavBotWordmarkFillRule;

type VerifyShape = {
  svgPath: string;
  svgViewBox: string;
  svgFill?: string;
  svgFillRule?: VerifyGlyphFillRule;
  svgClipRule?: VerifyGlyphFillRule;
};

type VerifyChallengeWordmarkGlyph = VerifyShape & {
  shapeId: string;
};

type VerifyChallengeTile = VerifyShape & {
  tileId: string;
  jitterY: number;
  rotationDeg: number;
};

type VerifyChallengeTileRecord = VerifyChallengeTile & {
  glyphIndex: number;
  tileIdHash: string;
};

type VerifyChallengeSlot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type VerifyChallengeRecord = {
  challengeIdHash: string;
  actionType: VerifyActionType;
  route: string;
  sessionId: string;
  ipHash: string;
  deviceHash: string;
  nonceHash: string;
  status: VerifyChallengeStatus;
  attempts: number;
  maxAttempts: number;
  createdAtMs: number;
  expiresAtMs: number;
  missingGlyphIndex: number;
  correctTileIdHash: string;
  slot: VerifyChallengeSlot;
  wordmarkGlyphs: VerifyChallengeWordmarkGlyph[];
  tiles: VerifyChallengeTileRecord[];
};

type VerifyGrantRecord = {
  tokenHash: string;
  status: VerifyChallengeStatus;
  actionType: VerifyActionType;
  method: VerifyGrantMethod;
  sessionId: string;
  ipHash: string;
  deviceHash: string;
  challengeIdHash: string | null;
  issuedAtMs: number;
  expiresAtMs: number;
  consumedAtMs?: number;
};

type VerifyOtpRecord = {
  otpChallengeIdHash: string;
  actionType: VerifyActionType;
  sessionId: string;
  ipHash: string;
  deviceHash: string;
  status: VerifyChallengeStatus;
  attempts: number;
  maxAttempts: number;
  codeHash: string;
  emailHash: string;
  createdAtMs: number;
  expiresAtMs: number;
};

type VerifyChallengeTokenPayload = {
  v: 1;
  challengeIdHash: string;
  actionType: VerifyActionType;
  sessionId: string;
  ipHash: string;
  deviceHash: string;
  nonceHash: string;
  correctTileIdHash: string;
  iat: number;
  exp: number;
};

type VerifyChallengeFallbackAttemptState = {
  attempts: number;
  consumed: boolean;
  expiresAtMs: number;
};

type VerifyFailureState = {
  count: number;
  firstAtMs: number;
  lastAtMs: number;
  cooldownUntilMs: number;
};

type VerifySessionState = {
  firstSeenMs: number;
  lastSeenMs: number;
  requestCount: number;
};

type GrantTokenPayload = {
  v: 1;
  jti: string;
  method: VerifyGrantMethod;
  actionType: VerifyActionType;
  sessionId: string;
  ipHash: string;
  deviceHash: string;
  challengeIdHash: string | null;
  engineVersion: string;
  iat: number;
  exp: number;
};

const VERIFY_ENGINE_VERSION = "cavbot-verify-v2";
const VERIFY_SESSION_COOKIE = "cb_verify_sid";
const VERIFY_SESSION_HEADER = "x-cavbot-verify-session";
const VERIFY_GRANT_HEADER = "x-cavbot-verify-grant";

const CHALLENGE_TTL_MS = 90_000;
const GRANT_TTL_MS = 2 * 60_000;
const OTP_TTL_MS = 10 * 60_000;
const MAX_CHALLENGE_ATTEMPTS = 3;
const MAX_OTP_ATTEMPTS = 5;
const CHALLENGE_TOKEN_VERSION = "cbvch1";
const CHALLENGE_TOKEN_IV_BYTES = 12;
const CHALLENGE_TOKEN_AUTH_TAG_BYTES = 16;

const challengeStore = new Map<string, VerifyChallengeRecord>();
const grantStore = new Map<string, VerifyGrantRecord>();
const otpStore = new Map<string, VerifyOtpRecord>();
const challengeFallbackAttemptStore = new Map<string, VerifyChallengeFallbackAttemptState>();
const failureStore = new Map<string, VerifyFailureState>();
const sessionStore = new Map<string, VerifySessionState>();
const rateBuckets = new Map<string, { count: number; resetAtMs: number }>();

let cleanupCounter = 0;

const ACTION_POLICY: Record<
  VerifyActionType,
  {
    ipLimit: number;
    sessionLimit: number;
    windowMs: number;
    monitorThreshold: number;
    stepUpThreshold: number;
    blockThreshold: number;
  }
> = {
  signup: {
    ipLimit: 14,
    sessionLimit: 8,
    windowMs: 60_000,
    monitorThreshold: 2,
    stepUpThreshold: 4,
    blockThreshold: 8,
  },
  login: {
    ipLimit: 24,
    sessionLimit: 12,
    windowMs: 60_000,
    monitorThreshold: 2,
    stepUpThreshold: 4,
    blockThreshold: 9,
  },
  reset: {
    ipLimit: 12,
    sessionLimit: 8,
    windowMs: 60_000,
    monitorThreshold: 2,
    stepUpThreshold: 4,
    blockThreshold: 8,
  },
  invite: {
    ipLimit: 18,
    sessionLimit: 14,
    windowMs: 60_000,
    monitorThreshold: 2,
    stepUpThreshold: 3,
    blockThreshold: 8,
  },
};

const DATACENTER_ASNS = new Set<number>([
  13335, // Cloudflare
  16509, // AWS
  14618, // AWS
  15169, // Google
  8075, // Microsoft
  14061, // DigitalOcean
  63949, // Linode/Akamai
  20473, // Vultr
  24940, // Hetzner
]);

const SLOT_PLACEHOLDER_GLYPH: VerifyShape = {
  svgViewBox: "0 0 24 24",
  svgPath: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2.7 7.6h8.6v2.8H7.7Z",
  svgFill: "currentColor",
};

function safeString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function nowMs() {
  return Date.now();
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function toIso(ms: number) {
  return new Date(ms).toISOString();
}

function bool(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function parseCookie(req: Request, name: string) {
  const cookie = safeString(req.headers.get("cookie"));
  if (!cookie) return "";
  const parts = cookie.split(";").map((part) => part.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === name) return value;
  }
  return "";
}

function pickClientIp(req: Request) {
  const cfIp = safeString(req.headers.get("cf-connecting-ip")).trim();
  if (cfIp) return cfIp;
  const trueIp = safeString(req.headers.get("true-client-ip")).trim();
  if (trueIp) return trueIp;
  const xff = safeString(req.headers.get("x-forwarded-for")).trim();
  if (xff) return xff.split(",")[0].trim();
  const xr = safeString(req.headers.get("x-real-ip")).trim();
  if (xr) return xr;
  return "0.0.0.0";
}

function hasSessionCookie(req: Request) {
  const cookie = safeString(req.headers.get("cookie"));
  if (!cookie) return false;
  return cookie.includes("cavbot_session=");
}

function readSessionIdFromHint(req: Request, hint?: string | null) {
  const headerSession = safeString(req.headers.get(VERIFY_SESSION_HEADER)).trim();
  const cookieSession = parseCookie(req, VERIFY_SESSION_COOKIE);
  const candidate = headerSession || safeString(hint).trim() || cookieSession;
  if (!candidate) return "";
  const safe = candidate.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return safe;
}

function computeFingerprintHash(req: Request) {
  const ua = safeString(req.headers.get("user-agent")).trim().toLowerCase();
  const lang = safeString(req.headers.get("accept-language")).trim().toLowerCase();
  const platform = safeString(req.headers.get("sec-ch-ua-platform")).trim().toLowerCase();
  const tz = safeString(req.headers.get("x-timezone")).trim().toLowerCase();
  const source = `${ua}|${lang}|${platform}|${tz}`;
  return sha256Hex(source || "na");
}

function deriveSessionId(req: Request, hint?: string | null) {
  const explicit = readSessionIdFromHint(req, hint);
  if (explicit) return explicit;
  const fingerprintHash = computeFingerprintHash(req);
  const ipHash = sha256Hex(pickClientIp(req));
  return `vs_${sha256Hex(`${fingerprintHash}:${ipHash}`).slice(0, 24)}`;
}

function normalizeRoute(input: unknown) {
  const raw = safeString(input).trim();
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (raw.includes("\\")) return "/";
  try {
    const u = new URL(raw, "https://app.invalid");
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return "/";
  }
}

function parseActionType(input: unknown): VerifyActionType | null {
  const value = safeString(input).trim().toLowerCase();
  if (value === "signup") return "signup";
  if (value === "login") return "login";
  if (value === "reset") return "reset";
  if (value === "invite") return "invite";
  return null;
}

function trimMaps(now: number) {
  cleanupCounter += 1;
  if (cleanupCounter % 25 !== 0) return;

  for (const [key, record] of challengeStore.entries()) {
    if (record.expiresAtMs + 30 * 60_000 < now || record.status === "CONSUMED") {
      challengeStore.delete(key);
    }
  }
  for (const [key, record] of grantStore.entries()) {
    if (record.expiresAtMs + 15 * 60_000 < now || record.status === "CONSUMED") {
      grantStore.delete(key);
    }
  }
  for (const [key, record] of otpStore.entries()) {
    if (record.expiresAtMs + 30 * 60_000 < now || record.status === "CONSUMED") {
      otpStore.delete(key);
    }
  }
  for (const [key, record] of challengeFallbackAttemptStore.entries()) {
    if (record.expiresAtMs + 30 * 60_000 < now || record.consumed) {
      challengeFallbackAttemptStore.delete(key);
    }
  }
  for (const [key, record] of failureStore.entries()) {
    if (record.lastAtMs + 60 * 60_000 < now) {
      failureStore.delete(key);
    }
  }
  for (const [key, record] of sessionStore.entries()) {
    if (record.lastSeenMs + 60 * 60_000 < now) {
      sessionStore.delete(key);
    }
  }
  for (const [key, record] of rateBuckets.entries()) {
    if (record.resetAtMs <= now) {
      rateBuckets.delete(key);
    }
  }
}

function consumeRateLimit(input: { key: string; limit: number; windowMs: number }) {
  const key = safeString(input.key).trim();
  const limit = Math.max(1, Math.trunc(Number(input.limit || 1)));
  const windowMs = Math.max(1000, Math.trunc(Number(input.windowMs || 60_000)));
  if (!key) return { allowed: true, remaining: limit, retryAfterSec: 0 };

  const now = nowMs();
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAtMs <= now) {
    rateBuckets.set(key, {
      count: 1,
      resetAtMs: now + windowMs,
    });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSec: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000)),
    };
  }

  existing.count += 1;
  rateBuckets.set(key, existing);
  return { allowed: true, remaining: Math.max(0, limit - existing.count), retryAfterSec: 0 };
}

function getOrCreateSessionState(sessionId: string, now: number) {
  const existing = sessionStore.get(sessionId);
  if (existing) {
    existing.lastSeenMs = now;
    existing.requestCount += 1;
    sessionStore.set(sessionId, existing);
    return existing;
  }
  const created: VerifySessionState = {
    firstSeenMs: now,
    lastSeenMs: now,
    requestCount: 1,
  };
  sessionStore.set(sessionId, created);
  return created;
}

function deriveCooldownSeconds(failureCount: number) {
  if (failureCount >= 20) return 15 * 60;
  if (failureCount >= 14) return 5 * 60;
  if (failureCount >= 9) return 60;
  if (failureCount >= 6) return 20;
  return 0;
}

function bumpFailure(key: string, now: number) {
  const existing = failureStore.get(key);
  if (!existing || now - existing.lastAtMs > 15 * 60_000) {
    const resetState: VerifyFailureState = {
      count: 1,
      firstAtMs: now,
      lastAtMs: now,
      cooldownUntilMs: now + deriveCooldownSeconds(1) * 1000,
    };
    failureStore.set(key, resetState);
    return resetState;
  }

  existing.count += 1;
  existing.lastAtMs = now;
  const cooldownSeconds = deriveCooldownSeconds(existing.count);
  if (cooldownSeconds > 0) {
    existing.cooldownUntilMs = Math.max(existing.cooldownUntilMs, now + cooldownSeconds * 1000);
  }
  failureStore.set(key, existing);
  return existing;
}

function softenFailure(key: string) {
  const existing = failureStore.get(key);
  if (!existing) return;
  existing.count = Math.max(0, existing.count - 2);
  if (existing.count === 0) {
    failureStore.delete(key);
    return;
  }
  failureStore.set(key, existing);
}

function networkRiskSignals(req: Request) {
  let score = 0;
  const reasons: string[] = [];

  const asnRaw = safeString(req.headers.get("cf-ipasnum")).trim();
  const asn = Number(asnRaw);
  if (Number.isFinite(asn) && DATACENTER_ASNS.has(asn)) {
    score += 2;
    reasons.push("network_asn_datacenter");
  }

  const xff = safeString(req.headers.get("x-forwarded-for")).trim();
  if (xff.includes(",")) {
    score += 1;
    reasons.push("network_proxy_chain");
  }

  if (safeString(req.headers.get("via")).trim()) {
    score += 1;
    reasons.push("network_via_header");
  }

  return { score, reasons };
}

function uaRiskSignals(req: Request) {
  let score = 0;
  const reasons: string[] = [];
  const ua = safeString(req.headers.get("user-agent")).trim().toLowerCase();
  if (!ua) {
    score += 3;
    reasons.push("ua_missing");
    return { score, reasons };
  }

  if (/headless|webdriver|selenium|playwright|puppeteer|phantom/.test(ua)) {
    score += 4;
    reasons.push("ua_headless_marker");
  }

  if (ua.length < 24) {
    score += 1;
    reasons.push("ua_short");
  }

  return { score, reasons };
}

function interactionRiskSignals(interaction: VerifyRiskInteraction | null | undefined) {
  if (!interaction) return { score: 0, reasons: [] as string[] };
  let score = 0;
  const reasons: string[] = [];

  const submitLatencyMs = Number(interaction.submitLatencyMs ?? interaction.dwellMs ?? 0);
  if (Number.isFinite(submitLatencyMs) && submitLatencyMs > 0 && submitLatencyMs < 320) {
    score += 2;
    reasons.push("interaction_too_fast");
  }

  const pointerMoves = Number(interaction.pointerMoves ?? 0);
  if (Number.isFinite(pointerMoves) && pointerMoves > 0 && pointerMoves < 2) {
    score += 1;
    reasons.push("interaction_low_pointer_activity");
  }

  return { score, reasons };
}

function verifySecret() {
  const envSecret = safeString(process.env.CAVBOT_VERIFY_SECRET).trim();
  if (envSecret) return envSecret;
  const fallbackSecret = safeString(process.env.CAVBOT_SESSION_SECRET).trim();
  if (fallbackSecret) return fallbackSecret;
  if (process.env.NODE_ENV !== "production") return "dev-cavbot-verify-secret";
  throw new Error("missing_verify_secret");
}

function verifyCipherKey() {
  return createHash("sha256").update(verifySecret(), "utf8").digest();
}

function encryptChallengeToken(payload: VerifyChallengeTokenPayload) {
  const key = verifyCipherKey();
  const iv = randomBytes(CHALLENGE_TOKEN_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CHALLENGE_TOKEN_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decryptChallengeToken(token: string): VerifyChallengeTokenPayload | null {
  const raw = safeString(token).trim();
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== CHALLENGE_TOKEN_VERSION) return null;

  try {
    const iv = Buffer.from(parts[1] || "", "base64url");
    const tag = Buffer.from(parts[2] || "", "base64url");
    const ciphertext = Buffer.from(parts[3] || "", "base64url");
    if (iv.length !== CHALLENGE_TOKEN_IV_BYTES) return null;
    if (tag.length !== CHALLENGE_TOKEN_AUTH_TAG_BYTES) return null;
    if (!ciphertext.length) return null;

    const decipher = createDecipheriv("aes-256-gcm", verifyCipherKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const payload = JSON.parse(plaintext) as VerifyChallengeTokenPayload;

    if (!payload || payload.v !== 1) return null;
    if (!parseActionType(payload.actionType)) return null;
    if (!safeString(payload.challengeIdHash).trim()) return null;
    if (!safeString(payload.sessionId).trim()) return null;
    if (!safeString(payload.ipHash).trim()) return null;
    if (!safeString(payload.deviceHash).trim()) return null;
    if (!safeString(payload.nonceHash).trim()) return null;
    if (!safeString(payload.correctTileIdHash).trim()) return null;
    if (!Number.isFinite(Number(payload.iat)) || !Number.isFinite(Number(payload.exp))) return null;
    return payload;
  } catch {
    return null;
  }
}

function signGrant(payload: GrantTokenPayload) {
  const secret = verifySecret();
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${signature}`;
}

function verifyGrantSignature(token: string): GrantTokenPayload | null {
  const safeToken = safeString(token).trim();
  if (!safeToken) return null;
  const parts = safeToken.split(".");
  if (parts.length !== 2) return null;
  const payloadB64 = parts[0];
  const signature = parts[1];
  if (!payloadB64 || !signature) return null;

  const secret = verifySecret();
  const expectedSignature = createHmac("sha256", secret).update(payloadB64).digest("base64url");

  const providedBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expectedSignature, "utf8");
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const payloadRaw = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadRaw) as GrantTokenPayload;
    if (payload.v !== 1) return null;
    if (!parseActionType(payload.actionType)) return null;
    if (!payload.sessionId || !payload.ipHash || !payload.deviceHash) return null;
    if (!payload.exp || !Number.isFinite(Number(payload.exp))) return null;
    return payload;
  } catch {
    return null;
  }
}

function issueGrant(args: {
  actionType: VerifyActionType;
  method: VerifyGrantMethod;
  sessionId: string;
  ipHash: string;
  deviceHash: string;
  challengeIdHash: string | null;
}) {
  const now = nowSec();
  const payload: GrantTokenPayload = {
    v: 1,
    jti: `cbv_gr_${randomBytes(12).toString("base64url")}`,
    method: args.method,
    actionType: args.actionType,
    sessionId: args.sessionId,
    ipHash: args.ipHash,
    deviceHash: args.deviceHash,
    challengeIdHash: args.challengeIdHash,
    engineVersion: VERIFY_ENGINE_VERSION,
    iat: now,
    exp: now + Math.floor(GRANT_TTL_MS / 1000),
  };
  const token = signGrant(payload);
  const tokenHash = sha256Hex(token);

  const record: VerifyGrantRecord = {
    tokenHash,
    status: "PENDING",
    actionType: args.actionType,
    method: args.method,
    sessionId: args.sessionId,
    ipHash: args.ipHash,
    deviceHash: args.deviceHash,
    challengeIdHash: args.challengeIdHash,
    issuedAtMs: now * 1000,
    expiresAtMs: payload.exp * 1000,
  };
  grantStore.set(tokenHash, record);

  return {
    token,
    expiresAt: toIso(record.expiresAtMs),
  };
}

function consumeGrant(args: {
  token: string;
  actionType: VerifyActionType;
  sessionId: string;
  ipHash: string;
  deviceHash: string;
}) {
  const payload = verifyGrantSignature(args.token);
  if (!payload) {
    return { ok: false, reasonCode: "grant_invalid" as const };
  }

  if (payload.actionType !== args.actionType) {
    return { ok: false, reasonCode: "grant_invalid" as const };
  }
  if (payload.sessionId !== args.sessionId) {
    return { ok: false, reasonCode: "grant_invalid" as const };
  }
  if (payload.ipHash !== args.ipHash) {
    return { ok: false, reasonCode: "grant_invalid" as const };
  }
  if (payload.deviceHash !== args.deviceHash) {
    return { ok: false, reasonCode: "grant_invalid" as const };
  }

  const tokenHash = sha256Hex(args.token);
  const record = grantStore.get(tokenHash);
  if (!record) {
    return { ok: false, reasonCode: "grant_invalid" as const };
  }

  if (record.actionType !== args.actionType) {
    return { ok: false, reasonCode: "grant_invalid" as const };
  }
  if (record.sessionId !== args.sessionId) {
    return { ok: false, reasonCode: "grant_invalid" as const };
  }
  if (record.ipHash !== args.ipHash) {
    return { ok: false, reasonCode: "grant_invalid" as const };
  }
  if (record.deviceHash !== args.deviceHash) {
    return { ok: false, reasonCode: "grant_invalid" as const };
  }

  const now = nowMs();
  if (record.expiresAtMs <= now) {
    record.status = "EXPIRED";
    grantStore.set(tokenHash, record);
    return { ok: false, reasonCode: "grant_expired" as const };
  }

  if (record.status !== "PENDING") {
    return { ok: false, reasonCode: "grant_replayed" as const };
  }

  record.status = "CONSUMED";
  record.consumedAtMs = now;
  grantStore.set(tokenHash, record);

  if (record.challengeIdHash) {
    const challenge = challengeStore.get(record.challengeIdHash);
    if (challenge) {
      challenge.status = "CONSUMED";
      challengeStore.set(record.challengeIdHash, challenge);
    }
  }

  return { ok: true, reasonCode: "grant_consumed" as const };
}

function riskEarlyBlock(actionType: VerifyActionType, req: Request, sessionId: string, ipHash: string, mutate: boolean) {
  const policy = ACTION_POLICY[actionType];
  if (!mutate) {
    return {
      blocked: false,
      reasonCode: "",
      retryAfterSec: 0,
      reasons: [] as string[],
    };
  }

  const ipRate = consumeRateLimit({
    key: `cbv:ip:${actionType}:${ipHash}`,
    limit: policy.ipLimit,
    windowMs: policy.windowMs,
  });
  if (!ipRate.allowed) {
    return {
      blocked: true,
      reasonCode: "rate_limit_ip",
      retryAfterSec: ipRate.retryAfterSec,
      reasons: ["rate_limit_ip"],
    };
  }

  const sessionHash = sha256Hex(sessionId);
  const sessionRate = consumeRateLimit({
    key: `cbv:session:${actionType}:${sessionHash}`,
    limit: policy.sessionLimit,
    windowMs: policy.windowMs,
  });
  if (!sessionRate.allowed) {
    return {
      blocked: true,
      reasonCode: "rate_limit_session",
      retryAfterSec: sessionRate.retryAfterSec,
      reasons: ["rate_limit_session"],
    };
  }

  const xff = safeString(req.headers.get("x-forwarded-for")).trim();
  const extraProxyPenalty = xff.includes(",") ? 1 : 0;
  return {
    blocked: false,
    reasonCode: "",
    retryAfterSec: 0,
    reasons: extraProxyPenalty ? ["rate_limit_near_proxy_chain"] : [],
  };
}

function failureStateFor(actionType: VerifyActionType, sessionId: string, ipHash: string, now: number) {
  const sessionKey = `${actionType}:session:${sha256Hex(sessionId)}`;
  const ipKey = `${actionType}:ip:${ipHash}`;
  const session = failureStore.get(sessionKey);
  const ip = failureStore.get(ipKey);

  const cooldownFromSession = session?.cooldownUntilMs ? Math.max(0, session.cooldownUntilMs - now) : 0;
  const cooldownFromIp = ip?.cooldownUntilMs ? Math.max(0, ip.cooldownUntilMs - now) : 0;
  const cooldownMs = Math.max(cooldownFromSession, cooldownFromIp);

  return {
    sessionKey,
    ipKey,
    sessionCount: session?.count || 0,
    ipCount: ip?.count || 0,
    cooldownMs,
  };
}

export function evaluateVerifyRisk(req: Request, input: VerifyRiskInput): VerifyRiskResult {
  const actionType = parseActionType(input.actionType);
  if (!actionType) {
    throw new Error("invalid_action_type");
  }

  const now = nowMs();
  trimMaps(now);

  const sessionId = deriveSessionId(req, input.sessionIdHint || null);
  const ipHash = sha256Hex(pickClientIp(req));
  const fingerprintHash = computeFingerprintHash(req);
  const sessionSnapshot = getOrCreateSessionState(sessionId, now);
  const mutate = input.mutate !== false;

  const earlyBlock = riskEarlyBlock(actionType, req, sessionId, ipHash, mutate);
  if (earlyBlock.blocked) {
    return {
      actionType,
      decision: "block",
      reasonCode: earlyBlock.reasonCode,
      reasonCodes: earlyBlock.reasons,
      challengeRequired: false,
      sessionId,
      ipHash,
      fingerprintHash,
      score: 10,
      retryAfterSec: Math.max(1, earlyBlock.retryAfterSec),
    };
  }

  const failure = failureStateFor(actionType, sessionId, ipHash, now);
  if (failure.cooldownMs > 0) {
    return {
      actionType,
      decision: "block",
      reasonCode: "progressive_cooldown",
      reasonCodes: ["progressive_cooldown"],
      challengeRequired: false,
      sessionId,
      ipHash,
      fingerprintHash,
      score: 10,
      retryAfterSec: Math.ceil(failure.cooldownMs / 1000),
    };
  }

  let score = 0;
  const reasonCodes: string[] = [];

  if (failure.ipCount >= 3) {
    score += 2;
    reasonCodes.push("failure_history_ip");
  }
  if (failure.sessionCount >= 3) {
    score += 2;
    reasonCodes.push("failure_history_session");
  }

  const sessionAgeSec = Math.max(0, Math.floor((now - sessionSnapshot.firstSeenMs) / 1000));
  if (sessionSnapshot.requestCount >= 8 && sessionAgeSec < 45) {
    score += 2;
    reasonCodes.push("velocity_session_burst");
  }

  if (!hasSessionCookie(req)) {
    if (actionType === "invite") {
      score += 2;
      reasonCodes.push("continuity_missing_auth_session");
    } else {
      score += 1;
      reasonCodes.push("continuity_new_session");
    }
  }

  const net = networkRiskSignals(req);
  if (net.score > 0) {
    score += net.score;
    reasonCodes.push(...net.reasons);
  }

  const ua = uaRiskSignals(req);
  if (ua.score > 0) {
    score += ua.score;
    reasonCodes.push(...ua.reasons);
  }

  const interaction = interactionRiskSignals(input.interaction);
  if (interaction.score > 0) {
    score += interaction.score;
    reasonCodes.push(...interaction.reasons);
  }

  const policy = ACTION_POLICY[actionType];
  let decision: VerifyDecision = "allow";
  if (score >= policy.blockThreshold) {
    decision = "block";
  } else if (score >= policy.stepUpThreshold) {
    decision = "step_up_required";
  } else if (score >= policy.monitorThreshold) {
    decision = "monitor";
  }

  const reasonCode = reasonCodes[0] || (decision === "allow" ? "low_risk" : "risk_scored");
  return {
    actionType,
    decision,
    reasonCode,
    reasonCodes,
    challengeRequired: decision === "step_up_required",
    sessionId,
    ipHash,
    fingerprintHash,
    score,
    retryAfterSec: 0,
  };
}

export function extractVerifySessionId(req: Request, fallback?: unknown) {
  const headerSession = safeString(req.headers.get(VERIFY_SESSION_HEADER)).trim();
  if (headerSession) return headerSession;
  const fallbackSession = safeString(fallback).trim();
  if (fallbackSession) return fallbackSession;
  return parseCookie(req, VERIFY_SESSION_COOKIE);
}

export function extractVerifyGrantToken(req: Request, fallback?: unknown) {
  const headerGrant = safeString(req.headers.get(VERIFY_GRANT_HEADER)).trim();
  if (headerGrant) return headerGrant;
  return safeString(fallback).trim();
}

export function buildVerifyErrorPayload(result: EnsureVerifyResult) {
  const blocked = result.decision === "block";
  const cooldownCopy =
    blocked && result.retryAfterSec > 0
      ? `Too many requests right now. Retry in about ${result.retryAfterSec}s.`
      : "Quick check to protect CavBot.";

  return {
    ok: false,
    error: blocked ? "VERIFY_BLOCKED" : "VERIFY_STEP_UP_REQUIRED",
    message: cooldownCopy,
    verify: {
      actionType: result.actionType,
      decision: result.decision,
      reasonCode: result.reasonCode,
      challengeRequired: result.decision === "step_up_required",
      fallbackAllowed: true,
      retryAfterSec: result.retryAfterSec,
      sessionId: result.sessionId,
    },
  };
}

export function ensureActionVerification(req: Request, input: EnsureVerifyInput): EnsureVerifyResult {
  const actionType = parseActionType(input.actionType);
  if (!actionType) {
    return {
      ok: false,
      usedGrant: false,
      actionType: "login",
      decision: "block",
      reasonCode: "invalid_action_type",
      reasonCodes: ["invalid_action_type"],
      challengeRequired: false,
      sessionId: deriveSessionId(req, input.sessionIdHint || null),
      ipHash: sha256Hex(pickClientIp(req)),
      fingerprintHash: computeFingerprintHash(req),
      score: 10,
      retryAfterSec: 60,
    };
  }

  try {
    const risk = evaluateVerifyRisk(req, {
      actionType,
      route: input.route,
      sessionIdHint: input.sessionIdHint,
      interaction: input.interaction,
      mutate: true,
    });

    const grantToken = safeString(input.verificationGrantToken).trim();
    let usedGrant = false;
    let grantErrorCode = "";

    if (grantToken) {
      const consumed = consumeGrant({
        token: grantToken,
        actionType,
        sessionId: risk.sessionId,
        ipHash: risk.ipHash,
        deviceHash: risk.fingerprintHash,
      });

      if (consumed.ok) {
        usedGrant = true;
      } else {
        grantErrorCode = consumed.reasonCode;
      }
    }

    if (grantToken && !usedGrant) {
      return {
        ...risk,
        ok: false,
        usedGrant: false,
        reasonCode: grantErrorCode || "grant_invalid",
        reasonCodes: [grantErrorCode || "grant_invalid"],
      };
    }

    if (risk.decision === "allow" || risk.decision === "monitor") {
      return {
        ...risk,
        ok: true,
        usedGrant,
      };
    }

    if (risk.decision === "block") {
      return {
        ...risk,
        ok: false,
        usedGrant: false,
        reasonCode: risk.reasonCode || "verify_blocked",
        reasonCodes: risk.reasonCodes?.length ? risk.reasonCodes : ["verify_blocked"],
      };
    }

    if (!grantToken) {
      return { ...risk, ok: false, usedGrant: false };
    }
    return {
      ...risk,
      ok: true,
      usedGrant,
      decision: "monitor",
      challengeRequired: false,
    };
  } catch {
    const sessionId = deriveSessionId(req, input.sessionIdHint || null);
    return {
      ok: false,
      usedGrant: false,
      actionType,
      decision: "block",
      reasonCode: "verify_internal_error",
      reasonCodes: ["verify_internal_error"],
      challengeRequired: false,
      sessionId,
      ipHash: sha256Hex(pickClientIp(req)),
      fingerprintHash: computeFingerprintHash(req),
      score: 10,
      retryAfterSec: 60,
    };
  }
}

export function recordVerifyActionFailure(req: Request, args: { actionType: VerifyActionType; sessionIdHint?: string | null }) {
  const actionType = parseActionType(args.actionType);
  if (!actionType) return;

  const now = nowMs();
  const sessionId = deriveSessionId(req, args.sessionIdHint || null);
  const ipHash = sha256Hex(pickClientIp(req));
  const sessionKey = `${actionType}:session:${sha256Hex(sessionId)}`;
  const ipKey = `${actionType}:ip:${ipHash}`;

  bumpFailure(sessionKey, now);
  bumpFailure(ipKey, now);
  getOrCreateSessionState(sessionId, now);
  trimMaps(now);
}

export function recordVerifyActionSuccess(req: Request, args: { actionType: VerifyActionType; sessionIdHint?: string | null }) {
  const actionType = parseActionType(args.actionType);
  if (!actionType) return;
  const sessionId = deriveSessionId(req, args.sessionIdHint || null);
  const ipHash = sha256Hex(pickClientIp(req));
  softenFailure(`${actionType}:session:${sha256Hex(sessionId)}`);
  softenFailure(`${actionType}:ip:${ipHash}`);
}

function deterministicValue(seed: string, salt: string) {
  const digest = sha256Hex(`${seed}:${salt}`);
  return parseInt(digest.slice(0, 8), 16);
}

function deterministicShuffle<T>(seed: string, values: readonly T[], toKey?: (value: T, index: number) => string) {
  return [...values]
    .map((value, index) => ({
      value,
      index,
      weight: deterministicValue(seed, `shuffle:${index}:${toKey ? toKey(value, index) : safeString(value)}`),
    }))
    .sort((a, b) => {
      if (a.weight !== b.weight) return a.weight - b.weight;
      return a.index - b.index;
    })
    .map((entry) => entry.value);
}

function glyphShapeByIndex(index: number): VerifyShape {
  const glyph = CAVBOT_WORDMARK_GLYPHS[index];
  return {
    svgPath: glyph.path,
    svgViewBox: CAVBOT_WORDMARK_VIEWBOX,
    svgFill: glyph.fill,
    svgFillRule: glyph.fillRule,
    svgClipRule: glyph.clipRule,
  };
}

function boxToViewBox(input: { x: number; y: number; width: number; height: number }, paddingRatio = 0) {
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);
  const padX = width * Math.max(0, paddingRatio);
  const padY = height * Math.max(0, paddingRatio);
  const x = input.x - padX;
  const y = input.y - padY;
  const outWidth = width + padX * 2;
  const outHeight = height + padY * 2;
  return `${Number(x.toFixed(3))} ${Number(y.toFixed(3))} ${Number(outWidth.toFixed(3))} ${Number(outHeight.toFixed(3))}`;
}

function deriveMissingGlyphIndex(sessionId: string, nonce: string) {
  const secret = verifySecret();
  const digest = createHmac("sha256", secret)
    .update(`${sessionId}:${nonce}:${VERIFY_ENGINE_VERSION}`)
    .digest();
  return digest.readUInt32BE(0) % CAVBOT_WORDMARK_GLYPHS.length;
}

function buildShapeChallenge(sessionId: string, nonce: string, route: string) {
  const seed = sha256Hex(`${sessionId}:${nonce}:${route}:${VERIFY_ENGINE_VERSION}`);
  const missingGlyphIndex = deriveMissingGlyphIndex(sessionId, nonce);
  const missingGlyph = CAVBOT_WORDMARK_GLYPHS[missingGlyphIndex];
  const slot = missingGlyph.slotBox;

  const wordmarkGlyphs: VerifyChallengeWordmarkGlyph[] = CAVBOT_WORDMARK_GLYPHS
    .map((glyph, glyphIndex) => ({ glyph, glyphIndex }))
    .filter((entry) => entry.glyphIndex !== missingGlyphIndex)
    .map((entry, index) => ({
      shapeId: `cbv_wm_${index}_${sha256Hex(`${nonce}:wm:${entry.glyphIndex}`).slice(0, 12)}`,
      ...glyphShapeByIndex(entry.glyphIndex),
    }));

  const candidateDecoys = CAVBOT_WORDMARK_GLYPHS.map((_, index) => index).filter((index) => index !== missingGlyphIndex);
  const decoyCount = 3; // Always ship 4 tiles total for consistent layout.
  const decoyIndexes = deterministicShuffle(seed, candidateDecoys, (value) => String(value)).slice(0, decoyCount);
  const tileIndexes = deterministicShuffle(
    `${seed}:tile-order`,
    [missingGlyphIndex, ...decoyIndexes],
    (value, index) => `${value}:${index}`,
  );

  const tiles: VerifyChallengeTileRecord[] = tileIndexes.map((glyphIndex, index) => {
    const shape = glyphShapeByIndex(glyphIndex);
    const glyph = CAVBOT_WORDMARK_GLYPHS[glyphIndex];
    const tileId = `cbv_tile_${index}_${sha256Hex(`${nonce}:${glyphIndex}:${seed}`).slice(0, 10)}`;
    const jitterY = (deterministicValue(seed, `jy:${index}`) % 7) - 3;
    const rotationDeg = ((deterministicValue(seed, `jr:${index}`) % 9) - 4) * 0.75;
    return {
      tileId,
      tileIdHash: sha256Hex(tileId),
      glyphIndex,
      svgPath: shape.svgPath,
      svgViewBox: boxToViewBox(glyph.glyphBox, 0.16),
      svgFill: shape.svgFill,
      svgFillRule: shape.svgFillRule,
      svgClipRule: shape.svgClipRule,
      jitterY,
      rotationDeg: Number(rotationDeg.toFixed(2)),
    };
  });

  const correctTileIdHash =
    tiles.find((tile) => tile.glyphIndex === missingGlyphIndex)?.tileIdHash || sha256Hex(`missing:${seed}`);

  return {
    missingGlyphIndex,
    slot,
    tiles,
    wordmarkGlyphs,
    correctTileIdHash,
  };
}

function toPublicChallengeTiles(tiles: VerifyChallengeTileRecord[]): VerifyChallengeTile[] {
  return tiles.map((tile) => ({
    tileId: tile.tileId,
    svgPath: tile.svgPath,
    svgViewBox: tile.svgViewBox,
    svgFill: tile.svgFill,
    svgFillRule: tile.svgFillRule,
    svgClipRule: tile.svgClipRule,
    jitterY: tile.jitterY,
    rotationDeg: tile.rotationDeg,
  }));
}

export type CreateVerifyChallengeInput = {
  actionType: VerifyActionType;
  route?: string | null;
  sessionIdHint?: string | null;
};

export type CreateVerifyChallengeResult =
  | {
      ok: true;
      challengeId: string;
      challengeToken: string;
      sessionId: string;
      nonce: string;
      expiresAt: string;
      render: {
        engineVersion: string;
        wordmarkModel: string;
        viewBox: string;
        wordmarkGlyphs: VerifyChallengeWordmarkGlyph[];
        slot: VerifyChallengeSlot;
        slotGlyph: VerifyShape;
      };
      prompt: string;
      tiles: VerifyChallengeTile[];
    }
  | {
      ok: false;
      error: string;
      message: string;
      sessionId?: string;
      retryAfterSec?: number;
    };

export function createVerifyChallenge(req: Request, input: CreateVerifyChallengeInput): CreateVerifyChallengeResult {
  const actionType = parseActionType(input.actionType);
  if (!actionType) {
    return { ok: false, error: "BAD_ACTION", message: "Invalid verify action type." };
  }

  const now = nowMs();
  trimMaps(now);

  const sessionId = deriveSessionId(req, input.sessionIdHint || null);
  const ipHash = sha256Hex(pickClientIp(req));
  const challengeRate = consumeRateLimit({
    key: `cbv:challenge:create:${actionType}:${sha256Hex(sessionId)}:${ipHash}`,
    limit: 8,
    windowMs: 60_000,
  });
  if (!challengeRate.allowed) {
    return {
      ok: false,
      error: "RATE_LIMITED",
      message: "Too many verify attempts. Try again shortly.",
      sessionId,
      retryAfterSec: challengeRate.retryAfterSec,
    };
  }

  const challengeId = `cbv_ch_${randomBytes(16).toString("base64url")}`;
  const challengeIdHash = sha256Hex(challengeId);
  const nonce = randomBytes(18).toString("base64url");
  const nonceHash = sha256Hex(nonce);
  const route = normalizeRoute(input.route);
  const deviceHash = computeFingerprintHash(req);
  const shapeChallenge = buildShapeChallenge(sessionId, nonce, route);

  const record: VerifyChallengeRecord = {
    challengeIdHash,
    actionType,
    route,
    sessionId,
    ipHash,
    deviceHash,
    nonceHash,
    status: "PENDING",
    attempts: 0,
    maxAttempts: MAX_CHALLENGE_ATTEMPTS,
    createdAtMs: now,
    expiresAtMs: now + CHALLENGE_TTL_MS,
    missingGlyphIndex: shapeChallenge.missingGlyphIndex,
    correctTileIdHash: shapeChallenge.correctTileIdHash,
    slot: shapeChallenge.slot,
    wordmarkGlyphs: shapeChallenge.wordmarkGlyphs,
    tiles: shapeChallenge.tiles,
  };
  challengeStore.set(challengeIdHash, record);
  getOrCreateSessionState(sessionId, now);

  const challengeToken = encryptChallengeToken({
    v: 1,
    challengeIdHash,
    actionType,
    sessionId,
    ipHash,
    deviceHash,
    nonceHash,
    correctTileIdHash: record.correctTileIdHash,
    iat: Math.floor(now / 1000),
    exp: Math.floor(record.expiresAtMs / 1000),
  });

  return {
    ok: true,
    challengeId,
    challengeToken,
    sessionId,
    nonce,
    expiresAt: toIso(record.expiresAtMs),
    render: {
      engineVersion: VERIFY_ENGINE_VERSION,
      wordmarkModel: CAVBOT_WORDMARK_MODEL,
      viewBox: CAVBOT_WORDMARK_VIEWBOX,
      wordmarkGlyphs: record.wordmarkGlyphs,
      slot: record.slot,
      slotGlyph: SLOT_PLACEHOLDER_GLYPH,
    },
    prompt: "Quick check to protect CavBot.",
    tiles: toPublicChallengeTiles(record.tiles),
  };
}

type GestureSummary = {
  pointerDown?: boolean;
  pointerMoves?: number;
  moveEventsCount?: number;
  distancePx?: number;
  durationMs?: number;
  droppedInSlot?: boolean;
  pointerType?: unknown;
};

export function validateGestureSummary(summary: unknown) {
  const s = (summary || {}) as GestureSummary;
  const pointerDown = bool(s.pointerDown);
  const pointerMoves = Number(s.moveEventsCount ?? s.pointerMoves ?? 0);
  const distancePx = Number(s.distancePx ?? 0);
  const durationMs = Number(s.durationMs ?? 0);
  const droppedInSlot = bool(s.droppedInSlot);
  const pointerType = safeString(s.pointerType).trim().toLowerCase();
  const pointerTypeAllowed = pointerType === "mouse" || pointerType === "touch" || pointerType === "pen" || !pointerType;

  return (
    pointerDown &&
    droppedInSlot &&
    pointerTypeAllowed &&
    Number.isFinite(pointerMoves) &&
    Number.isFinite(distancePx) &&
    Number.isFinite(durationMs) &&
    pointerMoves >= 1 &&
    distancePx >= 12 &&
    durationMs >= 90 &&
    durationMs <= 20_000
  );
}

export type SubmitVerifyChallengeInput = {
  challengeId: string;
  challengeToken?: string | null;
  nonce: string;
  chosenTileId?: string | null;
  answer?: {
    tileId?: string;
  } | null;
  gestureSummary?: unknown;
  sessionIdHint?: string | null;
};

export type SubmitVerifyChallengeResult =
  | {
      ok: true;
      verificationGrantToken: string;
      expiresAt: string;
      sessionId: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
      attemptsRemaining: number;
      fallbackAllowed: boolean;
      sessionId?: string;
    };

export function submitVerifyChallenge(req: Request, input: SubmitVerifyChallengeInput): SubmitVerifyChallengeResult {
  const challengeId = safeString(input.challengeId).trim();
  if (!challengeId) {
    return {
      ok: false,
      error: "BAD_INPUT",
      message: "Missing challenge id.",
      attemptsRemaining: 0,
      fallbackAllowed: true,
    };
  }

  const now = nowMs();
  trimMaps(now);

  const sessionId = deriveSessionId(req, input.sessionIdHint || null);
  const ipHash = sha256Hex(pickClientIp(req));
  const deviceHash = computeFingerprintHash(req);
  const challengeIdHash = sha256Hex(challengeId);
  const fallbackChallenge = decryptChallengeToken(input.challengeToken || "");
  const record = challengeStore.get(challengeIdHash) || null;
  if (!record) {
    if (!fallbackChallenge || fallbackChallenge.challengeIdHash !== challengeIdHash) {
      return {
        ok: false,
        error: "CHALLENGE_NOT_FOUND",
        message: "Challenge not found.",
        attemptsRemaining: 0,
        fallbackAllowed: true,
      };
    }
  }

  const resolvedActionType = record?.actionType || fallbackChallenge?.actionType;
  const fallbackAttemptKey =
    !record && fallbackChallenge
      ? `${challengeIdHash}:${sha256Hex(sessionId)}:${ipHash}:${deviceHash}`
      : "";
  const fallbackAttemptState = fallbackAttemptKey
    ? challengeFallbackAttemptStore.get(fallbackAttemptKey) || null
    : null;
  const fallbackAttemptsRemaining =
    fallbackAttemptState && Number.isFinite(fallbackAttemptState.attempts)
      ? Math.max(0, MAX_CHALLENGE_ATTEMPTS - fallbackAttemptState.attempts)
      : MAX_CHALLENGE_ATTEMPTS;

  const submitRate = consumeRateLimit({
    key: `cbv:challenge:submit:${resolvedActionType || "unknown"}:${sha256Hex(sessionId)}:${ipHash}`,
    limit: 14,
    windowMs: 60_000,
  });
  if (!submitRate.allowed) {
    return {
      ok: false,
      error: "VERIFY_COOLDOWN",
      message: "Too many attempts. Try again shortly.",
      attemptsRemaining: record ? Math.max(0, record.maxAttempts - record.attempts) : fallbackAttemptsRemaining,
      fallbackAllowed: true,
      sessionId,
    };
  }

  if (!record && fallbackChallenge) {
    if (
      fallbackChallenge.sessionId !== sessionId ||
      fallbackChallenge.ipHash !== ipHash ||
      fallbackChallenge.deviceHash !== deviceHash
    ) {
      return {
        ok: false,
        error: "CHALLENGE_SCOPE_INVALID",
        message: "Challenge scope mismatch.",
        attemptsRemaining: fallbackAttemptsRemaining,
        fallbackAllowed: true,
        sessionId,
      };
    }

    const fallbackExpiresAtMs = Number(fallbackChallenge.exp) * 1000;
    if (!Number.isFinite(fallbackExpiresAtMs) || fallbackExpiresAtMs <= now) {
      return {
        ok: false,
        error: "CHALLENGE_EXPIRED",
        message: "Challenge expired. Request a new check.",
        attemptsRemaining: 0,
        fallbackAllowed: true,
        sessionId,
      };
    }

    const state: VerifyChallengeFallbackAttemptState = {
      attempts: fallbackAttemptState?.attempts || 0,
      consumed: Boolean(fallbackAttemptState?.consumed),
      expiresAtMs: fallbackExpiresAtMs,
    };
    if (state.consumed) {
      return {
        ok: false,
        error: "CHALLENGE_ALREADY_SOLVED",
        message: "Challenge already solved.",
        attemptsRemaining: 0,
        fallbackAllowed: true,
        sessionId,
      };
    }
    if (state.attempts >= MAX_CHALLENGE_ATTEMPTS) {
      return {
        ok: false,
        error: "CHALLENGE_FAILED",
        message: "Challenge attempts exhausted.",
        attemptsRemaining: 0,
        fallbackAllowed: true,
        sessionId,
      };
    }

    const nonce = safeString(input.nonce).trim();
    const chosenTileId = safeString(input.chosenTileId || input.answer?.tileId).trim();
    const nonceOk = nonce && sha256Hex(nonce) === fallbackChallenge.nonceHash;
    const answerOk = chosenTileId && sha256Hex(chosenTileId) === fallbackChallenge.correctTileIdHash;
    const gestureOk = validateGestureSummary(input.gestureSummary);

    if (!nonceOk || !answerOk || !gestureOk) {
      state.attempts += 1;
      challengeFallbackAttemptStore.set(fallbackAttemptKey, state);
      bumpFailure(`${fallbackChallenge.actionType}:session:${sha256Hex(fallbackChallenge.sessionId)}`, now);
      bumpFailure(`${fallbackChallenge.actionType}:ip:${fallbackChallenge.ipHash}`, now);
      return {
        ok: false,
        error: !gestureOk ? "VERIFY_GESTURE_INVALID" : "VERIFY_CHALLENGE_INVALID",
        message: !gestureOk ? "Drag the tile into the slot to continue." : "Try again.",
        attemptsRemaining: Math.max(0, MAX_CHALLENGE_ATTEMPTS - state.attempts),
        fallbackAllowed: true,
        sessionId,
      };
    }

    state.consumed = true;
    challengeFallbackAttemptStore.set(fallbackAttemptKey, state);
    softenFailure(`${fallbackChallenge.actionType}:session:${sha256Hex(fallbackChallenge.sessionId)}`);
    softenFailure(`${fallbackChallenge.actionType}:ip:${fallbackChallenge.ipHash}`);

    const grant = issueGrant({
      actionType: fallbackChallenge.actionType,
      method: "challenge",
      sessionId: fallbackChallenge.sessionId,
      ipHash: fallbackChallenge.ipHash,
      deviceHash: fallbackChallenge.deviceHash,
      challengeIdHash: fallbackChallenge.challengeIdHash,
    });

    return {
      ok: true,
      verificationGrantToken: grant.token,
      expiresAt: grant.expiresAt,
      sessionId: fallbackChallenge.sessionId,
    };
  }

  if (!record) {
    return {
      ok: false,
      error: "CHALLENGE_NOT_FOUND",
      message: "Challenge not found.",
      attemptsRemaining: 0,
      fallbackAllowed: true,
      sessionId,
    };
  }

  if (record.sessionId !== sessionId || record.ipHash !== ipHash || record.deviceHash !== deviceHash) {
    const scopeKeySession = `${record.actionType}:session:${sha256Hex(record.sessionId)}`;
    const scopeKeyIp = `${record.actionType}:ip:${record.ipHash}`;
    bumpFailure(scopeKeySession, now);
    bumpFailure(scopeKeyIp, now);
    return {
      ok: false,
      error: "CHALLENGE_SCOPE_INVALID",
      message: "Challenge scope mismatch.",
      attemptsRemaining: Math.max(0, record.maxAttempts - record.attempts),
      fallbackAllowed: true,
      sessionId,
    };
  }

  if (record.expiresAtMs <= now) {
    record.status = "EXPIRED";
    challengeStore.set(challengeIdHash, record);
    return {
      ok: false,
      error: "CHALLENGE_EXPIRED",
      message: "Challenge expired. Request a new check.",
      attemptsRemaining: 0,
      fallbackAllowed: true,
      sessionId,
    };
  }

  if (record.status === "FAILED") {
    return {
      ok: false,
      error: "CHALLENGE_FAILED",
      message: "Challenge attempts exhausted.",
      attemptsRemaining: 0,
      fallbackAllowed: true,
      sessionId,
    };
  }
  if (record.status === "PASSED" || record.status === "CONSUMED") {
    return {
      ok: false,
      error: "CHALLENGE_ALREADY_SOLVED",
      message: "Challenge already solved.",
      attemptsRemaining: 0,
      fallbackAllowed: true,
      sessionId,
    };
  }

  const nonce = safeString(input.nonce).trim();
  const chosenTileId = safeString(input.chosenTileId || input.answer?.tileId).trim();
  const selectedTile = record.tiles.find((tile) => tile.tileId === chosenTileId) || null;
  const nonceOk = nonce && sha256Hex(nonce) === record.nonceHash;
  const answerOk = Boolean(selectedTile && selectedTile.tileIdHash === record.correctTileIdHash);
  const gestureOk = validateGestureSummary(input.gestureSummary);

  if (!nonceOk || !answerOk || !gestureOk) {
    record.attempts += 1;
    if (record.attempts >= record.maxAttempts) {
      record.status = "FAILED";
    }
    challengeStore.set(challengeIdHash, record);
    bumpFailure(`${record.actionType}:session:${sha256Hex(record.sessionId)}`, now);
    bumpFailure(`${record.actionType}:ip:${record.ipHash}`, now);
    return {
      ok: false,
      error: !gestureOk ? "VERIFY_GESTURE_INVALID" : "VERIFY_CHALLENGE_INVALID",
      message: !gestureOk ? "Drag the tile into the slot to continue." : "Try again.",
      attemptsRemaining: Math.max(0, record.maxAttempts - record.attempts),
      fallbackAllowed: true,
      sessionId,
    };
  }

  record.status = "PASSED";
  challengeStore.set(challengeIdHash, record);
  softenFailure(`${record.actionType}:session:${sha256Hex(record.sessionId)}`);
  softenFailure(`${record.actionType}:ip:${record.ipHash}`);

  const grant = issueGrant({
    actionType: record.actionType,
    method: "challenge",
    sessionId: record.sessionId,
    ipHash: record.ipHash,
    deviceHash: record.deviceHash,
    challengeIdHash: record.challengeIdHash,
  });

  return {
    ok: true,
    verificationGrantToken: grant.token,
    expiresAt: grant.expiresAt,
    sessionId: record.sessionId,
  };
}

function randomSixDigitCode() {
  if (process.env.NODE_ENV !== "production") {
    const forced = safeString(process.env.CAVBOT_VERIFY_TEST_CODE).trim();
    if (/^\d{6}$/.test(forced)) return forced;
  }
  const value = parseInt(randomBytes(3).toString("hex"), 16) % 1_000_000;
  return String(value).padStart(6, "0");
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(safeString(email).trim());
}

async function resolveOtpEmail(args: {
  req: Request;
  actionType: VerifyActionType;
  identifier?: string | null;
  email?: string | null;
}) {
  const email = safeString(args.email).trim().toLowerCase();
  if (email && isValidEmail(email)) return email;

  const identifier = safeString(args.identifier).trim();
  if (identifier.includes("@") && isValidEmail(identifier)) {
    return identifier.toLowerCase();
  }

  if (identifier && (args.actionType === "login" || args.actionType === "reset")) {
    const username = normalizeUsername(identifier);
    if (username) {
      const { prisma } = await import("@/lib/prisma");
      const user = await prisma.user.findUnique({
        where: { username },
        select: { email: true },
      });
      if (user?.email) return String(user.email).trim().toLowerCase();
    }
  }

  if (args.actionType === "invite") {
    const { getSession } = await import("@/lib/apiAuth");
    const { prisma } = await import("@/lib/prisma");
    const session = await getSession(args.req);
    const userId = safeString(session?.sub).trim();
    if (userId && userId !== "system") {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (user?.email) return String(user.email).trim().toLowerCase();
    }
  }

  return "";
}

export type StartVerifyOtpInput = {
  actionType: VerifyActionType;
  challengeId?: string | null;
  challengeToken?: string | null;
  identifier?: string | null;
  email?: string | null;
  sessionIdHint?: string | null;
};

export type StartVerifyOtpResult =
  | {
      ok: true;
      otpChallengeId: string;
      expiresAt: string;
      sessionId: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
      sessionId?: string;
      retryAfterSec?: number;
    };

export async function startVerifyOtp(req: Request, input: StartVerifyOtpInput): Promise<StartVerifyOtpResult> {
  const actionType = parseActionType(input.actionType);
  if (!actionType) return { ok: false, error: "BAD_ACTION", message: "Invalid verify action type." };

  const now = nowMs();
  trimMaps(now);

  const sessionId = deriveSessionId(req, input.sessionIdHint || null);
  const ipHash = sha256Hex(pickClientIp(req));
  const deviceHash = computeFingerprintHash(req);

  const ipRate = consumeRateLimit({
    key: `cbv:otp:start:ip:${actionType}:${ipHash}`,
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!ipRate.allowed) {
    return {
      ok: false,
      error: "RATE_LIMITED",
      message: "Too many OTP attempts. Try again shortly.",
      sessionId,
      retryAfterSec: ipRate.retryAfterSec,
    };
  }

  const sessionRate = consumeRateLimit({
    key: `cbv:otp:start:session:${actionType}:${sha256Hex(sessionId)}`,
    limit: 4,
    windowMs: 10 * 60_000,
  });
  if (!sessionRate.allowed) {
    return {
      ok: false,
      error: "RATE_LIMITED",
      message: "Too many OTP attempts. Try again shortly.",
      sessionId,
      retryAfterSec: sessionRate.retryAfterSec,
    };
  }

  const challengeId = safeString(input.challengeId).trim();
  if (challengeId) {
    const challengeIdHash = sha256Hex(challengeId);
    const challenge = challengeStore.get(challengeIdHash);
    if (challenge) {
      if (
        challenge.actionType !== actionType ||
        challenge.sessionId !== sessionId ||
        challenge.ipHash !== ipHash ||
        challenge.deviceHash !== deviceHash
      ) {
        return {
          ok: false,
          error: "CHALLENGE_SCOPE_MISMATCH",
          message: "Challenge scope mismatch.",
          sessionId,
        };
      }
    } else {
      const fallback = decryptChallengeToken(input.challengeToken || "");
      const fallbackExpiresAtMs = Number(fallback?.exp || 0) * 1000;
      const fallbackValid =
        Boolean(fallback) &&
        fallback!.challengeIdHash === challengeIdHash &&
        fallback!.actionType === actionType &&
        fallback!.sessionId === sessionId &&
        fallback!.ipHash === ipHash &&
        fallback!.deviceHash === deviceHash &&
        Number.isFinite(fallbackExpiresAtMs) &&
        fallbackExpiresAtMs > now;
      if (!fallbackValid) {
        return {
          ok: false,
          error: "CHALLENGE_SCOPE_MISMATCH",
          message: "Challenge scope mismatch.",
          sessionId,
        };
      }
    }
  }

  const targetEmail = await resolveOtpEmail({
    req,
    actionType,
    identifier: input.identifier,
    email: input.email,
  });

  if (!targetEmail || !isValidEmail(targetEmail)) {
    return {
      ok: false,
      error: "OTP_TARGET_UNAVAILABLE",
      message: "Add an email to receive a code.",
      sessionId,
    };
  }

  const otpChallengeId = `cbv_otp_${randomBytes(16).toString("base64url")}`;
  const otpChallengeIdHash = sha256Hex(otpChallengeId);
  const code = randomSixDigitCode();
  const record: VerifyOtpRecord = {
    otpChallengeIdHash,
    actionType,
    sessionId,
    ipHash,
    deviceHash,
    status: "PENDING",
    attempts: 0,
    maxAttempts: MAX_OTP_ATTEMPTS,
    codeHash: sha256Hex(code),
    emailHash: sha256Hex(targetEmail),
    createdAtMs: now,
    expiresAtMs: now + OTP_TTL_MS,
  };
  otpStore.set(otpChallengeIdHash, record);

  try {
    await sendEmail({
      to: targetEmail,
      subject: "Your CavBot Verify code",
      html: `
        <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
          <h2 style="margin:0 0 10px;">CavBot Verify</h2>
          <p style="margin:0 0 14px;">Enter this code to continue.</p>
          <div style="margin:16px 0; padding:14px 16px; border-radius:14px; background:#0b1020; border:1px solid rgba(255,255,255,0.14); display:inline-block;">
            <div style="font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:rgba(234,240,255,0.62); margin-bottom:8px;">Verification code</div>
            <div style="font-size:26px; font-weight:900; letter-spacing:.16em; color:#eaf0ff;">${code}</div>
          </div>
          <p style="margin:14px 0 0; font-size:12px; color:rgba(234,240,255,0.65);">This code expires in 10 minutes.</p>
        </div>
      `,
    });
  } catch {
    otpStore.delete(otpChallengeIdHash);
    return {
      ok: false,
      error: "OTP_DELIVERY_FAILED",
      message: "Could not send email code right now.",
      sessionId,
    };
  }

  return {
    ok: true,
    otpChallengeId,
    expiresAt: toIso(record.expiresAtMs),
    sessionId,
  };
}

export type ConfirmVerifyOtpInput = {
  otpChallengeId: string;
  code: string;
  actionType?: VerifyActionType | null;
  sessionIdHint?: string | null;
};

export type ConfirmVerifyOtpResult =
  | {
      ok: true;
      verificationGrantToken: string;
      expiresAt: string;
      sessionId: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
      attemptsRemaining: number;
      fallbackAllowed: boolean;
      sessionId?: string;
    };

export function confirmVerifyOtp(req: Request, input: ConfirmVerifyOtpInput): ConfirmVerifyOtpResult {
  const otpChallengeId = safeString(input.otpChallengeId).trim();
  const code = safeString(input.code).trim();
  if (!otpChallengeId || !/^\d{6}$/.test(code)) {
    return {
      ok: false,
      error: "BAD_INPUT",
      message: "Enter the 6-digit code.",
      attemptsRemaining: 0,
      fallbackAllowed: true,
    };
  }

  const now = nowMs();
  trimMaps(now);
  const sessionId = deriveSessionId(req, input.sessionIdHint || null);
  const ipHash = sha256Hex(pickClientIp(req));
  const deviceHash = computeFingerprintHash(req);

  const confirmRate = consumeRateLimit({
    key: `cbv:otp:confirm:${sha256Hex(sessionId)}:${ipHash}`,
    limit: 16,
    windowMs: 60_000,
  });
  if (!confirmRate.allowed) {
    return {
      ok: false,
      error: "OTP_COOLDOWN",
      message: "Too many code checks. Try again shortly.",
      attemptsRemaining: 0,
      fallbackAllowed: true,
      sessionId,
    };
  }

  const otpChallengeIdHash = sha256Hex(otpChallengeId);
  const record = otpStore.get(otpChallengeIdHash);
  if (!record) {
    return {
      ok: false,
      error: "OTP_CHALLENGE_NOT_FOUND",
      message: "Code challenge not found.",
      attemptsRemaining: 0,
      fallbackAllowed: true,
    };
  }

  const inputActionType = parseActionType(input.actionType);
  if (inputActionType && inputActionType !== record.actionType) {
    return {
      ok: false,
      error: "OTP_SCOPE_MISMATCH",
      message: "Code scope mismatch.",
      attemptsRemaining: Math.max(0, record.maxAttempts - record.attempts),
      fallbackAllowed: true,
    };
  }

  if (record.sessionId !== sessionId || record.ipHash !== ipHash || record.deviceHash !== deviceHash) {
    return {
      ok: false,
      error: "OTP_SCOPE_MISMATCH",
      message: "Code scope mismatch.",
      attemptsRemaining: Math.max(0, record.maxAttempts - record.attempts),
      fallbackAllowed: true,
      sessionId,
    };
  }

  if (record.expiresAtMs <= now) {
    record.status = "EXPIRED";
    otpStore.set(otpChallengeIdHash, record);
    return {
      ok: false,
      error: "OTP_EXPIRED",
      message: "Code expired. Request a new one.",
      attemptsRemaining: 0,
      fallbackAllowed: true,
      sessionId,
    };
  }

  if (record.status === "FAILED") {
    return {
      ok: false,
      error: "OTP_FAILED",
      message: "Too many failed attempts.",
      attemptsRemaining: 0,
      fallbackAllowed: true,
      sessionId,
    };
  }
  if (record.status === "PASSED" || record.status === "CONSUMED") {
    return {
      ok: false,
      error: "OTP_ALREADY_USED",
      message: "Code already used.",
      attemptsRemaining: 0,
      fallbackAllowed: true,
      sessionId,
    };
  }

  if (sha256Hex(code) !== record.codeHash) {
    record.attempts += 1;
    if (record.attempts >= record.maxAttempts) {
      record.status = "FAILED";
    }
    otpStore.set(otpChallengeIdHash, record);
    bumpFailure(`${record.actionType}:session:${sha256Hex(record.sessionId)}`, now);
    bumpFailure(`${record.actionType}:ip:${record.ipHash}`, now);
    return {
      ok: false,
      error: "OTP_INVALID",
      message: "Invalid code.",
      attemptsRemaining: Math.max(0, record.maxAttempts - record.attempts),
      fallbackAllowed: true,
      sessionId,
    };
  }

  record.status = "PASSED";
  otpStore.set(otpChallengeIdHash, record);
  softenFailure(`${record.actionType}:session:${sha256Hex(record.sessionId)}`);
  softenFailure(`${record.actionType}:ip:${record.ipHash}`);

  const grant = issueGrant({
    actionType: record.actionType,
    method: "otp",
    sessionId: record.sessionId,
    ipHash: record.ipHash,
    deviceHash: record.deviceHash,
    challengeIdHash: null,
  });

  return {
    ok: true,
    verificationGrantToken: grant.token,
    expiresAt: grant.expiresAt,
    sessionId: record.sessionId,
  };
}

export function parseRiskInteraction(input: unknown): VerifyRiskInteraction | null {
  if (!input || typeof input !== "object") return null;
  const payload = input as Record<string, unknown>;
  return {
    submitLatencyMs: Number(payload.submitLatencyMs ?? payload.submitMs ?? payload.latencyMs ?? 0),
    dwellMs: Number(payload.dwellMs ?? payload.editDurationMs ?? 0),
    pointerMoves: Number(payload.pointerMoves ?? 0),
  };
}

export function parseVerifyActionType(input: unknown): VerifyActionType | null {
  return parseActionType(input);
}

export function getVerifySessionHeaderName() {
  return VERIFY_SESSION_HEADER;
}

export function getVerifyGrantHeaderName() {
  return VERIFY_GRANT_HEADER;
}

export function getVerifySessionCookieName() {
  return VERIFY_SESSION_COOKIE;
}

export function __getVerifyChallengeSnapshotForTests(challengeId: string) {
  const id = safeString(challengeId).trim();
  if (!id) return null;
  const record = challengeStore.get(sha256Hex(id));
  if (!record) return null;
  const correctTile = record.tiles.find((tile) => tile.tileIdHash === record.correctTileIdHash) || null;
  return {
    actionType: record.actionType,
    sessionId: record.sessionId,
    ipHash: record.ipHash,
    deviceHash: record.deviceHash,
    status: record.status,
    missingGlyphIndex: record.missingGlyphIndex,
    tileIds: record.tiles.map((tile) => tile.tileId),
    tileGlyphIndexes: record.tiles.map((tile) => tile.glyphIndex),
    correctTileId: correctTile?.tileId || "",
    expiresAtMs: record.expiresAtMs,
  };
}

export function __resetCavbotVerifyForTests() {
  challengeStore.clear();
  grantStore.clear();
  otpStore.clear();
  challengeFallbackAttemptStore.clear();
  failureStore.clear();
  sessionStore.clear();
  rateBuckets.clear();
  cleanupCounter = 0;
}
