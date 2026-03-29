import type {
  ServiceKey,
  ServiceProbeConfig,
  StatusHistoryMonthMetrics,
  ServiceStatusState,
  StatusTimelinePayload,
  StatusTimelineSample,
} from "@/lib/status/types";
import { SERVICE_DEFINITIONS, SERVICE_ORDER } from "@/lib/status/constants";
import {
  formatDayKeyFromDateInTimeZone,
  formatMonthKeyFromDateInTimeZone,
  getDaysInMonth,
  normalizeMonthKey,
  resolveHistoryTimeZone,
} from "@/lib/status/historyDate";
import { clampDays, formatDayKey, ONE_DAY_MS, startOfDayUtc } from "@/lib/status/time";
import { getAppOrigin } from "@/lib/apiAuth";
import type {
  SystemStatusKind,
  SystemStatusPayload,
  SystemStatusProbeResult,
  SystemStatusServiceDefinition,
} from "./types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type PipelineState = {
  snapshot: SystemStatusPayload | null;
  expiresAtMs: number;
  refreshPromise: Promise<SystemStatusPayload> | null;
  historyByService: Map<ServiceKey, Map<string, ServiceHistoryDayBucket>>;
  samplesByService: Map<ServiceKey, ServiceHistorySample[]>;
};

type GetSnapshotOptions = {
  allowStale?: boolean;
  forceRefresh?: boolean;
};

type CreatePipelineOptions = {
  services?: SystemStatusServiceDefinition[];
  fetchImpl?: FetchLike;
  now?: () => number;
  cacheTtlMs?: number;
  probeTimeoutMs?: number;
};

type ServiceHistoryDayBucket = {
  status: SystemStatusKind;
  reason: string | null;
  latencyMs: number | null;
  liveSamples: number;
  totalSamples: number;
  lastOccurredAtMs: number;
};

type ServiceHistorySample = {
  occurredAtMs: number;
  status: SystemStatusKind;
};

type SystemStatusHistoryMonthMetricsPayload = {
  monthKey: string;
  prevMonthKey: string | null;
  nextMonthKey: string | null;
  metrics: StatusHistoryMonthMetrics;
};

const DEFAULT_SITE_ORIGIN = getAppOrigin();
const CDN_ORIGIN = process.env.CAVBOT_CDN_BASE_URL || "https://cdn.cavbot.io";
const DEFAULT_ARCADE_CDN_ORIGIN = "https://cdn.cavbot.io/arcade/";
const DEFAULT_CAVCLOUD_GATEWAY_ORIGIN = "https://cavcloud.cavbot.io";
const DEFAULT_CACHE_TTL_MS = Number(process.env.SYSTEM_STATUS_CACHE_TTL_MS) || 20_000;
const DEFAULT_PROBE_TIMEOUT_MS = Number(process.env.SYSTEM_STATUS_PROBE_TIMEOUT_MS) || 2_200;
const PIPELINE_CACHE_KEY = Symbol.for("cavbot.systemStatus.pipeline");

type PipelineGlobalScope = typeof globalThis & {
  [PIPELINE_CACHE_KEY]?: ReturnType<typeof createSystemStatusPipeline>;
};

type SharedPipeline = ReturnType<typeof createSystemStatusPipeline>;

const SYSTEM_STATUS_BRAND_SIGNATURE = SERVICE_ORDER.map(
  (key) => `${key}:${SERVICE_DEFINITIONS[key].displayName}`
).join("|");

function hasTimelineApi(pipeline: unknown): pipeline is SharedPipeline {
  if (!pipeline || typeof pipeline !== "object") return false;
  const candidate = pipeline as Partial<SharedPipeline>;
  return (
    typeof candidate.brandSignature === "string" &&
    typeof candidate.getSnapshot === "function" &&
    typeof candidate.getTimeline === "function" &&
    typeof candidate.getHistoryMonthMetrics === "function" &&
    typeof candidate.forceRefresh === "function" &&
    typeof candidate.peekSnapshot === "function" &&
    typeof candidate.reset === "function"
  );
}

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

const ARCADE_CDN_ORIGIN = normalizeArcadeCdnOrigin(CDN_ORIGIN);
const CAVCLOUD_GATEWAY_ORIGIN = normalizeOriginOnly(
  process.env.CAVCLOUD_GATEWAY_ORIGIN || DEFAULT_CAVCLOUD_GATEWAY_ORIGIN,
  DEFAULT_CAVCLOUD_GATEWAY_ORIGIN
);

