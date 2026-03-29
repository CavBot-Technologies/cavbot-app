import type {
  CavAiContextV1,
  CavAiEvidenceRef,
  CavAiFindingV1,
  CavAiPillar,
  CavAiSeverity,
  CavAiTelemetrySummaryRefV1,
  NormalizedScanInputV1,
} from "./types";
import { CAVAI_NORMALIZED_INPUT_VERSION_V1 as INPUT_VERSION_V1 } from "./types";

const ALLOWED_INPUT_KEYS = new Set([
  "version",
  "origin",
  "pagesSelected",
  "pageLimit",
  "findings",
  "context",
]);
const ALLOWED_CONTEXT_KEYS = new Set([
  "routeMetadata",
  "environment",
  "telemetrySummaryRefs",
  "traits",
  "piiAllowed",
]);
const PILLARS = new Set<CavAiPillar>([
  "seo",
  "performance",
  "accessibility",
  "ux",
  "engagement",
  "reliability",
]);
const SEVERITIES = new Set<CavAiSeverity>([
  "critical",
  "high",
  "medium",
  "low",
  "note",
]);
const EVIDENCE_TYPES = new Set(["dom", "http", "metric", "route", "log", "config"]);

type ParseOk<T> = { ok: true; value: T };
type ParseErr = { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function trimString(value: unknown, maxLen: number) {
  const text = typeof value === "string" ? value : "";
  return text.trim().slice(0, maxLen);
}

function normalizePagePath(raw: unknown) {
  const value = trimString(raw, 800);
  if (!value) return "/";
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const url = new URL(value);
      const path = `${url.pathname || "/"}${url.search || ""}`;
      return path || "/";
    } catch {
      return "/";
    }
  }
  return value.startsWith("/") ? value : `/${value}`;
}

function normalizeOrigin(raw: unknown) {
  const value = trimString(raw, 600);
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function normalizeEvidence(raw: unknown): CavAiEvidenceRef | null {
  if (!isObject(raw)) return null;
  const type = trimString(raw.type, 24).toLowerCase();
  if (!EVIDENCE_TYPES.has(type)) return null;

  if (type === "dom") {
    const selector = trimString(raw.selector, 360);
    if (!selector) return null;
    return {
      type: "dom",
      selector,
      snippet: trimString(raw.snippet, 500) || undefined,
      attribute: trimString(raw.attribute, 80) || undefined,
    };
  }
  if (type === "http") {
    const url = trimString(raw.url, 1200);
    const status = Number(raw.status);
    if (!url || !Number.isFinite(status) || status < 100 || status > 599) return null;
    return {
      type: "http",
      url,
      status: Math.round(status),
      method: trimString(raw.method, 20).toUpperCase() || undefined,
    };
  }
  if (type === "metric") {
    const name = trimString(raw.name, 120);
    const value = Number(raw.value);
    if (!name || !Number.isFinite(value)) return null;
    return {
      type: "metric",
      name,
      value,
      unit: trimString(raw.unit, 32) || undefined,
    };
  }
  if (type === "route") {
    const path = normalizePagePath(raw.path);
    return {
      type: "route",
      path,
      statusCode:
        Number.isFinite(Number(raw.statusCode)) && Number(raw.statusCode) > 0
          ? Math.round(Number(raw.statusCode))
          : undefined,
      reason: trimString(raw.reason, 320) || undefined,
    };
  }

  if (type === "config") {
    const key = trimString(raw.key, 160);
    const stateRaw = trimString(raw.state, 24).toLowerCase();
    const state =
      stateRaw === "present" || stateRaw === "missing" || stateRaw === "invalid"
        ? stateRaw
        : "";
    if (!key || !state) return null;
    return {
      type: "config",
      key,
      state,
      source: trimString(raw.source, 80) || undefined,
      snippet: trimString(raw.snippet, 300) || undefined,
    };
  }

  const fingerprint = trimString(raw.fingerprint, 180);
  const levelRaw = trimString(raw.level, 24).toLowerCase();
  const level = levelRaw === "error" || levelRaw === "warn" ? levelRaw : "info";
  if (!fingerprint) return null;
  return {
    type: "log",
    level,
    fingerprint,
    message: trimString(raw.message, 500) || undefined,
  };
}

function parseFinding(raw: unknown, inputOrigin: string, index: number): CavAiFindingV1 | null {
  if (!isObject(raw)) return null;
  const id = trimString(raw.id, 96) || `finding_${index + 1}`;
  const code = trimString(raw.code, 120).toLowerCase();
  const pillar = trimString(raw.pillar, 40).toLowerCase() as CavAiPillar;
  const severity = trimString(raw.severity, 20).toLowerCase() as CavAiSeverity;
  const detectedAtRaw = trimString(raw.detectedAt, 120);
  const detectedAt = detectedAtRaw || new Date(0).toISOString();
  const parsedDetectedAt = Number.isFinite(Date.parse(detectedAt))
    ? new Date(detectedAt).toISOString()
    : new Date(0).toISOString();

  if (!code || !PILLARS.has(pillar) || !SEVERITIES.has(severity)) return null;

  const evidenceRaw = Array.isArray(raw.evidence) ? raw.evidence : [];
  const evidence = evidenceRaw
    .map((item) => normalizeEvidence(item))
    .filter((item): item is CavAiEvidenceRef => !!item)
    .slice(0, 20);
  if (!evidence.length) return null;

  const origin = normalizeOrigin(raw.origin) || inputOrigin;
  const pagePath = normalizePagePath(raw.pagePath);
  const templateHint = trimString(raw.templateHint, 160) || null;

  return {
    id,
    code,
    pillar,
    severity,
    evidence,
    origin,
    pagePath,
    templateHint,
    detectedAt: parsedDetectedAt,
  };
}

function parseTelemetryRefs(raw: unknown): CavAiTelemetrySummaryRefV1[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CavAiTelemetrySummaryRefV1[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!isObject(item)) continue;
    const kind = trimString(item.kind, 64).toLowerCase();
    if (
      kind !== "error_cluster" &&
      kind !== "api_cluster" &&
      kind !== "404_cluster" &&
      kind !== "metric_rollup"
    ) {
      continue;
    }
    const refId = trimString(item.refId, 120);
    const summary = trimString(item.summary, 300);
    if (!refId || !summary) continue;
    out.push({
      kind,
      refId,
      summary,
    });
  }
  return out.length ? out : undefined;
}

