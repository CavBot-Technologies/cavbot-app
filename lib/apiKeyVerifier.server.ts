import { enforceRateLimit, type RateLimitEnv } from "@/rateLimit";
import { originAllowed, AllowedOriginRow } from "@/originMatch";
import type { ApiKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/apiKeys.server";

const RATE_LIMIT_SPEC = { capacity: 25, refillPerSec: 25 / 60 };

type VerifyOptions = {
  req: Request;
  env?: RateLimitEnv;
  key: string;
  requiredScope: string;
  projectId?: number;
  siteId?: string;
};

type Guardrails = {
  enforceAllowlist: boolean;
  blockUnknownOrigins: boolean;
};

function getRequestOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  const referer = req.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function respondError(status: number, error: string) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function verifyCavbotApiKey(options: VerifyOptions): Promise<{ key: ApiKey; siteOrigin: string | null }> {
  const keyHash = hashApiKey(options.key.trim());
  const record = await prisma.apiKey.findFirst({
    where: { keyHash },
    include: {
      site: {
        select: {
          id: true,
          origin: true,
          allowedOrigins: {
            select: { origin: true, matchType: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      project: {
        select: {
          id: true,
          guardrails: true,
        },
      },
    },
  });

  if (!record) throw respondError(401, "INVALID_KEY");
  if (record.status !== "ACTIVE") throw respondError(403, "KEY_INACTIVE");

  if (options.projectId && record.projectId !== options.projectId) {
    throw respondError(403, "KEY_PROJECT_MISMATCH");
  }

  if (options.siteId && record.siteId !== options.siteId) {
    throw respondError(403, "KEY_SITE_MISMATCH");
  }

  if (!record.scopes || !record.scopes.includes(options.requiredScope)) {
    throw respondError(403, "KEY_SCOPE_MISSING");
  }

  const guardrails: Guardrails = record.project?.guardrails ?? {
    enforceAllowlist: true,
    blockUnknownOrigins: true,
  };

  const originHeader = getRequestOrigin(options.req);
  const siteOrigins: AllowedOriginRow[] = [];

  if (record.site?.allowedOrigins?.length) {
    for (const row of record.site.allowedOrigins) {
      const matchType = row.matchType === "WILDCARD_SUBDOMAIN" ? "WILDCARD_SUBDOMAIN" : "EXACT";
      siteOrigins.push({ origin: row.origin, matchType });
    }
  }

  if (record.site?.origin && !siteOrigins.some((row) => row.origin === record.site?.origin)) {
    siteOrigins.unshift({ origin: record.site.origin, matchType: "EXACT" });
  }

  const originAllowedResult = originAllowed(originHeader, siteOrigins);
  if (guardrails.enforceAllowlist && !originAllowedResult) {
    throw respondError(403, "ORIGIN_NOT_ALLOWED");
  }

  if (guardrails.blockUnknownOrigins && !originAllowedResult) {
    throw respondError(403, "ORIGIN_BLOCKED");
  }

  await enforceRateLimit(options.req, options.env, String(record.projectId), originHeader, RATE_LIMIT_SPEC);

  void prisma.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return { key: record, siteOrigin: record.site?.origin ?? null };
}