const DEFAULT_SERVICE_DEFINITIONS: SystemStatusServiceDefinition[] = SERVICE_ORDER.map((key) => {
  const row = SERVICE_DEFINITIONS[key];
  return {
    key: row.serviceKey,
    label: row.displayName,
    latencyThresholdMs: row.latencyThresholdMs,
    probes: row.probes,
  };
});

const TIMELINE_HISTORY_DAYS = 90;

const STATUS_SEVERITY: Record<SystemStatusKind, number> = {
  down: 4,
  at_risk: 3,
  unknown: 2,
  live: 1,
};

const STATUS_TO_TIMELINE_STATE: Record<SystemStatusKind, ServiceStatusState> = {
  live: "HEALTHY",
  at_risk: "AT_RISK",
  down: "INCIDENT",
  unknown: "UNKNOWN",
};

function sanitizeErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Request timed out";
  }
  if (!error) return "Probe failed";
  if (typeof error === "string") return error.slice(0, 240);
  if (error instanceof Error) return error.message.slice(0, 240);
  return "Probe failed";
}

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
      : DEFAULT_SITE_ORIGIN;
  const resolved = /^https?:\/\//i.test(config.url)
    ? config.url
    : new URL(config.url, origin).toString();
  return config.origin === "arcade_cdn" ? ensureArcadeRootTrailingSlash(resolved) : resolved;
}

function summarizeLatency(results: SystemStatusProbeResult[]) {
  if (!results.length) return null;
  const total = results.reduce((sum, row) => sum + row.latencyMs, 0);
  return Math.max(0, Math.round(total / results.length));
}

function classifyStatus(
  results: SystemStatusProbeResult[],
  latencyThresholdMs?: number
): { status: SystemStatusKind; reason: string | null; latencyMs: number | null } {
  if (!results.length) {
    return { status: "unknown", reason: "No health endpoints configured", latencyMs: null };
  }

  const latencyMs = summarizeLatency(results);
  const okCount = results.filter((item) => item.ok).length;
  const failedCount = results.length - okCount;

  if (okCount === results.length) {
    if (typeof latencyMs === "number" && latencyThresholdMs && latencyMs > latencyThresholdMs) {
      return {
        status: "at_risk",
        reason: `Latency ${latencyMs} ms exceeds ${latencyThresholdMs} ms threshold`,
        latencyMs,
      };
    }
    return { status: "live", reason: null, latencyMs };
  }

  if (okCount > 0) {
    const firstFailure = results.find((item) => !item.ok);
    const reason = firstFailure?.error || `${failedCount} probe(s) failed`;
    return { status: "at_risk", reason, latencyMs };
  }

  const firstError = results.find((item) => item.error)?.error || "All probes failed";
  return { status: "down", reason: firstError, latencyMs };
}

