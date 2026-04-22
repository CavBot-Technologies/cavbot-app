import "server-only";

import { prisma } from "@/lib/prisma";

type RollupBucket = "MINUTE_5" | "HOURLY" | "DAILY";

type RollupInput = {
  metric: string;
  bucket: RollupBucket;
  bucketStart: Date;
  scopeKey: string;
  value: number;
  status?: string | null;
  result?: string | null;
  planTier?: string | null;
  metaJson?: Record<string, unknown> | null;
};

function startOfUtcMinuteBucket(date: Date, minutes: number) {
  const copy = new Date(date.getTime());
  copy.setUTCSeconds(0, 0);
  const minute = copy.getUTCMinutes();
  copy.setUTCMinutes(minute - (minute % minutes));
  return copy;
}

function startOfUtcHour(date: Date) {
  const copy = new Date(date.getTime());
  copy.setUTCMinutes(0, 0, 0);
  return copy;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toJson(value?: Record<string, unknown> | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

async function upsertRollup(input: RollupInput) {
  await prisma.adminMetricRollup.upsert({
    where: {
      admin_metric_rollup_metric_bucket_scope: {
        metric: input.metric,
        bucket: input.bucket,
        bucketStart: input.bucketStart,
        scopeKey: input.scopeKey,
      },
    },
    update: {
      value: input.value,
      status: input.status || null,
      result: input.result || null,
      planTier: input.planTier || null,
      metaJson: toJson(input.metaJson),
    },
    create: {
      metric: input.metric,
      bucket: input.bucket,
      bucketStart: input.bucketStart,
      scopeKey: input.scopeKey,
      value: input.value,
      status: input.status || null,
      result: input.result || null,
      planTier: input.planTier || null,
      metaJson: toJson(input.metaJson),
    },
  });
}

function addCount(map: Map<string, number>, key: string, value = 1) {
  map.set(key, (map.get(key) || 0) + value);
}

function unpackKey(key: string) {
  const [metric, bucketStart, scopeKey, status, result, planTier] = key.split("||");
  return { metric, bucketStart: new Date(bucketStart), scopeKey, status, result, planTier };
}

async function syncAdminEventBuckets(hours = 48) {
  const start = new Date(Date.now() - hours * 60 * 60 * 1000);
  const events = await prisma.adminEvent.findMany({
    where: { createdAt: { gte: start } },
    select: {
      name: true,
      createdAt: true,
      status: true,
      result: true,
      planTier: true,
    },
  });

  const minute5 = new Map<string, number>();
  const hourly = new Map<string, number>();

  for (const event of events) {
    const minute5Bucket = startOfUtcMinuteBucket(event.createdAt, 5).toISOString();
    const hourBucket = startOfUtcHour(event.createdAt).toISOString();
    const minute5Key = [event.name, minute5Bucket, "global", event.status || "", event.result || "", event.planTier || ""].join("||");
    const hourKey = [event.name, hourBucket, "global", event.status || "", event.result || "", event.planTier || ""].join("||");
    addCount(minute5, minute5Key);
    addCount(hourly, hourKey);
  }

  for (const [key, value] of minute5.entries()) {
    const row = unpackKey(key);
    await upsertRollup({
      metric: row.metric,
      bucket: "MINUTE_5",
      bucketStart: row.bucketStart,
      scopeKey: row.scopeKey,
      value,
      status: row.status || null,
      result: row.result || null,
      planTier: row.planTier || null,
    });
  }

  for (const [key, value] of hourly.entries()) {
    const row = unpackKey(key);
    await upsertRollup({
      metric: row.metric,
      bucket: "HOURLY",
      bucketStart: row.bucketStart,
      scopeKey: row.scopeKey,
      value,
      status: row.status || null,
      result: row.result || null,
      planTier: row.planTier || null,
    });
  }

  return { minute5: minute5.size, hourly: hourly.size };
}

async function syncDailySourceMetrics(days = 90) {
  const start = startOfUtcDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  const [users, trialAccounts, subscriptions, projects, sites, scanJobs, workspaceNotices, incidents, adminEvents] = await Promise.all([
    prisma.user.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true },
    }),
    prisma.account.findMany({
      where: { trialStartedAt: { gte: start } },
      select: { trialStartedAt: true },
    }),
    prisma.subscription.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true, status: true, tier: true, billingCycle: true },
    }),
    prisma.project.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true },
    }),
    prisma.site.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true },
    }),
    prisma.scanJob.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true, status: true },
    }),
    prisma.workspaceNotice.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true, tone: true },
    }),
    prisma.incident.findMany({
      where: {
        OR: [
          { startedAt: { gte: start } },
          { resolvedAt: { gte: start } },
        ],
      },
      select: { startedAt: true, resolvedAt: true, impact: true },
    }),
    prisma.adminEvent.findMany({
      where: { createdAt: { gte: start } },
      select: { createdAt: true, name: true, status: true, result: true, planTier: true },
    }),
  ]);

  const daily = new Map<string, number>();

  const push = (metric: string, date: Date | null | undefined, extra?: { status?: string | null; result?: string | null; planTier?: string | null }) => {
    if (!date) return;
    const bucket = startOfUtcDay(date).toISOString();
    const key = [metric, bucket, "global", extra?.status || "", extra?.result || "", extra?.planTier || ""].join("||");
    addCount(daily, key);
  };

  for (const row of users) push("user_signed_up", row.createdAt);
  for (const row of trialAccounts) push("trial_started", row.trialStartedAt);
  for (const row of subscriptions) push("subscription_started", row.createdAt, { status: row.status, planTier: row.tier });
  for (const row of projects) push("project_created", row.createdAt);
  for (const row of sites) push("site_added", row.createdAt);
  for (const row of scanJobs) push("scan_job_created", row.createdAt, { status: row.status });
  for (const row of workspaceNotices) push("cavbot_alert_created", row.createdAt, { status: row.tone });
  for (const row of incidents) {
    push("incident_started", row.startedAt, { status: row.impact });
    push("cavbot_alert_resolved", row.resolvedAt, { status: row.impact });
  }
  for (const row of adminEvents) push(row.name, row.createdAt, { status: row.status, result: row.result, planTier: row.planTier });

  const snapshotDay = startOfUtcDay(new Date());
  const planDistribution = await prisma.account.groupBy({
    by: ["tier"],
    _count: { _all: true },
  });
  for (const row of planDistribution) {
    await upsertRollup({
      metric: "plan_distribution_snapshot",
      bucket: "DAILY",
      bucketStart: snapshotDay,
      scopeKey: `tier:${row.tier}`,
      value: row._count._all,
      planTier: row.tier,
    });
  }

  for (const [key, value] of daily.entries()) {
    const row = unpackKey(key);
    await upsertRollup({
      metric: row.metric,
      bucket: "DAILY",
      bucketStart: row.bucketStart,
      scopeKey: row.scopeKey,
      value,
      status: row.status || null,
      result: row.result || null,
      planTier: row.planTier || null,
    });
  }

  return { daily: daily.size + planDistribution.length };
}

export async function syncAdminRollups() {
  const [eventBuckets, daily] = await Promise.all([
    syncAdminEventBuckets(),
    syncDailySourceMetrics(),
  ]);

  return {
    minute5: eventBuckets.minute5,
    hourly: eventBuckets.hourly,
    daily: daily.daily,
  };
}
