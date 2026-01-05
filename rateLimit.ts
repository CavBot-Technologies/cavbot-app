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
  env: any,
  projectId: string,
  origin: string | null,
  spec: { capacity: number; refillPerSec: number }
) {
  if (!env?.RL) return; // if not bound, skip (dev safety)

  const ip = getIp(req);
  const o = normalizeOrigin(origin);
  const bucketKey = `rl:v1:${projectId}:${o || "no-origin"}:${ip}`;

  const id = env.RL.idFromName(bucketKey);
  const stub = env.RL.get(id);

  const r = await stub.fetch("https://rl/limit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: bucketKey, spec }),
  });

  const data = await r.json().catch(() => null) as any;
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
