import "server-only";

type InMemoryBucket = {
  count: number;
  resetAt: number;
};

type ConsumeInput = {
  key: string;
  limit: number;
  windowMs: number;
};

type ConsumeResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

const buckets = new Map<string, InMemoryBucket>();

function nowMs() {
  return Date.now();
}

function safeInt(value: number, fallback: number, min: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function cleanupExpired(currentMs: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= currentMs) buckets.delete(key);
  }
}

export function consumeInMemoryRateLimit(input: ConsumeInput): ConsumeResult {
  const key = String(input.key || "").trim();
  const limit = safeInt(input.limit, 10, 1);
  const windowMs = safeInt(input.windowMs, 60_000, 1000);

  if (!key) {
    return {
      allowed: true,
      remaining: limit,
      retryAfterSec: 0,
    };
  }

  const currentMs = nowMs();
  cleanupExpired(currentMs);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= currentMs) {
    buckets.set(key, {
      count: 1,
      resetAt: currentMs + windowMs,
    });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSec: 0,
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - currentMs) / 1000)),
    };
  }

  existing.count += 1;
  buckets.set(key, existing);

  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSec: 0,
  };
}
