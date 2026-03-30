import { DurableObject } from "cloudflare:workers";

type BucketState = {
  tokens: number;
  last: number;
};

type RateLimitPayload = {
  key?: unknown;
  capacity?: unknown;
  refillPerSec?: unknown;
};

export class RateLimiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    let data: RateLimitPayload | null = null;
    try {
      const raw = (await request.json()) as unknown;
      data = raw && typeof raw === "object" ? (raw as RateLimitPayload) : null;
    } catch {
      return new Response("bad request", { status: 400 });
    }

    const key = String(data?.key ?? "").trim();
    if (!key) {
      return new Response(JSON.stringify({ ok: false, error: "missing_key" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const cap = Math.max(1, Number(data?.capacity ?? 120));
    const refill = Math.max(0.1, Number(data?.refillPerSec ?? 2));
    const now = Date.now();

    try {
      const stored =
        (await this.ctx.storage.get<BucketState>("bucket")) ?? {
          tokens: cap,
          last: now,
        };

      const elapsedSec = Math.max(0, (now - Number(stored.last || now)) / 1000);
      const refilled = Math.min(cap, Number(stored.tokens || 0) + elapsedSec * refill);

      if (refilled < 1) {
        await this.ctx.storage.put("bucket", { tokens: refilled, last: now });
        return new Response(JSON.stringify({ ok: false, limited: true, key }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }

      await this.ctx.storage.put("bucket", { tokens: refilled - 1, last: now });
      return new Response(JSON.stringify({ ok: true, key }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("rate_limiter_storage_error", { message });
      return new Response(
        JSON.stringify({ ok: false, error: "rate_limiter_unavailable" }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }
}
