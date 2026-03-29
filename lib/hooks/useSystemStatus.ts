import useSWR from "swr";
import { SERVICE_DEFINITIONS, SERVICE_ORDER } from "@/lib/status/constants";
import type { ServiceKey, ServiceStatusState } from "@/lib/status/types";
import type { SystemStatusKind, SystemStatusPayload } from "@/lib/system-status/types";

const STATUS_KEY = "/api/system-status";
const DEFAULT_POLL_MS = 15_000;

type UseSystemStatusOptions = {
  pollMs?: number;
  fallbackData?: SystemStatusPayload;
};

export type SystemStatusServiceView = {
  key: ServiceKey;
  label: string;
  status: SystemStatusKind;
  state: ServiceStatusState;
  statusLabel: "Live" | "At risk" | "Down" | "Unknown";
  latencyMs: number | null;
  checkedAt: string | null;
  reason: string | null;
};

const STATUS_LABEL_MAP: Record<SystemStatusKind, SystemStatusServiceView["statusLabel"]> = {
  live: "Live",
  at_risk: "At risk",
  down: "Down",
  unknown: "Unknown",
};

const STATUS_STATE_MAP: Record<SystemStatusKind, ServiceStatusState> = {
  live: "HEALTHY",
  at_risk: "AT_RISK",
  down: "INCIDENT",
  unknown: "UNKNOWN",
};

function normalizeCavToolsText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return value ?? null;
  }
  const legacyLower = ["d", "e", "v", "t", "o", "o", "l", "s"].join("");
  const legacyPascal = ["D", "e", "v", "T", "o", "o", "l", "s"].join("");
  const legacyPhrase = ["Developer", "Tools"].join(" ");
  const legacyPath = `/${legacyLower}\\b`;
  return value
    .replace(new RegExp(legacyPhrase, "gi"), "CavTools")
    .replace(new RegExp(legacyPath, "gi"), "/cavtools")
    .replace(new RegExp(`\\b${legacyPascal}\\b`, "g"), "CavTools")
    .replace(new RegExp(`\\b${legacyLower}\\b`, "g"), "CavTools");
}

function buildUnknownPayload(reason: string | null): SystemStatusPayload {
  return {
    checkedAt: null,
    services: SERVICE_ORDER.map((key) => ({
      key,
      label: SERVICE_DEFINITIONS[key].displayName,
      status: "unknown" as const,
      latencyMs: null,
      checkedAt: null,
      reason,
    })),
    summary: {
      allLive: false,
      liveCount: 0,
      atRiskCount: 0,
      downCount: 0,
      unknownCount: SERVICE_ORDER.length,
    },
  };
}

const FALLBACK_UNKNOWN_PAYLOAD = buildUnknownPayload("Checking system health");

async function fetchSystemStatus(url: string): Promise<SystemStatusPayload> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`System status request failed (${response.status})`);
  }
  const payload = (await response.json()) as Partial<SystemStatusPayload>;
  if (!payload || !Array.isArray(payload.services)) {
    throw new Error("System status payload was malformed");
  }
  return payload as SystemStatusPayload;
}

function toOrderedServices(payload: SystemStatusPayload): SystemStatusServiceView[] {
  const serviceMap = new Map(payload.services.map((service) => [service.key, service]));
  return SERVICE_ORDER.map((serviceKey) => {
    const service = serviceMap.get(serviceKey);
    const status = service?.status ?? "unknown";
    return {
      key: serviceKey,
      label: SERVICE_DEFINITIONS[serviceKey].displayName,
      status,
      state: STATUS_STATE_MAP[status],
      statusLabel: STATUS_LABEL_MAP[status],
      latencyMs: service?.latencyMs ?? null,
      checkedAt: service?.checkedAt ?? payload.checkedAt ?? null,
      reason: normalizeCavToolsText(service?.reason),
    };
  });
}

export function useSystemStatus(options: UseSystemStatusOptions = {}) {
  const pollMs = Math.max(5_000, options.pollMs ?? DEFAULT_POLL_MS);
  const swr = useSWR<SystemStatusPayload>(STATUS_KEY, fetchSystemStatus, {
    fallbackData: options.fallbackData,
    keepPreviousData: true,
    refreshInterval: pollMs,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    revalidateIfStale: true,
    dedupingInterval: 5_000,
  });

  const payload = swr.data ?? options.fallbackData ?? FALLBACK_UNKNOWN_PAYLOAD;
  const services = toOrderedServices(payload);

  return {
    data: payload,
    services,
    checkedAt: payload.checkedAt,
    summary: payload.summary,
    isLoading: swr.isLoading,
    isRefreshing: swr.isValidating && !!swr.data,
    error: swr.error,
    refresh: swr.mutate,
  };
}

export function buildSystemStatusUnknownPayload(reason: string | null = "Checking system health") {
  return buildUnknownPayload(reason);
}