function parseContext(raw: unknown): CavAiContextV1 | undefined {
  if (!isObject(raw)) return undefined;
  const keys = Object.keys(raw);
  for (const key of keys) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) return undefined;
  }
  const context: CavAiContextV1 = {};
  if (isObject(raw.routeMetadata)) context.routeMetadata = raw.routeMetadata;
  if (isObject(raw.environment)) {
    context.environment = {
      sdkVersion: trimString(raw.environment.sdkVersion, 64) || undefined,
      appEnv: trimString(raw.environment.appEnv, 64) || undefined,
      runtime: trimString(raw.environment.runtime, 64) || undefined,
    };
  }
  const telemetrySummaryRefs = parseTelemetryRefs(raw.telemetrySummaryRefs);
  if (telemetrySummaryRefs) context.telemetrySummaryRefs = telemetrySummaryRefs;
  if (isObject(raw.traits)) {
    const traits: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(raw.traits)) {
      const k = trimString(key, 80);
      if (!k) continue;
      if (
        value == null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        traits[k] = value == null ? null : value;
      }
    }
    if (Object.keys(traits).length) context.traits = traits;
  }
  if (typeof raw.piiAllowed === "boolean") context.piiAllowed = raw.piiAllowed;
  return Object.keys(context).length ? context : undefined;
}

export function parseNormalizedScanInputV1(raw: unknown): ParseOk<NormalizedScanInputV1> | ParseErr {
  if (!isObject(raw)) return { ok: false, error: "INVALID_BODY" };
  const keys = Object.keys(raw);
  for (const key of keys) {
    if (!ALLOWED_INPUT_KEYS.has(key)) {
      return { ok: false, error: `UNKNOWN_FIELD:${key}` };
    }
  }

  const versionRaw = trimString(raw.version, 80);
  if (versionRaw && versionRaw !== INPUT_VERSION_V1) {
    return { ok: false, error: "INVALID_VERSION" };
  }

  const origin = normalizeOrigin(raw.origin);
  if (!origin) return { ok: false, error: "INVALID_ORIGIN" };

  const pagesSelectedRaw = Array.isArray(raw.pagesSelected) ? raw.pagesSelected : [];
  const pagesSelected = pagesSelectedRaw
    .map((entry) => normalizePagePath(entry))
    .filter(Boolean)
    .slice(0, 200);
  if (!pagesSelected.length) return { ok: false, error: "MISSING_PAGES_SELECTED" };

  const pageLimit = Math.max(1, Math.min(500, Number(raw.pageLimit)));
  if (!Number.isFinite(pageLimit)) return { ok: false, error: "INVALID_PAGE_LIMIT" };

  const findingsRaw = Array.isArray(raw.findings) ? raw.findings : [];
  const findings: CavAiFindingV1[] = [];
  for (let i = 0; i < findingsRaw.length; i++) {
    const finding = parseFinding(findingsRaw[i], origin, i);
    if (finding) findings.push(finding);
  }
  if (!findings.length) return { ok: false, error: "MISSING_FINDINGS" };

  const context = parseContext(raw.context);
  if (raw.context != null && !context) return { ok: false, error: "INVALID_CONTEXT" };

  return {
    ok: true,
    value: {
      version: INPUT_VERSION_V1,
      origin,
      pagesSelected,
      pageLimit,
      findings,
      context,
    },
  };
}
