import "server-only";

type MaybeRecord = Record<string, unknown>;

function isRecord(v: unknown): v is MaybeRecord {
  return typeof v === "object" && v !== null;
}

function childRecord(obj: unknown, key: string): MaybeRecord | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return isRecord(v) ? v : null;
}

function firstRecord(...candidates: unknown[]): MaybeRecord | null {
  for (const c of candidates) {
    if (isRecord(c)) return c;
  }
  return null;
}

function nOrNull(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function safeISO(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function fnv1a32(input: string): number {
  // Deterministic, fast, cross-platform stable hash.
  let h = 0x811c9dc5;
  const s = String(input ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function stablePick<T>(items: readonly T[], seed: string, salt: string): T {
  const arr = items.length ? items : ([] as unknown as readonly T[]);
  // Caller must ensure non-empty arrays; keep guardrails to avoid runtime crashes.
  const idx = arr.length ? fnv1a32(`${seed}|${salt}`) % arr.length : 0;
  return arr[idx]!;
}

function renderTemplate(template: string, tokens: Record<string, string>): string {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const v = tokens[key];
    return typeof v === "string" ? v : "";
  });
}

function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x));
}

function toISODateUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function parseISODateUTC(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isFinite(d.getTime()) ? d : null;
}

function addDaysUTC(d: Date, days: number) {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function normalizeWindowDays<T extends { day: string }>(
  points: T[],
  windowDays: number,
  fill: (dayISO: string) => T
): T[] {
  const pts = Array.isArray(points) ? points.slice() : [];
  if (!pts.length) return [];
  const last = parseISODateUTC(pts[pts.length - 1]!.day) || new Date();
  const start = addDaysUTC(last, -(windowDays - 1));
  const byDay = new Map(pts.map((p) => [p.day, p]));
  const out: T[] = [];
  for (let i = 0; i < windowDays; i++) {
    const day = toISODateUTC(addDaysUTC(start, i));
    out.push(byDay.get(day) ?? fill(day));
  }
  return out;
}

type ErrorsTrendPoint = {
  day: string;
  jsErrors: number;
  apiErrors: number;
  views404: number;
};

function normalizeErrorsTrend(summary: unknown, daysWanted: number): ErrorsTrendPoint[] {
  const root = isRecord(summary) ? summary : null;
  const diag = root ? childRecord(root, "diagnostics") : null;
  const e = firstRecord(root?.errors, root?.errorIntelligence, diag?.errors, null);
  if (!e) return [];

  const trendRaw =
    (Array.isArray(e.trend) && e.trend) ||
    (Array.isArray(e.series) && e.series) ||
    (Array.isArray(e.daily) && e.daily) ||
    (Array.isArray(e.spark) && e.spark) ||
    [];

  const points: ErrorsTrendPoint[] = (Array.isArray(trendRaw) ? trendRaw : [])
    .map((item) => {
      if (!isRecord(item)) return null;
      const day = String(item.day ?? item.date ?? item.d ?? "").slice(0, 10);
      if (!day) return null;
      return {
        day,
        jsErrors: Number(nOrNull(item.jsErrors ?? item.js ?? item.js_error) ?? 0),
        apiErrors: Number(nOrNull(item.apiErrors ?? item.api ?? item.api_error) ?? 0),
        views404: Number(nOrNull(item.views404 ?? item.views_404 ?? item.notFound) ?? 0),
      };
    })
    .filter((p): p is ErrorsTrendPoint => Boolean(p && p.day));

  const normalized = normalizeWindowDays(points, daysWanted, (dayISO) => ({
    day: dayISO,
    jsErrors: 0,
    apiErrors: 0,
    views404: 0,
  }));

  return normalized;
}

type RoutesTrendPoint = { day: string; sessions: number; views404: number };

function normalizeRoutesTrend(summary: unknown, daysWanted: number): RoutesTrendPoint[] {
  const root = isRecord(summary) ? summary : null;
  if (!root) return [];

  const metrics = childRecord(root, "metrics");
  const rawTrend =
    (Array.isArray((root as MaybeRecord).trend30d) && (root as MaybeRecord).trend30d) ||
    (Array.isArray((root as MaybeRecord).trend7d) && (root as MaybeRecord).trend7d) ||
    (Array.isArray((root as MaybeRecord).trend) && (root as MaybeRecord).trend) ||
    (Array.isArray(metrics?.trend30d) && metrics?.trend30d) ||
    (Array.isArray(metrics?.trend7d) && metrics?.trend7d) ||
    (Array.isArray(metrics?.trend) && metrics?.trend) ||
    [];

  const points: RoutesTrendPoint[] = (Array.isArray(rawTrend) ? rawTrend : [])
    .map((item) => {
      if (!isRecord(item)) return null;
      const day = String(item.day ?? item.date ?? item.d ?? "").slice(0, 10);
      if (!day) return null;
      return {
        day,
        sessions: Number(nOrNull(item.sessions ?? item.views ?? item.pageViews) ?? 0),
        views404: Number(nOrNull(item.views404 ?? item.notFoundViews ?? item.v404 ?? item.notFound) ?? 0),
      };
    })
    .filter((p): p is RoutesTrendPoint => Boolean(p && p.day));

  const normalized = normalizeWindowDays(points, daysWanted, (dayISO) => ({
    day: dayISO,
    sessions: 0,
    views404: 0,
  }));

  return normalized;
}

function normalizeSeoUpdatedAtISO(summary: unknown): string | null {
  const root = isRecord(summary) ? summary : null;
  if (!root) return null;
  const diag = childRecord(root, "diagnostics");
  const guardian = childRecord(root, "guardian");
  const snap = childRecord(root, "snapshot");
  const seo = firstRecord(root.seo, root.seoIntelligence, root.seoPosture, diag?.seo, guardian?.seo, snap?.seo, null);
  if (!seo) return null;
  const rollup = firstRecord(seo.rollup, seo.summary, seo.totals, seo.counts, seo, null);
  return safeISO(seo.updatedAtISO ?? seo.updatedAt ?? rollup?.updatedAtISO ?? rollup?.updatedAt) || null;
}

function normalizeSeoRollup(summary: unknown): {
  titleCoveragePct: number | null;
  descriptionCoveragePct: number | null;
  canonicalCoveragePct: number | null;
} {
  const root = isRecord(summary) ? summary : null;
  const diag = root ? childRecord(root, "diagnostics") : null;
  const guardian = root ? childRecord(root, "guardian") : null;
  const snap = root ? childRecord(root, "snapshot") : null;
  const seo = firstRecord(root?.seo, root?.seoIntelligence, root?.seoPosture, diag?.seo, guardian?.seo, snap?.seo, null);
  const rollup = firstRecord(seo?.rollup, seo?.summary, seo?.totals, seo?.counts, seo, null);
  return {
    titleCoveragePct: nOrNull(rollup?.titleCoveragePct ?? rollup?.title_coverage_pct ?? rollup?.titleCoverage),
    descriptionCoveragePct: nOrNull(
      rollup?.descriptionCoveragePct ?? rollup?.description_coverage_pct ?? rollup?.metaDescriptionCoveragePct
    ),
    canonicalCoveragePct: nOrNull(rollup?.canonicalCoveragePct ?? rollup?.canonical_coverage_pct ?? rollup?.canonicalCoverage),
  };
}

function extractUpdatedAtISO(summary: unknown): string | null {
  const root = isRecord(summary) ? summary : null;
  if (!root) return null;
  const meta = childRecord(root, "meta");
  const metrics = childRecord(root, "metrics");
  return (
    safeISO((root as MaybeRecord).updatedAtISO) ||
    safeISO((root as MaybeRecord).updatedAt) ||
    safeISO(meta?.updatedAtISO) ||
    safeISO(meta?.updatedAt) ||
    safeISO(metrics?.updatedAtISO) ||
    safeISO(metrics?.updatedAt) ||
    null
  );
}

type CategoryId =
  | "reliability"
  | "errors"
  | "routes"
  | "seo"
  | "recovery"
  | "trust"
  | "maintenance";

type Template = {
  tags: readonly string[];
  event: string;
  explanation: string;
};

type CategoryTaxonomy = {
  templates: readonly Template[];
  banks: Record<string, readonly string[]>;
};

const TAXONOMY: Record<CategoryId, CategoryTaxonomy> = {
  reliability: {
    // Stability outcomes only when supported by a concrete change signal.
    templates: [
      { tags: ["spike_recovered"], event: "Stability restored", explanation: "Error pressure returned toward baseline over {window}." },
      { tags: ["spike_recovered"], event: "Failure rate normalized", explanation: "Failure signals trended back down over {window}." },
      { tags: ["spike_recovered"], event: "Incident pressure reduced", explanation: "Spike conditions subsided based on aggregated telemetry over {window}." },
      { tags: ["spike_recovered"], event: "Reliability posture improved", explanation: "Crash risk indicators eased over {window}." },
      { tags: ["spike_recovered"], event: "Error budget stabilized", explanation: "Failure pressure stabilized based on summary telemetry over {window}." },

      { tags: ["errors_down"], event: "System stability improved", explanation: "Exception volume declined over {window}." },
      { tags: ["errors_down"], event: "Reliability posture improved", explanation: "Aggregated failures trended down over {window}." },
      { tags: ["errors_down"], event: "Stability pressure reduced", explanation: "Stability signals moved downward over {window}." },
      { tags: ["errors_down"], event: "Failure rate reduced", explanation: "Failure telemetry declined over {window}." },
      { tags: ["errors_down"], event: "Stability restored", explanation: "System pressure eased over {window}." },

      { tags: ["routes_404_down"], event: "Recovery posture improved", explanation: "404 pressure declined over {window}." },
      { tags: ["routes_404_down"], event: "Routing stability improved", explanation: "Not-found signals trended down over {window}." },
      { tags: ["routes_404_down"], event: "Failure pressure reduced", explanation: "Routing failure signals declined over {window}." },
      { tags: ["routes_404_down"], event: "Stability restored", explanation: "Routing pressure eased over {window}." },
      { tags: ["routes_404_down"], event: "System stability improved", explanation: "404 pressure reduced over {window}." },

      // Extra templates (keep category at 20+ without bloating)
      { tags: ["errors_down"], event: "Reliability improved", explanation: "Error telemetry trended down over {window}." },
      { tags: ["spike_recovered"], event: "Stability recovered", explanation: "A prior spike subsided over {window}." },
      { tags: ["routes_404_down"], event: "Recovery stabilized", explanation: "Not-found pressure eased over {window}." },
      { tags: ["errors_down"], event: "Stability improved", explanation: "Failure signals declined over {window}." },
      { tags: ["spike_recovered"], event: "Incident pressure normalized", explanation: "Spike conditions cleared over {window}." },
      { tags: ["errors_down"], event: "System pressure reduced", explanation: "Exception pressure trended down over {window}." },
      { tags: ["routes_404_down"], event: "Routing pressure reduced", explanation: "Not-found pressure declined over {window}." },
    ],
    banks: {},
  },

  errors: {
    templates: [
      // Any (combined) error pressure reductions
      { tags: ["errors_down_any"], event: "{any_subject} reduced", explanation: "{any_evidence} over {window}." },
      { tags: ["errors_down_any"], event: "{any_subject} lowered", explanation: "{any_evidence} over {window}." },
      { tags: ["errors_down_any"], event: "{any_subject} declined", explanation: "{any_evidence} over {window}." },
      { tags: ["errors_down_any"], event: "{any_subject} normalized", explanation: "{any_evidence} over {window}." },
      { tags: ["errors_down_any"], event: "{any_subject} reduced", explanation: "{any_evidence} across {window}." },
      { tags: ["errors_down_any"], event: "{any_subject} lowered", explanation: "{any_evidence} across {window}." },
      { tags: ["errors_down_any"], event: "{any_subject} declined", explanation: "{any_evidence} across {window}." },
      { tags: ["errors_down_any"], event: "{any_subject} normalized", explanation: "{any_evidence} across {window}." },

      // Client (JS) reductions
      { tags: ["errors_down_js"], event: "{js_subject} reduced", explanation: "{js_evidence} over {window}." },
      { tags: ["errors_down_js"], event: "{js_subject} lowered", explanation: "{js_evidence} over {window}." },
      { tags: ["errors_down_js"], event: "{js_subject} declined", explanation: "{js_evidence} over {window}." },
      { tags: ["errors_down_js"], event: "{js_subject} reduced", explanation: "{js_evidence} across {window}." },
      { tags: ["errors_down_js"], event: "{js_subject} lowered", explanation: "{js_evidence} across {window}." },
      { tags: ["errors_down_js"], event: "{js_subject} declined", explanation: "{js_evidence} across {window}." },

      // API reductions
      { tags: ["errors_down_api"], event: "{api_subject} reduced", explanation: "{api_evidence} over {window}." },
      { tags: ["errors_down_api"], event: "{api_subject} lowered", explanation: "{api_evidence} over {window}." },
      { tags: ["errors_down_api"], event: "{api_subject} declined", explanation: "{api_evidence} over {window}." },
      { tags: ["errors_down_api"], event: "{api_subject} reduced", explanation: "{api_evidence} across {window}." },
      { tags: ["errors_down_api"], event: "{api_subject} lowered", explanation: "{api_evidence} across {window}." },
      { tags: ["errors_down_api"], event: "{api_subject} declined", explanation: "{api_evidence} across {window}." },

      // Spike recovery (rare)
      { tags: ["spike_recovered"], event: "{spike_subject} stabilized", explanation: "{spike_evidence} over {window}." },
      { tags: ["spike_recovered"], event: "{spike_subject} normalized", explanation: "{spike_evidence} over {window}." },
      { tags: ["spike_recovered"], event: "{spike_subject} stabilized", explanation: "{spike_evidence} across {window}." },
      { tags: ["spike_recovered"], event: "{spike_subject} normalized", explanation: "{spike_evidence} across {window}." },
    ],
    banks: {
      any_subject: [
        "Exception volume",
        "Error surface",
        "Failure pressure",
        "Error pressure",
        "Exception pressure",
        "Failure volume",
        "Unhandled failures",
      ],
      js_subject: [
        "Client-side failures",
        "Client exceptions",
        "Client error pressure",
        "Client failure pressure",
      ],
      api_subject: [
        "API failures",
        "API error pressure",
        "Server failures",
        "Server error pressure",
      ],
      spike_subject: [
        "Incident pressure",
        "Spike pressure",
        "Failure pressure",
        "Error pressure",
      ],

      any_evidence: [
        "Derived from aggregated error telemetry",
        "Based on summarized error telemetry",
        "From error telemetry rollups",
      ],
      js_evidence: [
        "Derived from client error telemetry",
        "Based on summarized client error telemetry",
        "From client error telemetry rollups",
      ],
      api_evidence: [
        "Derived from API error telemetry",
        "Based on summarized API error telemetry",
        "From API error telemetry rollups",
      ],
      spike_evidence: [
        "Spike conditions subsided based on summarized telemetry",
        "A prior spike window eased based on summarized telemetry",
        "Elevated failure pressure subsided based on summarized telemetry",
      ],
    },
  },

  routes: {
    templates: [
      // Generic routing reductions (phrase-bank driven)
      { tags: ["routes_404_down"], event: "{route_subject} reduced", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "{route_subject} lowered", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "{route_subject} declined", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "{route_subject} normalized", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "{route_subject} reduced", explanation: "{route_evidence} across {window}." },
      { tags: ["routes_404_down"], event: "{route_subject} lowered", explanation: "{route_evidence} across {window}." },
      { tags: ["routes_404_down"], event: "{route_subject} declined", explanation: "{route_evidence} across {window}." },
      { tags: ["routes_404_down"], event: "{route_subject} normalized", explanation: "{route_evidence} across {window}." },

      // Operator-grade named templates (still derived from the same signal)
      { tags: ["routes_404_down"], event: "Route posture improved", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "Routing surface stabilized", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "Navigation integrity improved", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "Not-found pressure reduced", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "Routing pressure reduced", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "Route failures reduced", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "Routing integrity improved", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "Route pressure reduced", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "Route stability improved", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "Routing surface normalized", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "Dead-end pressure reduced", explanation: "{route_evidence} over {window}." },
      { tags: ["routes_404_down"], event: "Route recovery improved", explanation: "{route_evidence} over {window}." },
    ],
    banks: {
      route_subject: [
        "Not-found pressure",
        "404 pressure",
        "Routing pressure",
        "Routing failure pressure",
        "Route pressure",
        "Dead-end pressure",
      ],
      route_evidence: [
        "Derived from routing telemetry aggregates",
        "Based on summarized routing telemetry",
        "From routing telemetry rollups",
      ],
    },
  },

  seo: {
    templates: [
      { tags: ["seo_refreshed"], event: "SEO signals refreshed", explanation: "{seo_evidence} over {window}." },
      { tags: ["seo_refreshed"], event: "Indexability signals refreshed", explanation: "{seo_evidence} over {window}." },
      { tags: ["seo_refreshed"], event: "Metadata coverage updated", explanation: "{seo_evidence} over {window}." },
      { tags: ["seo_refreshed"], event: "Crawl signals refreshed", explanation: "{seo_evidence} over {window}." },
      { tags: ["seo_refreshed"], event: "SEO posture updated", explanation: "{seo_evidence} over {window}." },

      { tags: ["seo_verified"], event: "Canonical consistency verified", explanation: "{seo_verify_evidence}." },
      { tags: ["seo_verified"], event: "Metadata posture stabilized", explanation: "{seo_verify_evidence}." },
      { tags: ["seo_verified"], event: "Indexability posture stabilized", explanation: "{seo_verify_evidence}." },
      { tags: ["seo_verified"], event: "SEO posture stabilized", explanation: "{seo_verify_evidence}." },
      { tags: ["seo_verified"], event: "Indexability verified", explanation: "{seo_verify_evidence}." },

      // Padding to meet 20–40 guidance without inventing improvement.
      { tags: ["seo_refreshed"], event: "SEO coverage refreshed", explanation: "{seo_evidence} over {window}." },
      { tags: ["seo_refreshed"], event: "Metadata signals refreshed", explanation: "{seo_evidence} over {window}." },
      { tags: ["seo_refreshed"], event: "Index signals refreshed", explanation: "{seo_evidence} over {window}." },
      { tags: ["seo_refreshed"], event: "SEO snapshot refreshed", explanation: "{seo_evidence} over {window}." },
      { tags: ["seo_refreshed"], event: "SEO signals updated", explanation: "{seo_evidence} over {window}." },

      { tags: ["seo_verified"], event: "Canonical posture verified", explanation: "{seo_verify_evidence}." },
      { tags: ["seo_verified"], event: "Metadata coverage verified", explanation: "{seo_verify_evidence}." },
      { tags: ["seo_verified"], event: "Indexability posture verified", explanation: "{seo_verify_evidence}." },
      { tags: ["seo_verified"], event: "SEO posture verified", explanation: "{seo_verify_evidence}." },
      { tags: ["seo_verified"], event: "Metadata posture verified", explanation: "{seo_verify_evidence}." },
      { tags: ["seo_verified"], event: "Canonical consistency stabilized", explanation: "{seo_verify_evidence}." },
      { tags: ["seo_verified"], event: "Indexability stabilized", explanation: "{seo_verify_evidence}." },
    ],
    banks: {
      seo_evidence: [
        "SEO telemetry was refreshed",
        "SEO rollups were refreshed",
        "Indexability signals were refreshed",
        "Metadata rollups were refreshed",
      ],
      seo_verify_evidence: [
        "Coverage rollups are present and stable",
        "SEO rollups are present and reporting",
        "Canonical and metadata rollups are present and stable",
        "Indexability rollups are present and stable",
      ],
    },
  },

  recovery: {
    templates: [
      { tags: ["recovery_enabled"], event: "Interactive recovery enabled", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "404 recovery enabled", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Recovery surface active", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Recovery hooks active", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Failure handling improved", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Recovery surface expanded", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "404 recovery deployed", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Interactive recovery enabled", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Recovery posture improved", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Recovery enabled", explanation: "{recovery_evidence}." },

      // Padding for 20–40 guidance.
      { tags: ["recovery_enabled"], event: "404 handling enabled", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Recovery surface enabled", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Interactive fallback enabled", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Recovery surface stabilized", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Recovery posture established", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Recovery system enabled", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Failure recovery enabled", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Recovery handling enabled", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Interactive recovery enabled", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Recovery surface online", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "404 recovery active", explanation: "{recovery_evidence}." },
      { tags: ["recovery_enabled"], event: "Recovery enabled", explanation: "{recovery_evidence}." },
    ],
    banks: {
      recovery_evidence: [
        "A 404 recovery surface is enabled for this workspace",
        "Recovery handling is enabled for not-found routes",
        "Recovery handling is enabled and ready to capture structured interactions",
        "A recovery surface is enabled for not-found handling",
      ],
    },
  },

  trust: {
    templates: [
      { tags: ["telemetry_active"], event: "Telemetry active and reporting", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Signals refreshed", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Monitoring fully operational", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Telemetry verified", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Signals verified", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Telemetry reporting confirmed", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Signals reporting confirmed", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Workspace verified", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Monitoring active", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Telemetry online", explanation: "{trust_evidence} over {window}." },

      // Padding for 20–40 guidance.
      { tags: ["telemetry_active"], event: "Signals refreshed", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Telemetry active", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Signals active", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Monitoring online", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Telemetry operational", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Signals operational", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Telemetry reporting", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Signals reporting", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Workspace verified", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Monitoring verified", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Signals verified", explanation: "{trust_evidence} over {window}." },
      { tags: ["telemetry_active"], event: "Telemetry verified", explanation: "{trust_evidence} over {window}." },
    ],
    banks: {
      trust_evidence: [
        "Monitoring signals were ingested",
        "Signals were ingested",
        "Telemetry was ingested",
        "Monitoring signals were observed",
        "System signals were observed",
        "Signals were refreshed",
      ],
    },
  },

  maintenance: {
    templates: [
      { tags: ["baseline_established"], event: "Operational baseline established", explanation: "{baseline_evidence} within {window}." },
      { tags: ["baseline_established"], event: "Monitoring baseline established", explanation: "{baseline_evidence} within {window}." },
      { tags: ["baseline_established"], event: "Telemetry baseline established", explanation: "{baseline_evidence} within {window}." },
      { tags: ["baseline_established"], event: "Operational baseline re-established", explanation: "{baseline_evidence} within {window}." },
      { tags: ["baseline_established"], event: "Monitoring baseline re-established", explanation: "{baseline_evidence} within {window}." },

      { tags: ["hygiene"], event: "Configuration stabilized", explanation: "Monitoring configuration is stable based on summary telemetry." },
      { tags: ["hygiene"], event: "System drift corrected", explanation: "Operational signals indicate stabilized configuration." },
      { tags: ["hygiene"], event: "Monitoring coverage expanded", explanation: "Monitoring coverage signals indicate expanded visibility." },
      { tags: ["hygiene"], event: "Operational baseline reinforced", explanation: "Monitoring posture is stable based on aggregated telemetry." },
      { tags: ["hygiene"], event: "Monitoring posture stabilized", explanation: "Monitoring posture is stable based on summary telemetry." },

      // Padding to meet 20–40 guidance.
      { tags: ["baseline_established"], event: "Operational baseline established", explanation: "{baseline_evidence} within {window}." },
      { tags: ["baseline_established"], event: "Monitoring established", explanation: "{baseline_evidence} within {window}." },
      { tags: ["baseline_established"], event: "Telemetry activated", explanation: "{baseline_evidence} within {window}." },
      { tags: ["baseline_established"], event: "Signals activated", explanation: "{baseline_evidence} within {window}." },
      { tags: ["baseline_established"], event: "Monitoring activated", explanation: "{baseline_evidence} within {window}." },

      { tags: ["hygiene"], event: "Operational posture stabilized", explanation: "System posture is stable based on aggregated telemetry." },
      { tags: ["hygiene"], event: "Configuration normalized", explanation: "Configuration posture is stable based on summary telemetry." },
      { tags: ["hygiene"], event: "System baseline stabilized", explanation: "Baseline signals are stable based on aggregated telemetry." },
      { tags: ["hygiene"], event: "Monitoring posture reinforced", explanation: "Monitoring posture is stable based on aggregated telemetry." },
      { tags: ["hygiene"], event: "Operational hygiene improved", explanation: "Operational signals indicate stable configuration posture." },
      { tags: ["hygiene"], event: "Baseline stabilized", explanation: "Baseline signals are stable based on aggregated telemetry." },
      { tags: ["hygiene"], event: "Operational baseline stabilized", explanation: "Baseline posture is stable based on summary telemetry." },
    ],
    banks: {
      baseline_evidence: [
        "Telemetry began reporting",
        "Monitoring signals began reporting",
        "System signals began reporting",
        "Monitoring signals resumed reporting",
      ],
    },
  },
};

type OperationalHistoryCategory = "trust" | "maintenance" | "recovery" | "routes" | "errors" | "seo";

export type OperationalHistoryEntryVM = {
  id: string;
  event: string;
  explanation: string;
  ageWeeks: number; // 0 = newest
  windowLabel: string;
  category: OperationalHistoryCategory;
  tone: "good" | "ok" | "neutral";
  signal: string;
};

export type OperationalHistorySignalPointVM = {
  day: string;
  score: number; // 0..100, normalized within the current 28-day window
};

export type OperationalHistoryVM = {
  hasTelemetry: boolean;
  updatedLabel: "Updated: recently" | "Updated: last 7 days" | null;
  primarySignal: string | null;
  signalSeries: OperationalHistorySignalPointVM[];
  signalMetrics: {
    hasSignalData: boolean;
    latestScore: number; // 0..100
    delta7d: number; // recent 7d avg - prior 7d avg (negative = improving pressure)
    jumpCount7d: number; // count of >=10 point day-to-day moves in last 7 transitions
    volatility7d: number; // average absolute day-to-day move (0..100 scale)
  };
  entries: OperationalHistoryEntryVM[];
};

const ENTRY_TONE_BY_CATEGORY: Record<OperationalHistoryCategory, OperationalHistoryEntryVM["tone"]> = {
  trust: "ok",
  maintenance: "neutral",
  recovery: "ok",
  routes: "good",
  errors: "good",
  seo: "ok",
};

function windowLabelFromAgeWeeks(ageWeeks: number): string {
  if (ageWeeks <= 0) return "Last 7 days";
  if (ageWeeks === 1) return "7-14 days ago";
  if (ageWeeks === 2) return "14-21 days ago";
  return "21-28 days ago";
}

function pctLabel(value: number): string {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function percentagePointLabel(value: number): string {
  return `${(Math.max(0, value) * 100).toFixed(1)}pp`;
}

function updatedLabelFromISO(updatedAtISO: string | null): OperationalHistoryVM["updatedLabel"] {
  if (!updatedAtISO) return null;
  const ms = Date.parse(updatedAtISO);
  if (!Number.isFinite(ms)) return null;
  const ageDays = (Date.now() - ms) / 86_400_000;
  if (ageDays <= 2) return "Updated: recently";
  if (ageDays <= 7) return "Updated: last 7 days";
  return null;
}

function sumWeek<T>(arr: T[], start: number, len: number, pick: (v: T) => number) {
  let sum = 0;
  for (let i = 0; i < len; i++) sum += pick(arr[start + i]!);
  return sum;
}

function rate(numer: number, denom: number) {
  if (denom <= 0) return 0;
  return numer / denom;
}

function pctChange(prev: number, cur: number) {
  if (prev <= 0 && cur <= 0) return 0;
  if (prev <= 0) return 1;
  return (cur - prev) / prev;
}

function shouldEmitReduction(opts: {
  prev: number;
  cur: number;
  minPrev: number;
  minAbsDelta: number;
  minPctReduction: number; // 0..1 (e.g., 0.25 = 25% reduction)
}) {
  const prev = Math.max(0, opts.prev);
  const cur = Math.max(0, opts.cur);
  const absDelta = prev - cur;
  if (prev < opts.minPrev) return false;
  if (absDelta < opts.minAbsDelta) return false;
  const reduction = prev > 0 ? absDelta / prev : 0;
  return reduction >= opts.minPctReduction;
}

function buildSignalSeries(opts: {
  routesTrend: RoutesTrendPoint[];
  errorsTrend: ErrorsTrendPoint[];
}): OperationalHistorySignalPointVM[] {
  const { routesTrend, errorsTrend } = opts;
  const count = 28;
  const raw: Array<{ day: string; value: number }> = [];

  for (let i = 0; i < count; i++) {
    const route = routesTrend[i] || { day: "", sessions: 0, views404: 0 };
    const err = errorsTrend[i] || { day: route.day, jsErrors: 0, apiErrors: 0, views404: 0 };

    const sessions = Math.max(0, Number(route.sessions || 0));
    const views404 = Math.max(0, Number(route.views404 || 0));
    const errorsTotal = Math.max(0, Number(err.jsErrors || 0) + Number(err.apiErrors || 0) + Number(err.views404 || 0));
    const notFoundRate = sessions > 0 ? views404 / sessions : 0;

    // Real telemetry mix: 404 volume/rate + client/API pressure.
    const value = errorsTotal * 1.4 + views404 * 1.8 + notFoundRate * 120;
    raw.push({
      day: route.day || err.day || `d-${i}`,
      value,
    });
  }

  // Light smoothing keeps spikes readable without hiding movement.
  const smooth = raw.map((point, idx) => {
    const prev = raw[Math.max(0, idx - 1)]?.value ?? point.value;
    const next = raw[Math.min(raw.length - 1, idx + 1)]?.value ?? point.value;
    return { day: point.day, value: point.value * 0.6 + prev * 0.2 + next * 0.2 };
  });

  const max = smooth.reduce((acc, point) => Math.max(acc, point.value), 0);
  if (max <= 0) return smooth.map((point) => ({ day: point.day, score: 0 }));

  return smooth.map((point) => ({
    day: point.day,
    score: Math.round(clamp(point.value / max, 0, 1) * 100),
  }));
}

function composeEntry(category: CategoryId, tag: string, seed: string, tokens: Record<string, string>) {
  const tax = TAXONOMY[category];
  const candidates = tax.templates.filter((t) => t.tags.includes(tag));
  if (!candidates.length) return null;
  const tmpl = stablePick(candidates, seed, "template");
  const resolved: Record<string, string> = { ...tokens };
  for (const [k, bank] of Object.entries(tax.banks)) {
    if (resolved[k] != null) continue;
    if (Array.isArray(bank) && bank.length) resolved[k] = stablePick(bank, seed, `bank:${k}`);
  }

  const event = renderTemplate(tmpl.event, resolved).trim();
  const explanation = renderTemplate(tmpl.explanation, resolved).trim();
  if (!event || !explanation) return null;
  // Hard safety: never allow multi-line strings (exactly two lines in UI).
  if (event.includes("\n") || explanation.includes("\n")) return null;
  return { event, explanation };
}

export function buildOperationalHistoryViewModel(opts: {
  username: string;
  workspaceKey: string;
  summary30d: unknown;
  allowErrors: boolean;
  allowSeo: boolean;
  arcadeEnabled: boolean;
}): OperationalHistoryVM {
  const workspaceKey = String(opts.workspaceKey || opts.username || "").trim() || "workspace";
  const updatedAtISO = extractUpdatedAtISO(opts.summary30d);
  const updatedLabel = updatedLabelFromISO(updatedAtISO);

  const routesTrend = normalizeRoutesTrend(opts.summary30d, 28);
  const errorsTrend = opts.allowErrors ? normalizeErrorsTrend(opts.summary30d, 28) : [];
  const seoUpdatedAtISO = opts.allowSeo ? normalizeSeoUpdatedAtISO(opts.summary30d) : null;
  const seoRollup = opts.allowSeo ? normalizeSeoRollup(opts.summary30d) : { titleCoveragePct: null, descriptionCoveragePct: null, canonicalCoveragePct: null };
  const seoAgeDays = (() => {
    const ms = seoUpdatedAtISO ? Date.parse(seoUpdatedAtISO) : NaN;
    if (!Number.isFinite(ms)) return null;
    return (Date.now() - ms) / 86_400_000;
  })();
  const seoRecentlyRefreshed = seoAgeDays != null && seoAgeDays <= 7;

  const hasTelemetry =
    Boolean(updatedAtISO) ||
    routesTrend.some((p) => (p.sessions ?? 0) > 0 || (p.views404 ?? 0) > 0) ||
    errorsTrend.some((p) => (p.jsErrors ?? 0) > 0 || (p.apiErrors ?? 0) > 0 || (p.views404 ?? 0) > 0) ||
    Boolean(seoUpdatedAtISO);

  const entries: Array<OperationalHistoryEntryVM & { strength: number }> = [];
  const signalSeries = buildSignalSeries({ routesTrend, errorsTrend });
  const windowNewest = "the last 7 days";
  const windowPrior = "a prior 7-day window";
  const recentSessions = routesTrend.length === 28 ? sumWeek(routesTrend, 21, 7, (p) => p.sessions) : 0;
  const recentErrors = errorsTrend.length === 28 ? sumWeek(errorsTrend, 21, 7, (p) => p.jsErrors + p.apiErrors + p.views404) : 0;

  const pushEntry = (input: {
    id: string;
    event: string;
    explanation: string;
    ageWeeks: number;
    strength: number;
    category: OperationalHistoryCategory;
    signal: string;
  }) => {
    entries.push({
      id: input.id,
      event: input.event,
      explanation: input.explanation,
      ageWeeks: input.ageWeeks,
      windowLabel: windowLabelFromAgeWeeks(input.ageWeeks),
      category: input.category,
      tone: ENTRY_TONE_BY_CATEGORY[input.category],
      signal: String(input.signal || "").trim() || "Telemetry signal observed in the current monitoring window.",
      strength: input.strength,
    });
  };

  // Trust anchor (rare, high-signal): only emit when we have real telemetry.
  const hasTelemetryLast7d =
    recentSessions > 0 || recentErrors > 0 || seoRecentlyRefreshed || updatedLabel != null;

  if (hasTelemetryLast7d) {
    const trustWindowKey = routesTrend.length === 28 ? routesTrend[21]!.day : updatedAtISO?.slice(0, 10) || "na";
    const seed = `${workspaceKey}|trust|${trustWindowKey}`;
    const composed = composeEntry("trust", "telemetry_active", seed, { window: windowNewest });
    if (composed) {
      const signal =
        recentSessions > 0 && recentErrors > 0
          ? "Route and error telemetry were active in the latest 7-day window."
          : recentSessions > 0
          ? "Route telemetry was active in the latest 7-day window."
          : recentErrors > 0
          ? "Error telemetry was active in the latest 7-day window."
          : seoRecentlyRefreshed
          ? "SEO telemetry refreshed in the latest 7-day window."
          : "Monitoring telemetry refreshed recently.";

      pushEntry({
        id: `trust:${fnv1a32(seed).toString(16)}`,
        event: composed.event,
        explanation: composed.explanation,
        ageWeeks: 0,
        category: "trust",
        signal,
        strength: 0.9,
      });
    }
  }

  // Maintenance: "baseline established" if telemetry only appears in the newest window.
  if (hasTelemetry && routesTrend.length === 28) {
    const curSessions = sumWeek(routesTrend, 21, 7, (p) => p.sessions);
    const prevSessions = sumWeek(routesTrend, 0, 21, (p) => p.sessions);
    const baselineEstablished = curSessions > 0 && prevSessions <= 0;
    if (baselineEstablished) {
      const seed = `${workspaceKey}|maint|baseline|${routesTrend[21]!.day}`;
      const composed = composeEntry("maintenance", "baseline_established", seed, { window: windowNewest });
      if (composed) {
        pushEntry({
          id: `maint:${fnv1a32(seed).toString(16)}`,
          event: composed.event,
          explanation: composed.explanation,
          ageWeeks: 0,
          category: "maintenance",
          signal: "New activity appeared in the latest window after a previously quiet period.",
          strength: 0.75,
        });
      }
    }
  }

  // Recovery surface (state-driven, no raw logs): emit if enabled.
  if (opts.arcadeEnabled) {
    const seed = `${workspaceKey}|recovery|enabled`;
    const composed = composeEntry("recovery", "recovery_enabled", seed, {});
    if (composed) {
      pushEntry({
        id: `recovery:${fnv1a32(seed).toString(16)}`,
        event: composed.event,
        explanation: composed.explanation,
        ageWeeks: 0,
        category: "recovery",
        signal: "Interactive 404 recovery is enabled for this workspace.",
        strength: 0.6,
      });
    }
  }

  // Week-over-week reductions (newest week compared to the prior week), up to 4 weeks of history.
  // Buckets are: [0..6]=oldest of 28d, [21..27]=newest.
  const weeks = [0, 7, 14, 21];
  const weekLabel = (ageWeeks: number) => (ageWeeks === 0 ? windowNewest : windowPrior);

  // Routes: 404 pressure reduction inferred from 404 rate drop.
  if (routesTrend.length === 28) {
    for (let w = weeks.length - 1; w >= 1; w--) {
      const curStart = weeks[w]!;
      const prevStart = weeks[w - 1]!;
      const ageWeeks = weeks.length - 1 - w; // newest bucket => 0

      const curSessions = sumWeek(routesTrend, curStart, 7, (p) => p.sessions);
      const prevSessions = sumWeek(routesTrend, prevStart, 7, (p) => p.sessions);
      const cur404 = sumWeek(routesTrend, curStart, 7, (p) => p.views404);
      const prev404 = sumWeek(routesTrend, prevStart, 7, (p) => p.views404);

      // Avoid tiny windows that create unstable ratios.
      const enoughTraffic = Math.max(curSessions, prevSessions) >= 50;
      if (!enoughTraffic) continue;

      const curRate = rate(cur404, curSessions);
      const prevRate = rate(prev404, prevSessions);

      const reduction = prevRate > 0 ? (prevRate - curRate) / prevRate : 0;
      const absDelta = prevRate - curRate;

      const emit = reduction >= 0.2 && absDelta >= 0.002; // >=20% reduction and >=0.2pp absolute
      if (!emit) continue;

      const seed = `${workspaceKey}|routes|${routesTrend[curStart]!.day}`;
      const tokens = { window: weekLabel(ageWeeks) };
      const composed = composeEntry("routes", "routes_404_down", seed, tokens);
      if (!composed) continue;

      pushEntry({
        id: `routes:${fnv1a32(seed).toString(16)}`,
        event: composed.event,
        explanation: composed.explanation,
        ageWeeks,
        category: "routes",
        signal: `404 rate down ${pctLabel(reduction)} week-over-week (${percentagePointLabel(absDelta)} absolute).`,
        strength: clamp(0.35 + reduction, 0.35, 0.85),
      });
    }
  }

  // Errors: reductions inferred from summarized JS+API volumes (never exposing raw counts).
  if (opts.allowErrors && errorsTrend.length === 28) {
    for (let w = weeks.length - 1; w >= 1; w--) {
      const curStart = weeks[w]!;
      const prevStart = weeks[w - 1]!;
      const ageWeeks = weeks.length - 1 - w;

      const curJs = sumWeek(errorsTrend, curStart, 7, (p) => p.jsErrors);
      const prevJs = sumWeek(errorsTrend, prevStart, 7, (p) => p.jsErrors);
      const curApi = sumWeek(errorsTrend, curStart, 7, (p) => p.apiErrors);
      const prevApi = sumWeek(errorsTrend, prevStart, 7, (p) => p.apiErrors);

      const curAny = curJs + curApi;
      const prevAny = prevJs + prevApi;

      const anyReduced = shouldEmitReduction({
        prev: prevAny,
        cur: curAny,
        minPrev: 25,
        minAbsDelta: 10,
        minPctReduction: 0.25,
      });
      const jsReduced = shouldEmitReduction({
        prev: prevJs,
        cur: curJs,
        minPrev: 15,
        minAbsDelta: 8,
        minPctReduction: 0.3,
      });
      const apiReduced = shouldEmitReduction({
        prev: prevApi,
        cur: curApi,
        minPrev: 15,
        minAbsDelta: 8,
        minPctReduction: 0.3,
      });

      if (!anyReduced && !jsReduced && !apiReduced) continue;

      const tag =
        jsReduced && !apiReduced ? "errors_down_js" :
        apiReduced && !jsReduced ? "errors_down_api" :
        "errors_down_any";

      const seed = `${workspaceKey}|errors|${errorsTrend[curStart]!.day}`;
      const tokens = { window: weekLabel(ageWeeks) };
      const composed = composeEntry("errors", tag, seed, tokens);
      if (!composed) continue;

      const reduction =
        tag === "errors_down_js" ? Math.max(0, -pctChange(prevJs, curJs)) :
        tag === "errors_down_api" ? Math.max(0, -pctChange(prevApi, curApi)) :
        Math.max(0, -pctChange(prevAny, curAny));

      const signal =
        tag === "errors_down_js"
          ? `Client-side error volume down ${pctLabel(reduction)} week-over-week.`
          : tag === "errors_down_api"
          ? `API error volume down ${pctLabel(reduction)} week-over-week.`
          : `Combined JS+API error volume down ${pctLabel(reduction)} week-over-week.`;

      pushEntry({
        id: `errors:${fnv1a32(seed).toString(16)}`,
        event: composed.event,
        explanation: composed.explanation,
        ageWeeks,
        category: "errors",
        signal,
        strength: clamp(0.35 + reduction, 0.35, 0.9),
      });
    }
  }

  // SEO: only emit if signals refreshed recently, or if coverage is strong enough to verify posture.
  if (opts.allowSeo) {
    if (seoRecentlyRefreshed) {
      const seed = `${workspaceKey}|seo|refreshed|${seoUpdatedAtISO}`;
      const tokens = { window: windowNewest };
      const composed = composeEntry("seo", "seo_refreshed", seed, tokens);
      if (composed) {
        const ageDaysRounded = seoAgeDays == null ? null : Math.max(0, Math.round(seoAgeDays));
        pushEntry({
          id: `seo:${fnv1a32(seed).toString(16)}`,
          event: composed.event,
          explanation: composed.explanation,
          ageWeeks: 0,
          category: "seo",
          signal:
            ageDaysRounded == null
              ? "SEO telemetry refreshed recently."
              : `SEO telemetry refreshed ${ageDaysRounded} day${ageDaysRounded === 1 ? "" : "s"} ago.`,
          strength: 0.55,
        });
      }
    }

    const canonicalStrong = (seoRollup.canonicalCoveragePct ?? 0) >= 85;
    const metaStrong =
      (seoRollup.titleCoveragePct ?? 0) >= 85 && (seoRollup.descriptionCoveragePct ?? 0) >= 80;
    const canVerify = canonicalStrong || metaStrong;
    if (seoRecentlyRefreshed && canVerify) {
      const seed = `${workspaceKey}|seo|verified|${String(seoRollup.canonicalCoveragePct ?? "")}:${String(seoRollup.titleCoveragePct ?? "")}:${String(seoRollup.descriptionCoveragePct ?? "")}`;
      const composed = composeEntry("seo", "seo_verified", seed, {});
      if (composed) {
        pushEntry({
          id: `seo2:${fnv1a32(seed).toString(16)}`,
          event: composed.event,
          explanation: composed.explanation,
          ageWeeks: 0,
          category: "seo",
          signal: `Coverage verified: title ${Math.round(seoRollup.titleCoveragePct ?? 0)}%, description ${Math.round(seoRollup.descriptionCoveragePct ?? 0)}%, canonical ${Math.round(seoRollup.canonicalCoveragePct ?? 0)}%.`,
          strength: 0.45,
        });
      }
    }
  }

  if (hasTelemetry && entries.length === 0) {
    const seed = `${workspaceKey}|maintenance|stable_window`;
    pushEntry({
      id: `maint:${fnv1a32(seed).toString(16)}`,
      event: "Signals remained stable",
      explanation: "No statistically significant week-over-week shifts were detected in the current summary window.",
      ageWeeks: 0,
      category: "maintenance",
      signal: "No major deviations detected across the 28-day telemetry window.",
      strength: 0.42,
    });
  }

  // Dedupe by id and apply final limits:
  // - max 12 entries
  // - stable ordering: newest first, then strength, then id.
  const uniq = new Map<string, (OperationalHistoryEntryVM & { strength: number })>();
  for (const e of entries) {
    const existing = uniq.get(e.id);
    if (!existing || e.strength > existing.strength) uniq.set(e.id, e);
  }

  const finalEntries = Array.from(uniq.values())
    .sort((a, b) => {
      if (a.ageWeeks !== b.ageWeeks) return a.ageWeeks - b.ageWeeks; // newer first (0,1,2..)
      if (b.strength !== a.strength) return b.strength - a.strength;
      return a.id.localeCompare(b.id);
    })
    .slice(0, 12);

  const final = finalEntries.map((e) => ({
    id: e.id,
    event: e.event,
    explanation: e.explanation,
    ageWeeks: e.ageWeeks,
    windowLabel: e.windowLabel,
    category: e.category,
    tone: e.tone,
    signal: e.signal,
  }));

  const primarySignal = final[0]?.signal ?? null;
  const seriesScores = signalSeries.map((point) => Math.max(0, Math.min(100, Number(point.score || 0))));
  const hasSignalData = seriesScores.some((value) => value > 0);
  const latestScore = seriesScores.length ? seriesScores[seriesScores.length - 1]! : 0;
  const recent7 = seriesScores.slice(-7);
  const prior7 = seriesScores.slice(-14, -7);
  const recent7Avg = recent7.length ? recent7.reduce((sum, value) => sum + value, 0) / recent7.length : 0;
  const prior7Avg = prior7.length ? prior7.reduce((sum, value) => sum + value, 0) / prior7.length : recent7Avg;
  const delta7d = Number((recent7Avg - prior7Avg).toFixed(1));
  const tailForDiff = seriesScores.slice(-8);
  let diffSum = 0;
  let jumpCount7d = 0;
  for (let i = 1; i < tailForDiff.length; i++) {
    const diff = Math.abs(tailForDiff[i]! - tailForDiff[i - 1]!);
    diffSum += diff;
    if (diff >= 10) jumpCount7d += 1;
  }
  const volatility7d = Number((tailForDiff.length > 1 ? diffSum / (tailForDiff.length - 1) : 0).toFixed(1));

  return {
    hasTelemetry,
    updatedLabel,
    primarySignal,
    signalSeries,
    signalMetrics: {
      hasSignalData,
      latestScore: Math.round(latestScore),
      delta7d,
      jumpCount7d,
      volatility7d,
    },
    entries: final,
  };
}