async function runProbe(
  probe: ServiceProbeConfig,
  input: { fetchImpl: FetchLike; now: () => number; defaultTimeoutMs: number }
): Promise<SystemStatusProbeResult> {
  const url = resolveProbeUrl(probe);
  const method = probe.method ?? "GET";
  const body = probe.body == null ? undefined : JSON.stringify(probe.body);
  const timeoutMs = Math.max(500, Math.min(2_500, probe.timeoutMs ?? input.defaultTimeoutMs));
  const headers: Record<string, string> = {
    Accept: "text/plain, */*",
    ...(probe.headers ?? {}),
  };
  headers["x-cavbot-status-probe"] = headers["x-cavbot-status-probe"] ?? "1";
  if (body) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }

  const controller = new AbortController();
  const startedAt = input.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await input.fetchImpl(url, {
      method,
      headers,
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    const latencyMs = Math.max(0, input.now() - startedAt);
    const ok =
      probe.expectedStatus && probe.expectedStatus.length
        ? probe.expectedStatus.includes(response.status)
        : response.ok;
    return {
      ok,
      latencyMs,
      statusCode: response.status,
      error: ok ? null : `Unexpected status ${response.status}`,
    };
  } catch (error) {
    const latencyMs = Math.max(0, input.now() - startedAt);
    return {
      ok: false,
      latencyMs,
      statusCode: null,
      error: sanitizeErrorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildSummary(payload: SystemStatusPayload["services"]) {
  const liveCount = payload.filter((item) => item.status === "live").length;
  const atRiskCount = payload.filter((item) => item.status === "at_risk").length;
  const downCount = payload.filter((item) => item.status === "down").length;
  const unknownCount = payload.filter((item) => item.status === "unknown").length;
  const allLive =
    payload.length > 0 &&
    liveCount === payload.length &&
    atRiskCount === 0 &&
    downCount === 0 &&
    unknownCount === 0;
  return {
    allLive,
    liveCount,
    atRiskCount,
    downCount,
    unknownCount,
  };
}

function timelineMessage(status: SystemStatusKind, reason: string | null) {
  if (status === "live") return "No incidents";
  if (status === "at_risk") return reason?.trim() || "Elevated latency or probe failures";
  if (status === "down") return reason?.trim() || "Incident detected";
  return reason?.trim() || "No data";
}

function bucketIsMoreSevere(next: SystemStatusKind, prev: SystemStatusKind) {
  return (STATUS_SEVERITY[next] ?? 0) > (STATUS_SEVERITY[prev] ?? 0);
}

function pruneHistoryBuckets(history: Map<string, ServiceHistoryDayBucket>, cutoffDayKey: string) {
  for (const key of history.keys()) {
    if (key < cutoffDayKey) {
      history.delete(key);
    }
  }
}

export function createSystemStatusPipeline(options: CreatePipelineOptions = {}) {
  const services = options.services ?? DEFAULT_SERVICE_DEFINITIONS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const cacheTtlMs = Math.max(1_000, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  const defaultTimeoutMs = Math.max(500, Math.min(2_500, options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS));
  const state: PipelineState = {
    snapshot: null,
    expiresAtMs: 0,
    refreshPromise: null,
    historyByService: new Map(),
    samplesByService: new Map(),
  };

  const recordSnapshotHistory = (rows: SystemStatusPayload["services"], occurredAtMs: number) => {
    const dayKey = formatDayKey(new Date(occurredAtMs));
    const cutoffDayKey = formatDayKey(startOfDayUtc(occurredAtMs - TIMELINE_HISTORY_DAYS * ONE_DAY_MS));
    const cutoffMs = occurredAtMs - TIMELINE_HISTORY_DAYS * ONE_DAY_MS;

    for (const row of rows) {
      const serviceKey = row.key;
      let serviceHistory = state.historyByService.get(serviceKey);
      if (!serviceHistory) {
        serviceHistory = new Map();
        state.historyByService.set(serviceKey, serviceHistory);
      }
      let serviceSamples = state.samplesByService.get(serviceKey);
      if (!serviceSamples) {
        serviceSamples = [];
        state.samplesByService.set(serviceKey, serviceSamples);
      }

      const existing = serviceHistory.get(dayKey);
      if (existing) {
        existing.totalSamples += 1;
        if (row.status === "live") {
          existing.liveSamples += 1;
        }
        if (
          bucketIsMoreSevere(row.status, existing.status) ||
          STATUS_SEVERITY[row.status] === STATUS_SEVERITY[existing.status]
        ) {
          existing.status = row.status;
          existing.reason = row.reason;
          existing.latencyMs = row.latencyMs;
        }
        existing.lastOccurredAtMs = occurredAtMs;
      } else {
        serviceHistory.set(dayKey, {
          status: row.status,
          reason: row.reason,
          latencyMs: row.latencyMs,
          liveSamples: row.status === "live" ? 1 : 0,
          totalSamples: 1,
          lastOccurredAtMs: occurredAtMs,
        });
      }

      pruneHistoryBuckets(serviceHistory, cutoffDayKey);
      serviceSamples.push({
        occurredAtMs,
        status: row.status,
      });
      while (serviceSamples.length > 0 && serviceSamples[0]!.occurredAtMs < cutoffMs) {
        serviceSamples.shift();
      }
    }
  };

  const buildTimeline = (days = 30): StatusTimelinePayload => {
    const safeDays = clampDays(days);
    const nowMs = now();
    const windowStart = startOfDayUtc(nowMs - (safeDays - 1) * ONE_DAY_MS);
    const windowStartMs = windowStart.getTime();

    let globalLive = 0;
    let globalTotal = 0;
    let updatedAtMs = 0;

    const servicesTimeline = services.map((service) => {
      const dayMap = state.historyByService.get(service.key) ?? new Map<string, ServiceHistoryDayBucket>();
      let serviceLive = 0;
      let serviceTotal = 0;
      const timeline: StatusTimelineSample[] = [];
      const canonicalLabel = SERVICE_DEFINITIONS[service.key]?.displayName ?? service.label;

      for (let idx = 0; idx < safeDays; idx += 1) {
        const dayDate = new Date(windowStartMs + idx * ONE_DAY_MS);
        const dayKey = formatDayKey(dayDate);
        const bucket = dayMap.get(dayKey);
        const status = bucket?.status ?? "unknown";

        if (bucket) {
          serviceLive += bucket.liveSamples;
          serviceTotal += bucket.totalSamples;
          globalLive += bucket.liveSamples;
          globalTotal += bucket.totalSamples;
          updatedAtMs = Math.max(updatedAtMs, bucket.lastOccurredAtMs);
        }

        timeline.push({
          dayKey,
          ts: bucket?.lastOccurredAtMs ?? dayDate.getTime(),
          status: STATUS_TO_TIMELINE_STATE[status],
          message: timelineMessage(status, bucket?.reason ?? null),
          incidentId: null,
          component: canonicalLabel,
          durationMs: bucket?.latencyMs ?? null,
        });
      }

      const uptimePct = serviceTotal ? (serviceLive / serviceTotal) * 100 : 0;
      return {
        serviceKey: service.key,
        displayName: canonicalLabel,
        timeline,
        uptimePct: Number(uptimePct.toFixed(2)),
      };
    });

    const globalUptimePct = globalTotal ? (globalLive / globalTotal) * 100 : 0;

    return {
      ok: true,
      days: safeDays,
      global: {
        uptimePct: Number(globalUptimePct.toFixed(2)),
        samplesLogged: globalTotal,
      },
      services: servicesTimeline,
      updatedAt: updatedAtMs ? new Date(updatedAtMs).toISOString() : null,
    };
  };

  const buildHistoryMonthMetrics = (
    monthKey?: string,
    timeZoneInput?: string
  ): SystemStatusHistoryMonthMetricsPayload => {
    const timeZone = resolveHistoryTimeZone(timeZoneInput, "UTC");
    const currentMonthKey = formatMonthKeyFromDateInTimeZone(now(), timeZone);
    const normalizedMonthKey = normalizeMonthKey(monthKey, currentMonthKey);

    const monthKeys = new Set<string>([currentMonthKey, normalizedMonthKey]);
    for (const serviceSamples of state.samplesByService.values()) {
      for (const sample of serviceSamples) {
        monthKeys.add(formatMonthKeyFromDateInTimeZone(sample.occurredAtMs, timeZone));
      }
    }

    const sortedMonthKeys = Array.from(monthKeys).sort();
    const prevMonthKey = sortedMonthKeys.filter((key) => key < normalizedMonthKey).pop() ?? null;
    const nextMonthKey = sortedMonthKeys.find((key) => key > normalizedMonthKey) ?? null;

    let sampleCount = 0;
    let healthySamples = 0;
    let atRiskSamples = 0;
    let incidentSamples = 0;
    let unknownSamples = 0;
    let firstSampleAtMs = Number.POSITIVE_INFINITY;
    let lastSampleAtMs = 0;
    const activeDayKeys = new Set<string>();

    for (const serviceSamples of state.samplesByService.values()) {
      for (const sample of serviceSamples) {
        const sampleMonthKey = formatMonthKeyFromDateInTimeZone(sample.occurredAtMs, timeZone);
        if (sampleMonthKey !== normalizedMonthKey) continue;

        sampleCount += 1;
        if (sample.status === "live") {
          healthySamples += 1;
        } else if (sample.status === "at_risk") {
          atRiskSamples += 1;
        } else if (sample.status === "down") {
          incidentSamples += 1;
        } else {
          unknownSamples += 1;
        }

        activeDayKeys.add(formatDayKeyFromDateInTimeZone(sample.occurredAtMs, timeZone));
        firstSampleAtMs = Math.min(firstSampleAtMs, sample.occurredAtMs);
        lastSampleAtMs = Math.max(lastSampleAtMs, sample.occurredAtMs);
      }
    }

    const uptimePct = sampleCount > 0 ? (healthySamples / sampleCount) * 100 : 0;

    return {
      monthKey: normalizedMonthKey,
      prevMonthKey,
      nextMonthKey,
      metrics: {
        sampleCount,
        healthySamples,
        atRiskSamples,
        incidentSamples,
        unknownSamples,
        uptimePct: Number(uptimePct.toFixed(2)),
        activeDays: activeDayKeys.size,
        windowDays: getDaysInMonth(normalizedMonthKey),
        firstSampleAt: Number.isFinite(firstSampleAtMs) ? new Date(firstSampleAtMs).toISOString() : null,
        lastSampleAt: lastSampleAtMs > 0 ? new Date(lastSampleAtMs).toISOString() : null,
      },
    };
  };

  const computeSnapshot = async (): Promise<SystemStatusPayload> => {
    const checkedAtMs = now();
    const checkedAtIso = new Date(checkedAtMs).toISOString();

    const rows = await Promise.all(
      services.map(async (service) => {
        const canonicalLabel = SERVICE_DEFINITIONS[service.key]?.displayName ?? service.label;
        if (!service.probes.length) {
          return {
            key: service.key,
            label: canonicalLabel,
            status: "unknown" as const,
            latencyMs: null,
            checkedAt: checkedAtIso,
            reason: "No health endpoints configured",
          };
        }

        const settled = await Promise.allSettled(
          service.probes.map((probe) =>
            runProbe(probe, {
              fetchImpl,
              now,
              defaultTimeoutMs,
            })
          )
        );

        const probeResults = settled.map((result): SystemStatusProbeResult => {
          if (result.status === "fulfilled") {
            return result.value;
          }
          return {
            ok: false,
            latencyMs: 0,
            statusCode: null,
            error: sanitizeErrorMessage(result.reason),
          };
        });

        const computed = classifyStatus(probeResults, service.latencyThresholdMs);
        return {
          key: service.key,
          label: canonicalLabel,
          status: computed.status,
          latencyMs: computed.latencyMs,
          checkedAt: checkedAtIso,
          reason: computed.reason,
        };
      })
    );

    recordSnapshotHistory(rows, checkedAtMs);

    return {
      checkedAt: checkedAtIso,
      services: rows,
      summary: buildSummary(rows),
    };
  };

  const refresh = () => {
    if (state.refreshPromise) return state.refreshPromise;
    state.refreshPromise = (async () => {
      const next = await computeSnapshot();
      state.snapshot = next;
      state.expiresAtMs = now() + cacheTtlMs;
      return next;
    })();
    state.refreshPromise.finally(() => {
      state.refreshPromise = null;
    });
    return state.refreshPromise;
  };

  const getSnapshot = async (opts: GetSnapshotOptions = {}) => {
    const forceRefresh = opts.forceRefresh === true;
    const allowStale = opts.allowStale !== false;
    const nowMs = now();

    if (!forceRefresh && state.snapshot && state.expiresAtMs > nowMs) {
      return state.snapshot;
    }

    if (!forceRefresh && allowStale && state.snapshot) {
      void refresh();
      return state.snapshot;
    }

    return refresh();
  };

  return {
    brandSignature: SYSTEM_STATUS_BRAND_SIGNATURE,
    getSnapshot,
    getTimeline: async (days = 30) => {
      await getSnapshot({ allowStale: true });
      return buildTimeline(days);
    },
    getHistoryMonthMetrics: async (monthKey?: string, timeZone?: string) => {
      await getSnapshot({ allowStale: true });
      return buildHistoryMonthMetrics(monthKey, timeZone);
    },
    forceRefresh: () => refresh(),
    peekSnapshot: () => state.snapshot,
    reset: () => {
      state.snapshot = null;
      state.expiresAtMs = 0;
      state.refreshPromise = null;
      state.historyByService.clear();
      state.samplesByService.clear();
    },
  };
}

function getSharedPipeline() {
  const globalScope = globalThis as PipelineGlobalScope;
  const existing = globalScope[PIPELINE_CACHE_KEY];
  if (!hasTimelineApi(existing) || existing.brandSignature !== SYSTEM_STATUS_BRAND_SIGNATURE) {
    globalScope[PIPELINE_CACHE_KEY] = createSystemStatusPipeline();
  }
  const pipeline = globalScope[PIPELINE_CACHE_KEY];
  if (hasTimelineApi(pipeline)) return pipeline;
  const fallback = createSystemStatusPipeline();
  globalScope[PIPELINE_CACHE_KEY] = fallback;
  return fallback;
}

export async function getSystemStatusSnapshot(options?: GetSnapshotOptions) {
  return getSharedPipeline().getSnapshot(options);
}

export async function getSystemStatusTimeline(days = 30) {
  return getSharedPipeline().getTimeline(days);
}

export async function getSystemStatusHistoryMonthMetrics(monthKey?: string, timeZone?: string) {
  return getSharedPipeline().getHistoryMonthMetrics(monthKey, timeZone);
}

export function forceRefreshSystemStatusSnapshot() {
  return getSharedPipeline().forceRefresh();
}

export function resetSystemStatusPipelineForTests() {
  const globalScope = globalThis as PipelineGlobalScope;
  if (globalScope[PIPELINE_CACHE_KEY]) {
    globalScope[PIPELINE_CACHE_KEY]?.reset();
    delete globalScope[PIPELINE_CACHE_KEY];
  }
}
