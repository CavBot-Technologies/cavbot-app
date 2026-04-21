import type { RateLimitSpec } from "@/rate-limiter.do";

// Browser-side analytics legitimately emits bursts of page, route, focus,
// performance, and accessibility signals. Keep a real abuse guard, but size it
// for production telemetry instead of auth-style request rates.
export const EMBED_RATE_LIMIT_SPEC: RateLimitSpec = {
  capacity: 1200,
  refillPerSec: 20,
};

export const EMBED_RATE_LIMIT_LABEL = "1200 requests / min per visitor, site, and IP";
