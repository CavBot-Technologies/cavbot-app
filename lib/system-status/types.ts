import type { ServiceKey, ServiceProbeConfig } from "@/lib/status/types";

export type SystemStatusKind = "live" | "at_risk" | "down" | "unknown";

export type SystemStatusService = {
  key: ServiceKey;
  label: string;
  status: SystemStatusKind;
  latencyMs: number | null;
  checkedAt: string | null;
  reason: string | null;
};

export type SystemStatusSummary = {
  allLive: boolean;
  liveCount: number;
  atRiskCount: number;
  downCount: number;
  unknownCount: number;
};

export type SystemStatusPayload = {
  checkedAt: string | null;
  services: SystemStatusService[];
  summary: SystemStatusSummary;
};

export type SystemStatusServiceDefinition = {
  key: ServiceKey;
  label: string;
  latencyThresholdMs: number | undefined;
  probes: ServiceProbeConfig[];
};

export type SystemStatusProbeResult = {
  ok: boolean;
  latencyMs: number;
  statusCode: number | null;
  error: string | null;
};
