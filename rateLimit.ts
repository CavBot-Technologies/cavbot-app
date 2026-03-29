import type { RateLimitSpec } from "./rate-limiter.do";

type DurableObjectIdLike = {
  toString(): string;
};

type DurableObjectStubLike = {
  fetch(input: string, init?: RequestInit): Promise<Response>;
};

type DurableObjectNamespaceLike = {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
};

export type RateLimitEnv = {
  RL?: DurableObjectNamespaceLike;
};

type RateLimitResponse = {
  allowed?: boolean;
  ok?: boolean;
  remaining?: number;
};

function getIp(req: Request): string {
  // CF provides this header
  const ip = req.headers.get("CF-Connecting-IP") || req.headers.get("x-forwarded-for") || "";
  return ip.split(",")[0].trim() || "0.0.0.0";
}

function normalizeOrigin(origin: string | null): string {
  if (!origin) return "";
  try {
    const u = new URL(origin);
    return `${u.protocol}//${u.host}`; // strip path/query
  } catch {
    return "";
  }
}

export async function enforceRateLimit(
  req: Request,
  env: RateLimitEnv | undefined,
  projectId: string,
  origin: string | null,
  spec: RateLimitSpec,
  bucketSuffix?: string
) {
  if (!env?.RL) return; // if not bound, skip (dev safety)

  const ip = getIp(req);
  const o = normalizeOrigin(origin);
  const scope = bucketSuffix ?? o ?? "no-origin";
  const bucketKey = `rl:v1:${projectId}:${scope}:${ip}`;

  const id = env.RL.idFromName(bucketKey);
  const stub = env.RL.get(id);

  const r = await stub.fetch("https://rl/limit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: bucketKey, spec }),
  });

  const data = (await r.json().catch(() => null)) as RateLimitResponse | null;
  if (!data?.allowed) {
    throw new Response(
      JSON.stringify({ ok: false, error: "rate_limited" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "1",
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
