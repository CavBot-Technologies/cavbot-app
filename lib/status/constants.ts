import type { ServiceDefinition, ServiceKey } from "./types";

const SERVICE_KEY_ORDER: ServiceKey[] = [
  "cavai_analytics",
  "cavai",
  "cavtools",
  "cavcode",
  "cavcode_viewer",
  "cavcloud",
  "arcade_cdn",
];

const DEFAULT_PROBE_TIMEOUT_MS = 12_000;
const ARCADE_CDN_REACHABLE_STATUS_CODES = [200, 204, 401, 403];
const CAVCLOUD_GATEWAY_REACHABLE_STATUS_CODES = [200, 403, 404];

const APP_PROBES = {
  cavaiAnalyticsDiag: {
    name: "Diagnostics ingestion",
    url: "/api/cavai/diagnostics",
    method: "POST" as const,
    expectedStatus: [200, 401],
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    body: { files: [], workspaceFiles: [] },
    headers: { "Content-Type": "application/json" },
  },
  cavaiAnalyticsAsset: {
    name: "Analytics SDK asset",
    url: "/sdk/v5/cavai-analytics-v5.min.js",
    origin: "cdn",
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    expectedStatus: [200],
  },
  brainAsset: {
    name: "Brain SDK asset",
    url: "/sdk/cavai/v1/cavai.min.js",
    origin: "cdn",
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    expectedStatus: [200],
  },
  cavToolsRoute: {
    name: "CavTools route",
    url: "/cavtools",
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    expectedStatus: [200],
  },
  cavCodeRoute: {
    name: "CavCode editor",
    url: "/cavcode",
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    expectedStatus: [200],
  },
  cavCodeViewerRoute: {
    name: "CavCode Viewer",
    url: "/cavcode-viewer",
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    expectedStatus: [200],
  },
  cavCloudGateway: {
    name: "CavCloud CDN gateway",
    url: "/cavcloud/u/status-probe",
    origin: "cavcloud_gateway",
    method: "HEAD" as const,
    timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
    expectedStatus: CAVCLOUD_GATEWAY_REACHABLE_STATUS_CODES,
  },
};

export const SERVICE_DEFINITIONS: Record<ServiceKey, ServiceDefinition> = {
  cavai_analytics: {
    serviceKey: "cavai_analytics",
    displayName: "CavAi Analytics",
    description: "Analytics ingest endpoint + worker health.",
    latencyThresholdMs: 1_200,
    probes: [APP_PROBES.cavaiAnalyticsDiag, APP_PROBES.cavaiAnalyticsAsset],
  },
  cavai: {
    serviceKey: "cavai",
    displayName: "CavAi",
    description: "Brain runtime and diagnostics tooling.",
    latencyThresholdMs: 1_200,
    probes: [APP_PROBES.brainAsset],
  },
  cavtools: {
    serviceKey: "cavtools",
    displayName: "CavTools",
    description: "CavTools route reachability and server responsiveness.",
    latencyThresholdMs: 1_200,
    probes: [APP_PROBES.cavToolsRoute],
  },
  cavcode: {
    serviceKey: "cavcode",
    displayName: "CavCode",
    description: "Monaco editor shell availability.",
    latencyThresholdMs: 1_200,
    probes: [APP_PROBES.cavCodeRoute],
  },
  cavcode_viewer: {
    serviceKey: "cavcode_viewer",
    displayName: "CavCode Viewer",
    description: "Live preview viewer route.",
    latencyThresholdMs: 1_200,
    probes: [APP_PROBES.cavCodeViewerRoute],
  },
  cavcloud: {
    serviceKey: "cavcloud",
    displayName: "CavCloud",
    description: "CavCloud CDN gateway worker reachability.",
    latencyThresholdMs: 1_200,
    probes: [APP_PROBES.cavCloudGateway],
  },
  arcade_cdn: {
    serviceKey: "arcade_cdn",
    displayName: "Arcade CDN",
    description: "Arcade worker route reachability.",
    latencyThresholdMs: 1_500,
    probes: [
      {
        name: "Arcade CDN route",
        // Keep this as "." so URL resolution preserves the normalized /arcade/ root.
        url: ".",
        origin: "arcade_cdn",
        expectedStatus: ARCADE_CDN_REACHABLE_STATUS_CODES,
        timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
      },
    ],
  },
};

export const SERVICE_ORDER = SERVICE_KEY_ORDER;

export const SERVICE_LIST = SERVICE_ORDER.map((key) => SERVICE_DEFINITIONS[key]);
