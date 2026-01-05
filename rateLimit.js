export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const data = await request.json().catch(() => null);
    if (!data) return new Response("bad request", { status: 400 });

    const { key, capacity, refillPerSec } = data;

    const cap = Math.max(1, Number(capacity || 60));
    const refill = Math.max(0.1, Number(refillPerSec || 1));

    const now = Date.now();

    const stored = (await this.state.storage.get("bucket")) || {
      tokens: cap,
      last: now,
    };

    // refill
    const elapsedSec = (now - stored.last) / 1000;
    const refillTokens = elapsedSec * refill;
    const tokens = Math.min(cap, stored.tokens + refillTokens);

    if (tokens < 1) {
      // no token available
      await this.state.storage.put("bucket", { tokens, last: now });
      return new Response(JSON.stringify({ ok: false, limited: true }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }

    // consume 1 token
    await this.state.storage.put("bucket", { tokens: tokens - 1, last: now });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function getIp(req) {
  return (
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

export async function enforceRateLimit(req, env, projectId, origin, opts) {
  if (!env.RL) throw new Error("Missing Durable Object binding RL");

  const ip = getIp(req);
  const o = origin || "no-origin";
  const key = `${projectId}|${o}|${ip}`;

  const id = env.RL.idFromName(key);
  const stub = env.RL.get(id);

  const res = await stub.fetch("https://rl/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      capacity: opts?.capacity ?? 120,
      refillPerSec: opts?.refillPerSec ?? 2,
    }),
  });

  if (res.status === 429) {
    throw Object.assign(new Error("rate_limited"), { status: 429 });
  }
}