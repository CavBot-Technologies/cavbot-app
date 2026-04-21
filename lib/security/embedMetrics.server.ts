import { prisma } from "@/lib/prisma";
import { formatDayKey } from "@/lib/status/time";
import { auditLogWrite } from "@/lib/audit";

export type EmbedUsagePayload = {
  verifiedToday: number | null;
  deniedToday: number | null;
  rateLimit: string | null;
  topDeniedOrigins: string[] | null;
};

export const DEFAULT_EMBED_RATE_LIMIT_LABEL = "120 requests / min per verified origin/site/key bucket";

const DENY_AUDIT_INTERVAL_MS = 60 * 60 * 1000;

type MetricParams = {
  accountId: string;
  projectId: number;
  siteId?: string | null;
  keyId: string;
  allowed: boolean;
};

export async function recordEmbedMetric(params: MetricParams) {
  if (!params.accountId) return;
  if (!params.siteId) return;
  const dayKey = formatDayKey(new Date());
  await prisma.embedVerificationMetric.upsert({
    where: {
      projectId_siteId_keyId_dayKey: {
        projectId: params.projectId,
        siteId: params.siteId,
        keyId: params.keyId,
        dayKey,
      },
    },
    create: {
      accountId: params.accountId,
      projectId: params.projectId,
      siteId: params.siteId,
      keyId: params.keyId,
      dayKey,
      verified: params.allowed ? 1 : 0,
      denied: params.allowed ? 0 : 1,
    },
    update: {
      verified: params.allowed ? { increment: 1 } : undefined,
      denied: params.allowed ? undefined : { increment: 1 },
    },
  });
}

type DeniedOriginParams = {
  accountId: string;
  projectId: number;
  siteId?: string | null;
  keyId: string;
  origin: string;
  request?: Request | null;
  denyCode?: string;
  rateLimited?: boolean;
};

async function upsertDeniedOrigin(params: Omit<DeniedOriginParams, "siteId"> & { siteId: string }, dayKey: string) {
  const lookup = {
    projectId_siteId_keyId_dayKey_origin: {
      projectId: params.projectId,
      siteId: params.siteId,
      keyId: params.keyId,
      dayKey,
      origin: params.origin,
    },
  };

  const existing = await prisma.embedDeniedOrigin.findUnique({
    where: lookup,
  });

  const now = new Date();
  if (existing) {
    await prisma.embedDeniedOrigin.update({
      where: lookup,
      data: {
        attempts: { increment: 1 },
        lastDeniedAt: now,
      },
    });
    return existing;
  }

  const created = await prisma.embedDeniedOrigin.create({
    data: {
      accountId: params.accountId,
      projectId: params.projectId,
      siteId: params.siteId,
      keyId: params.keyId,
      dayKey,
      origin: params.origin,
      attempts: 1,
      lastDeniedAt: now,
    },
  });
  return created;
}

export async function trackDeniedOrigin(params: DeniedOriginParams) {
  if (!params.accountId) return;
  if (!params.siteId) return;
  const dayKey = formatDayKey(new Date());
  const row = await upsertDeniedOrigin({ ...params, siteId: params.siteId }, dayKey);
  const lastAudit = row.auditLoggedAt ? row.auditLoggedAt.getTime() : 0;
  const interval = Date.now() - lastAudit;
  const shouldAudit = !row.auditLoggedAt || interval > DENY_AUDIT_INTERVAL_MS;

  if (shouldAudit) {
    await auditLogWrite({
      request: params.request ?? null,
      accountId: params.accountId,
      action: params.rateLimited ? "KEY_RATE_LIMITED" : "KEY_DENIED_ORIGIN",
      category: "keys",
      severity: "warning",
      targetType: "apiKey",
      targetId: params.keyId,
      targetLabel: `•••• ${params.keyId.slice(-4)}`,
      metaJson: {
        origin: params.origin,
        denyCode: params.denyCode,
        keyLast4: params.keyId.slice(-4),
      },
    });
    await prisma.embedDeniedOrigin.update({
      where: {
        projectId_siteId_keyId_dayKey_origin: {
          projectId: params.projectId,
          siteId: params.siteId,
          keyId: params.keyId,
          dayKey,
          origin: params.origin,
        },
      },
      data: { auditLoggedAt: new Date() },
    });
  }
}

export async function fetchEmbedUsage(options: {
  accountId: string;
  projectId: number;
  siteId?: string | null;
  rateLimitLabel?: string;
}): Promise<EmbedUsagePayload> {
  const dayKey = formatDayKey(new Date());
  const rows = await prisma.embedVerificationMetric.findMany({
    where: {
      accountId: options.accountId,
      projectId: options.projectId,
      dayKey,
      siteId: options.siteId ?? undefined,
    },
    select: {
      verified: true,
      denied: true,
    },
  });

  const verified = rows.reduce((sum, row) => sum + (row.verified ?? 0), 0);
  const denied = rows.reduce((sum, row) => sum + (row.denied ?? 0), 0);

  const topOrigins = await prisma.embedDeniedOrigin.findMany({
    where: {
      accountId: options.accountId,
      projectId: options.projectId,
      dayKey,
      siteId: options.siteId ?? undefined,
    },
    orderBy: { attempts: "desc" },
    take: 5,
  });

  return {
    verifiedToday: verified ? verified : null,
    deniedToday: denied ? denied : null,
    rateLimit: options.rateLimitLabel ?? DEFAULT_EMBED_RATE_LIMIT_LABEL,
    topDeniedOrigins: topOrigins.length ? topOrigins.map((row) => row.origin) : null,
  };
}
