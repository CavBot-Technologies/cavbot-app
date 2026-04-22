import { prisma } from "@/lib/prisma";
import { getAppOrigin } from "@/lib/apiAuth";
import type { IncidentImpact, IncidentStatus } from "@prisma/client";
import type { ServiceKey, ServiceProbeConfig, ServiceStatusState } from "./types";
import { SERVICE_DEFINITIONS, SERVICE_LIST, SERVICE_ORDER } from "./constants";
import { formatDayKey } from "./time";

const CDN_ORIGIN = process.env.CAVBOT_CDN_BASE_URL || "https://cdn.cavbot.io";
const DEFAULT_ARCADE_CDN_ORIGIN = "https://cdn.cavbot.io/arcade/";
const DEFAULT_CAVCLOUD_GATEWAY_ORIGIN = "https://cavcloud.cavbot.io";
const DEFAULT_SITE_ORIGIN_FALLBACK =
  process.env.NODE_ENV === "production" ? "https://app.cavbot.io" : "http://localhost:3000";

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/g, "");
}

function normalizeArcadeCdnOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    const normalizedPath = trimTrailingSlashes(parsed.pathname);
    if (!normalizedPath) {
      parsed.pathname = "/arcade/";
      return parsed.toString();
    }
    if (normalizedPath.endsWith("/arcade")) {
      parsed.pathname = `${normalizedPath}/`;
      return parsed.toString();
    }
    parsed.pathname = `${normalizedPath}/arcade/`;
    return parsed.toString();
  } catch {
    return DEFAULT_ARCADE_CDN_ORIGIN;
  }
}

