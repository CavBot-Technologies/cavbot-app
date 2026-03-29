export type ServiceStatusState = "HEALTHY" | "AT_RISK" | "INCIDENT" | "UNKNOWN";

export type IncidentStatus = "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";
export type IncidentImpact = "MINOR" | "MAJOR" | "CRITICAL";

export type ServiceKey =
  | "cavai_analytics"
  | "cavai"
  | "cavtools"
  | "cavcode"
  | "cavcode_viewer"
  | "cavcloud"
  | "arcade_cdn";

export type ServiceProbeConfig = {
  name: string;
  url: string;
  method?: "GET" | "HEAD" | "POST";
  origin?: "app" | "cdn" | string;
  expectedStatus?: number[];
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};

export type ServiceDefinition = {
  serviceKey: ServiceKey;
  displayName: string;
  description: string;
  region?: string;
  latencyThresholdMs?: number;
  probes: ServiceProbeConfig[];
};

export type ProbeResult = {
  name: string;
  ok: boolean;
  latencyMs: number;
  statusCode?: number;
  url: string;
  errorMessage?: string | null;
};

export type ServiceStatusRow = {
  serviceKey: ServiceKey;
  displayName: string;
  status: ServiceStatusState;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  region: string;
  errorMessage: string | null;
  consecutiveFailures: number;
  metaJson?: unknown;
};

export type IncidentSummary = {
  id: string;
  title: string;
  status: IncidentStatus;
  startedAt: string;
  resolvedAt: string | null;
  impact: IncidentImpact;
  body: string | null;
  affectedServices: ServiceKey[];
};

export type ServiceStatusPayload = {
  services: ServiceStatusRow[];
  lastIncident: IncidentSummary | null;
  incidents: IncidentSummary[];
  updatedAt: string | null;
  regionDefault: string;
  uptimeSeries: null;
};

export type ServiceHistoryEntry = {
  ts: number;
  status: ServiceStatusState;
};

export type ServiceHistoryLane = {
  serviceKey: ServiceKey;
  displayName: string;
  timeline: ServiceHistoryEntry[];
};

export type StatusHistoryPayload = {
  services: ServiceHistoryLane[];
  days: number;
  updatedAt: string | null;
  regionDefault: string;
};

export type StatusTimelineSample = {
  dayKey: string;
  ts: number;
  status: ServiceStatusState;
  message: string;
  incidentId: string | null;
  component: string | null;
  durationMs: number | null;
};

export type StatusTimelineService = {
  serviceKey: ServiceKey;
  displayName: string;
  timeline: StatusTimelineSample[];
  uptimePct: number;
};

export type StatusTimelinePayload = {
  ok: boolean;
  global: {
    uptimePct: number;
    samplesLogged: number;
  };
  services: StatusTimelineService[];
  days: number;
  updatedAt: string | null;
};

export type StatusHistorySummaryCounts = {
  INVESTIGATING: number;
  MONITORING: number;
  RESOLVED: number;
};

export type StatusHistorySummaryState = "NO_INCIDENTS" | "INCIDENTS_REPORTED";

export type StatusHistoryMonthMetrics = {
  sampleCount: number;
  healthySamples: number;
  atRiskSamples: number;
  incidentSamples: number;
  unknownSamples: number;
  uptimePct: number;
  activeDays: number;
  windowDays: number;
  firstSampleAt: string | null;
  lastSampleAt: string | null;
};

export type StatusHistoryMonthIncident = {
  id: string;
  title: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  startedAt: string;
  resolvedAt: string | null;
  affectedServices: ServiceKey[];
  updatesCount: number;
};

export type StatusHistoryMonthPayload = {
  monthKey: string;
  prevMonthKey: string | null;
  nextMonthKey: string | null;
  summary: {
    state: StatusHistorySummaryState;
    counts: StatusHistorySummaryCounts;
  };
  incidents: StatusHistoryMonthIncident[];
  metrics?: StatusHistoryMonthMetrics;
};

export type IncidentDetailUpdate = {
  ts: number;
  status: IncidentStatus;
  message: string;
  affectedServices: ServiceKey[];
  metricsSnapshot?: { component?: string | null; durationMs?: number | null } | null;
};

export type IncidentDetailPayload = {
  incident: {
    id: string;
    title: string;
    status: IncidentStatus;
    impact: IncidentImpact;
    startedAt: string;
    resolvedAt: string | null;
    affectedServices: ServiceKey[];
  };
  updates: IncidentDetailUpdate[];
};
