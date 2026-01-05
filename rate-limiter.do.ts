// rate-limiter.do.ts
// Durable Object: token-bucket rate limiter
// NOTE: We intentionally DO NOT import or reference @cloudflare/workers-types here,
// because that can globally change Request/Response typing across your Next/OpenNext app
// and cause “thousands of errors”.

export type RateLimitSpec = {
  capacity: number;      // max tokens
  refillPerSec: number;  // tokens added per second
};

type BucketState = {
  tokens: number;
  ts: number; // ms epoch
};

type RateLimitRequestBody = {
  key: string;
  spec: RateLimitSpec;
};

/**
 * Minimal Durable Object typings (kept local to avoid global type conflicts).
 * Runtime is provided by Cloudflare/OpenNext — this is ONLY for TS sanity.
 */
type DurableObjectStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};

type DurableObjectState = {
  storage: DurableObjectStorage;
};

export class RateLimiter {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = (await req.json().catch(() => null)) as RateLimitRequestBody | null;

    if (
      !body ||
      typeof body.key !== "string" ||
      body.key.length === 0 ||
      !body.spec ||
      typeof body.spec.capacity !== "number" ||
      typeof body.spec.refillPerSec !== "number" ||
      !Number.isFinite(body.spec.capacity) ||
      !Number.isFinite(body.spec.refillPerSec) ||
      body.spec.capacity <= 0 ||
      body.spec.refillPerSec < 0
    ) {
      return new Response("Bad Request", { status: 400 });
    }

    const { key, spec } = body;

    const now = Date.now();

    const stored =
      (await this.state.storage.get<BucketState>(key)) ?? {
        tokens: spec.capacity,
        ts: now,
      };

    const elapsedSec = Math.max(0, (now - stored.ts) / 1000);
    const refill = elapsedSec * spec.refillPerSec;

    let tokens = Math.min(spec.capacity, stored.tokens + refill);
    const allowed = tokens >= 1;

    if (allowed) tokens -= 1;

    await this.state.storage.put(key, { tokens, ts: now });

    return new Response(
      JSON.stringify({
        ok: true,
        allowed,
        remaining: Math.floor(tokens),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}