function ensureArcadeRootTrailingSlash(url: string) {
  try {
    const parsed = new URL(url);
    if (/\/arcade$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname}/`;
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function normalizeOriginOnly(origin: string, fallback: string) {
  try {
    return new URL(origin).origin;
  } catch {
    return fallback;
  }
}

function getDefaultSiteOrigin() {
  try {
    return getAppOrigin();
  } catch {
    return DEFAULT_SITE_ORIGIN_FALLBACK;
  }
}

const ARCADE_CDN_ORIGIN = normalizeArcadeCdnOrigin(CDN_ORIGIN);
const CAVCLOUD_GATEWAY_ORIGIN = normalizeOriginOnly(
  process.env.CAVCLOUD_GATEWAY_ORIGIN || DEFAULT_CAVCLOUD_GATEWAY_ORIGIN,
  DEFAULT_CAVCLOUD_GATEWAY_ORIGIN
);
export const STATUS_POLL_INTERVAL_MS = Number(process.env.STATUS_CHECK_INTERVAL_MS) || 120_000;
const POLL_INTERVAL_MS = STATUS_POLL_INTERVAL_MS;
const STATUS_FRESHNESS_MAX_AGE_MS = Number(process.env.STATUS_FRESHNESS_MAX_AGE_MS) || 45_000;
const INCIDENT_WINDOW_MS = 10 * 60_000;
const STATUS_SCHEDULER_KEY = Symbol.for("cavbot.status.scheduler");
const STATUS_REFRESH_PROMISE_KEY = Symbol.for("cavbot.status.refreshPromise");
const DEV_STATUS_PROBES_ENABLED = process.env.CAVBOT_STATUS_ENABLE_DEV_PROBES === "1";
const SHOULD_SKIP_PROBES = process.env.NODE_ENV !== "production" && !DEV_STATUS_PROBES_ENABLED;

type StatusGlobalScope = typeof globalThis & {
  [STATUS_SCHEDULER_KEY]?: NodeJS.Timeout;
  [STATUS_REFRESH_PROMISE_KEY]?: Promise<void>;
};

const INCIDENT_IMPACT_BY_STATUS: Record<ServiceStatusState, IncidentImpact> = {
  HEALTHY: "MINOR",
  AT_RISK: "MAJOR",
  INCIDENT: "CRITICAL",
  UNKNOWN: "MINOR",
};

const RESOLUTION_MESSAGE =
  "All affected components have fully recovered. CavBot has verified system stability and closed the incident.";

async function recordIncidentUpdate(
  incidentId: string,
  status: IncidentStatus,
  message: string
) {
  const lastUpdate = await prisma.incidentUpdate.findFirst({
    where: { incidentId },
    orderBy: { createdAt: "desc" },
    select: { message: true, status: true },
  });

  if (lastUpdate && lastUpdate.status === status && lastUpdate.message === message) {
    return;
  }

  await prisma.incidentUpdate.create({
    data: {
      incidentId,
      status,
      message,
    },
  });
}

async function markIncidentResolved(serviceKey: ServiceKey) {
  const incidents = await prisma.incident.findMany({
    where: {
      resolvedAt: null,
      affectedServices: { has: serviceKey },
    },
    select: { id: true },
  });

  if (!incidents.length) {
    return;
  }

  const resolvedAt = new Date();
  for (const incident of incidents) {
    await prisma.incident.update({
      where: { id: incident.id },
      data: {
        status: "RESOLVED" as IncidentStatus,
        resolvedAt,
        body: RESOLUTION_MESSAGE,
      },
    });
    await recordIncidentUpdate(incident.id, "RESOLVED" as IncidentStatus, RESOLUTION_MESSAGE);
  }
}

async function upsertServiceIncident(
  serviceKey: ServiceKey,
  definitionName: string,
  status: ServiceStatusState,
  latencyMs: number,
  errorMessage: string | null
): Promise<string | null> {
  if (status !== "INCIDENT") {
    return null;
  }

  const existing = await prisma.incident.findFirst({
    where: {
      resolvedAt: null,
      affectedServices: { has: serviceKey },
    },
  });

  const body =
    errorMessage ||
    `Probe failures detected after ${latencyMs} ms average latency for ${definitionName}.`;

  const affectedServicesPayload = [
    {
      serviceKey,
      label: definitionName,
    },
  ];

  const payload = {
    title: `${definitionName} outage detected`,
    status: "INVESTIGATING" as IncidentStatus,
    impact: INCIDENT_IMPACT_BY_STATUS[status],
    body,
    affectedServices: [serviceKey],
    affectedServicesJson: affectedServicesPayload,
    startedAt: new Date(),
  };

  if (existing) {
    await prisma.incident.update({
      where: { id: existing.id },
      data: {
        body,
        status: "INVESTIGATING" as IncidentStatus,
        impact: INCIDENT_IMPACT_BY_STATUS[status],
        resolvedAt: null,
        affectedServicesJson: affectedServicesPayload,
      },
    });
    await recordIncidentUpdate(existing.id, "INVESTIGATING" as IncidentStatus, body);
    return existing.id;
  }

  const created = await prisma.incident.create({
    data: payload,
  });
  await recordIncidentUpdate(created.id, "INVESTIGATING" as IncidentStatus, body);
  return created.id;
}

type ProbeOutcome = {
  name: string;
  ok: boolean;
  latencyMs: number;
  statusCode?: number;
  url: string;
  errorMessage?: string | null;
};

function resolveProbeUrl(config: ServiceProbeConfig) {
  const origin =
    config.origin === "arcade_cdn"
      ? ARCADE_CDN_ORIGIN
      : config.origin === "cavcloud_gateway"
      ? CAVCLOUD_GATEWAY_ORIGIN
      : config.origin === "cdn"
      ? CDN_ORIGIN
      : typeof config.origin === "string"
      ? config.origin
      : getDefaultSiteOrigin();
  const resolved = /^https?:\/\//i.test(config.url)
    ? config.url
    : new URL(config.url, origin).toString();

  return config.origin === "arcade_cdn" ? ensureArcadeRootTrailingSlash(resolved) : resolved;
}

function sanitizeErrorMessage(error: unknown) {
  if (!error) return "Fetch failed";
  if (typeof error === "string") return error.slice(0, 280);
  if (error instanceof Error) {
    return error.message.slice(0, 280);
  }
  return "Unknown handler error";
}

async function runProbe(config: ServiceProbeConfig): Promise<ProbeOutcome> {
  const url = resolveProbeUrl(config);
  const method = config.method ?? "GET";
  const body = config.body ? JSON.stringify(config.body) : undefined;
  const headers: Record<string, string> = {
    Accept: "text/plain, */*",
    ...(config.headers ?? {}),
  };
  headers["x-cavbot-status-probe"] = headers["x-cavbot-status-probe"] ?? "1";
  if (body) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }

  const timeoutMs = config.timeoutMs ?? 10_000;
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    const accepted =
      (config.expectedStatus && config.expectedStatus.length > 0
        ? config.expectedStatus.includes(response.status)
        : response.ok);
    return {
      name: config.name,
      ok: accepted,
      latencyMs,
      statusCode: response.status,
      url,
      errorMessage: accepted ? null : `Unexpected status ${response.status}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    return {
      name: config.name,
      ok: false,
      latencyMs,
      url,
      errorMessage: sanitizeErrorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function averageLatency(results: ProbeOutcome[]) {
  if (!results.length) return 0;
  const sum = results.reduce((acc, result) => acc + result.latencyMs, 0);
  return Math.round(sum / results.length);
}

function determineStatus(
  definitionLatencyThreshold: number | undefined,
  results: ProbeOutcome[],
  prev: { consecutiveFailures: number; lastSuccessAt: Date | null } | null
) {
  const success = results.every((item) => item.ok);
  const latency = averageLatency(results);
  const highLatency = definitionLatencyThreshold ? latency > definitionLatencyThreshold : false;
  if (success) {
    return {
      status: (highLatency ? "AT_RISK" : "HEALTHY") as ServiceStatusState,
      consecutiveFailures: 0,
      highLatency,
    };
  }
  const prevFailures = prev?.consecutiveFailures ?? 0;
  const sinceSuccess =
    prev?.lastSuccessAt ? Date.now() - prev.lastSuccessAt.getTime() : Number.POSITIVE_INFINITY;
  const consecutiveFailures = prevFailures + 1;
  if (consecutiveFailures >= 3 || sinceSuccess > INCIDENT_WINDOW_MS) {
    return { status: "INCIDENT" as ServiceStatusState, consecutiveFailures, highLatency };
  }
  return { status: "AT_RISK" as ServiceStatusState, consecutiveFailures, highLatency };
}

function sanitizeMeta(results: ProbeOutcome[]) {
  return results.map((result) => ({
    name: result.name,
    ok: result.ok,
    latencyMs: result.latencyMs,
    statusCode: result.statusCode ?? null,
    url: result.url,
    errorMessage: result.errorMessage ?? null,
  }));
}

export async function checkService(serviceKey: ServiceKey) {
  const definition = SERVICE_DEFINITIONS[serviceKey];
  if (!definition) {
    throw new Error(`Unknown service key "${serviceKey}"`);
  }

  const prev = await prisma.serviceStatus.findUnique({
    where: { serviceKey },
    select: {
      consecutiveFailures: true,
      lastSuccessAt: true,
    },
  });

  const results = await Promise.all(definition.probes.map((probe) => runProbe(probe)));
  const meta = sanitizeMeta(results);
  const latencyMs = averageLatency(results);
  const { status, consecutiveFailures, highLatency } = determineStatus(
    definition.latencyThresholdMs,
    results,
    {
      consecutiveFailures: prev?.consecutiveFailures ?? 0,
      lastSuccessAt: prev?.lastSuccessAt ?? null,
    }
  );

  const now = new Date();
  const lastSuccessAt = status === "HEALTHY" ? now : prev?.lastSuccessAt ?? null;
  let computedError: string | null = null;
  if (!results.every((item) => item.ok)) {
    computedError = results.find((item) => !item.ok)?.errorMessage ?? "Probe failure";
  } else if (highLatency) {
    computedError = "Latency above threshold";
  }

  const record = await prisma.serviceStatus.upsert({
    where: { serviceKey },
    update: {
      displayName: definition.displayName,
      status,
      lastCheckedAt: now,
      lastSuccessAt,
      lastLatencyMs: latencyMs,
      errorMessage: computedError,
      consecutiveFailures,
      region: definition.region ?? "global",
      metaJson: { probes: meta },
    },
    create: {
      serviceKey,
      displayName: definition.displayName,
      status,
      lastCheckedAt: now,
      lastSuccessAt,
      lastLatencyMs: latencyMs,
      errorMessage: computedError,
      consecutiveFailures,
      region: definition.region ?? "global",
      metaJson: { probes: meta },
    },
  });

  await prisma.serviceStatusHistory.create({
    data: {
      serviceStatusId: record.id,
      serviceKey,
      status,
      latencyMs,
      errorMessage: computedError,
      region: definition.region ?? "global",
      metaJson: { probes: meta },
      checkedAt: now,
    },
  });
  const statusService = await prisma.statusService.upsert({
    where: { slug: serviceKey },
    update: { label: definition.displayName },
    create: { slug: serviceKey, label: definition.displayName },
  });

  let incidentId: string | null = null;
  if (status === "HEALTHY") {
    await markIncidentResolved(serviceKey);
  } else if (status === "INCIDENT") {
    incidentId = await upsertServiceIncident(serviceKey, definition.displayName, status, latencyMs, computedError);
  }

  const sampleMessage =
    status === "HEALTHY"
      ? "No incidents"
      : status === "UNKNOWN"
      ? "No data"
      : computedError?.trim() || "Status update recorded";

  await prisma.statusSample.create({
    data: {
      serviceId: statusService.id,
      dayKey: formatDayKey(now),
      status,
      message: sampleMessage,
      incidentId,
      component: definition.displayName,
      durationMs: latencyMs,
      occurredAt: now,
    },
  });
}

export async function checkAllServices() {
  await Promise.all(
    SERVICE_LIST.map(async (service) => {
      try {
        await checkService(service.serviceKey);
      } catch (error) {
        console.error(`Status check failed for ${service.serviceKey}:`, error);
      }
    })
  );
}

async function runChecksWithLock() {
  const globalScope = globalThis as StatusGlobalScope;
  const running = globalScope[STATUS_REFRESH_PROMISE_KEY];
  if (running) {
    await running;
    return;
  }

  const runPromise = (async () => {
    await checkAllServices();
  })();

  globalScope[STATUS_REFRESH_PROMISE_KEY] = runPromise;

  try {
    await runPromise;
  } finally {
    if (globalScope[STATUS_REFRESH_PROMISE_KEY] === runPromise) {
      delete globalScope[STATUS_REFRESH_PROMISE_KEY];
    }
  }
}

async function isStatusSnapshotFresh(maxAgeMs: number) {
  const [count, latest] = await Promise.all([
    prisma.serviceStatus.count({
      where: { serviceKey: { in: SERVICE_ORDER } },
    }),
    prisma.serviceStatus.aggregate({
      where: { serviceKey: { in: SERVICE_ORDER } },
      _max: { lastCheckedAt: true },
    }),
  ]);

  const lastCheckedAt = latest._max.lastCheckedAt;
  if (!lastCheckedAt) return false;
  if (count < SERVICE_ORDER.length) return false;
  return Date.now() - lastCheckedAt.getTime() <= maxAgeMs;
}

export async function ensureStatusSnapshotFresh(options?: { maxAgeMs?: number }) {
  if (SHOULD_SKIP_PROBES) {
    return;
  }

  const maxAgeMs = Math.max(1_000, options?.maxAgeMs ?? STATUS_FRESHNESS_MAX_AGE_MS);
  startStatusScheduler();

  try {
    const fresh = await isStatusSnapshotFresh(maxAgeMs);
    if (fresh) return;
  } catch (error) {
    console.error("Status freshness check failed, forcing probe refresh.", error);
  }

  try {
    await runChecksWithLock();
  } catch (error) {
    console.error("Status refresh failed.", error);
  }
}

export function startStatusScheduler() {
  if (SHOULD_SKIP_PROBES) {
    return;
  }

  const globalScope = globalThis as StatusGlobalScope;
  if (globalScope[STATUS_SCHEDULER_KEY]) return;

  const run = async () => {
    try {
      await runChecksWithLock();
    } catch (error) {
      console.error("Status scheduler run failed:", error);
    }
  };

  void run();
  const handle = setInterval(run, POLL_INTERVAL_MS);
  handle.unref?.();
  globalScope[STATUS_SCHEDULER_KEY] = handle;
}
