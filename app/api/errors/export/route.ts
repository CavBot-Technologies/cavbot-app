import { NextResponse } from "next/server";

import { gateModuleAccess } from "@/lib/moduleGate.server";
import { readWorkspace } from "@/lib/workspaceStore.server";
import { buildErrorInsights } from "@/lib/errors/errorInsights";
import { getTenantProjectSummary } from "@/lib/projectSummary.server";

// Keep the API stable and safe:
// - Errors remains Premium-locked via gateModuleAccess("errors")
// - projectId in query is treated as a hint only; we use workspace-scoped projectId to prevent leakage.
// - All results are derived solely from CavBot's ingested summary data (no external fetching).

type RangeKey = "24h" | "7d" | "14d" | "30d";

function asRangeKey(v: string | null): RangeKey {
  const x = (v || "").trim();
  if (x === "7d" || x === "14d" || x === "30d") return x;
  return "24h";
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}
function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object");
}
function nOrNull(x: unknown) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

type ErrorGroup = {
  fingerprint: string;
  kind: string | null;
  message: string | null;
  fileName: string | null;
  routePath: string | null;
  status: number | null;
  count: number | null;
  sessions: number | null;
  firstSeenISO: string | null;
  lastSeenISO: string | null;
};

type ErrorEvent = {
  tsISO: string | null;
  kind: string | null;
  message: string | null;
  routePath: string | null;
  fileName: string | null;
  line: number | null;
  column: number | null;
  status: number | null;
  method: string | null;
  urlPath: string | null;
  fingerprint: string | null;
};

type ErrorsPayload = {
  updatedAtISO: string | null;
  totals: {
    jsErrors?: number | null;
    apiErrors?: number | null;
    unhandledRejections?: number | null;
    views404?: number | null;
    crashFreeSessionsPct?: number | null;
    p95DetectMs?: number | null;
  };
  trend: { day: string; jsErrors?: number | null; apiErrors?: number | null; views404?: number | null }[];
  groups: ErrorGroup[];
  recent: ErrorEvent[];
};

function normalizeErrorsFromSummary(summary: unknown): ErrorsPayload {
  const record = asRecord(summary);
  const e =
    asRecord(record?.errors) ||
    asRecord(record?.errorIntelligence) ||
    asRecord(asRecord(record?.diagnostics)?.errors) ||
    null;

  const totalsRaw = asRecord(e?.totals) || asRecord(e?.summary) || asRecord(e?.counts) || null;
  const trendRaw = Array.isArray(e?.trend)
    ? e?.trend
    : Array.isArray(e?.series)
    ? e?.series
    : Array.isArray(e?.daily)
    ? e?.daily
    : Array.isArray(e?.spark)
    ? e?.spark
    : null;
  const groupsRaw = Array.isArray(e?.groups)
    ? e?.groups
    : Array.isArray(e?.topGroups)
    ? e?.topGroups
    : Array.isArray(e?.top)
    ? e?.top
    : Array.isArray(e?.fingerprints)
    ? e?.fingerprints
    : null;
  const recentRaw = Array.isArray(e?.recent)
    ? e?.recent
    : Array.isArray(e?.events)
    ? e?.events
    : Array.isArray(e?.latest)
    ? e?.latest
    : Array.isArray(e?.stream)
    ? e?.stream
    : null;

  const totals = {
    jsErrors: nOrNull(totalsRaw?.jsErrors ?? totalsRaw?.js ?? totalsRaw?.js_error ?? totalsRaw?.js_error_count),
    apiErrors: nOrNull(totalsRaw?.apiErrors ?? totalsRaw?.api ?? totalsRaw?.api_error ?? totalsRaw?.api_error_count),
    unhandledRejections: nOrNull(totalsRaw?.unhandledRejections ?? totalsRaw?.rejections ?? totalsRaw?.unhandled_rejection),
    views404: nOrNull(totalsRaw?.views404 ?? totalsRaw?.views_404 ?? totalsRaw?.notFound ?? totalsRaw?.views404Count),
    crashFreeSessionsPct: nOrNull(totalsRaw?.crashFreeSessionsPct ?? totalsRaw?.crashFreePct ?? totalsRaw?.crash_free),
    p95DetectMs: nOrNull(totalsRaw?.p95DetectMs ?? totalsRaw?.p95_detect_ms ?? totalsRaw?.p95Detect),
  };

  type TrendPoint = { day: string; jsErrors: number | null; apiErrors: number | null; views404: number | null };
  const trend =
    Array.isArray(trendRaw) && trendRaw.length
      ? trendRaw
          .map((item) => {
            if (!isRecord(item)) return null;
            const day = String(item.day ?? item.date ?? item.d ?? "").slice(0, 10);
            if (!day) return null;
            return {
              day,
              jsErrors: nOrNull(item.jsErrors ?? item.js ?? item.js_error),
              apiErrors: nOrNull(item.apiErrors ?? item.api ?? item.api_error),
              views404: nOrNull(item.views404 ?? item.views_404 ?? item.notFound),
            };
          })
          .filter((p): p is TrendPoint => Boolean(p))
      : [];

  const groups =
    Array.isArray(groupsRaw) && groupsRaw.length
      ? groupsRaw
          .map((entry) => {
            if (!isRecord(entry)) return null;
            const fingerprint = String(entry.fingerprint ?? entry.fp ?? entry.id ?? "").slice(0, 120);
            if (!fingerprint) return null;
            return {
              fingerprint,
              kind: entry.kind != null ? String(entry.kind) : null,
              message: entry.message != null ? String(entry.message) : null,
              fileName: entry.fileName != null ? String(entry.fileName) : null,
              routePath: entry.routePath != null ? String(entry.routePath) : null,
              status: entry.status != null ? Number(entry.status) : null,
              count: nOrNull(entry.count ?? entry.hits ?? entry.n),
              sessions: nOrNull(entry.sessions ?? entry.affectedSessions ?? entry.s),
              firstSeenISO: entry.firstSeenISO != null ? String(entry.firstSeenISO) : entry.firstSeen != null ? String(entry.firstSeen) : null,
              lastSeenISO: entry.lastSeenISO != null ? String(entry.lastSeenISO) : entry.lastSeen != null ? String(entry.lastSeen) : null,
            };
          })
          .filter((g): g is ErrorGroup => Boolean(g && g.fingerprint))
          .slice(0, 60)
      : [];

  const recent =
    Array.isArray(recentRaw) && recentRaw.length
      ? recentRaw
          .map((entry) => {
            if (!isRecord(entry)) return null;
            return {
              tsISO: entry.tsISO != null ? String(entry.tsISO) : entry.event_timestamp != null ? String(entry.event_timestamp) : null,
              kind: entry.kind != null ? String(entry.kind) : null,
              message: entry.message != null ? String(entry.message) : null,
              routePath: entry.routePath != null ? String(entry.routePath) : entry.route_path != null ? String(entry.route_path) : null,
              fileName: entry.fileName != null ? String(entry.fileName) : null,
              line: entry.line != null ? Number(entry.line) : null,
              column: entry.column != null ? Number(entry.column) : null,
              status: entry.status != null ? Number(entry.status) : null,
              method: entry.method != null ? String(entry.method) : null,
              urlPath: entry.urlPath != null ? String(entry.urlPath) : null,
              fingerprint: entry.fingerprint != null ? String(entry.fingerprint) : null,
            };
          })
          .filter((ev): ev is ErrorEvent => Boolean(ev))
          .slice(0, 80)
      : [];

  const meta = asRecord(record?.meta);
  const updatedAtISO = record?.updatedAtISO ?? e?.updatedAtISO ?? e?.updatedAt ?? meta?.updatedAtISO ?? null;

  return { updatedAtISO: updatedAtISO != null ? String(updatedAtISO) : null, totals, trend, groups, recent };
}

export async function GET(req: Request) {
  const gate = await gateModuleAccess(req, "errors");
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "PREMIUM_REQUIRED", message: "Error Intelligence is Premium." },
      { status: 402 }
    );
  }

  const url = new URL(req.url);
  const range = asRangeKey(url.searchParams.get("range"));
  const siteId = (url.searchParams.get("site") || "").trim();
  const projectIdHint = (url.searchParams.get("projectId") || "").trim();

  // Workspace-scoped projectId is the source of truth for multi-tenant safety.
  const ws = await readWorkspace();
  const projectId = String((ws as { projectId?: unknown } | null)?.projectId || "1");

  const sites = ((ws as { sites?: unknown[] } | null)?.sites || []).map((s) => ({
    id: String((s as { id?: unknown } | null)?.id || ""),
    label: String((s as { label?: unknown } | null)?.label || "").trim() || "Site",
    url: String((s as { origin?: unknown } | null)?.origin || "").trim(),
  }));

  const activeSite =
    (siteId && sites.find((s) => s.id === siteId)) ||
    ((ws as { activeSiteId?: unknown } | null)?.activeSiteId ? sites.find((s) => s.id === String((ws as { activeSiteId?: unknown }).activeSiteId)) : null) ||
    sites[0] ||
    { id: "none", label: "No site selected", url: "" };

  let summary: unknown = null;
  let errors: ErrorsPayload = { updatedAtISO: null, totals: {}, trend: [], groups: [], recent: [] };

  try {
    const { summary: loadedSummary } = await getTenantProjectSummary({
      projectId,
      range: range === "30d" ? "30d" : "7d",
      siteOrigin: activeSite.url || undefined,
    });
    summary = loadedSummary;
    errors = normalizeErrorsFromSummary(summary);
  } catch {
    summary = null;
    errors = { updatedAtISO: null, totals: {}, trend: [], groups: [], recent: [] };
  }

  const insights = buildErrorInsights(errors);

  const payload = {
    ok: true,
    projectId,
    projectIdHint: projectIdHint || null,
    site: { id: activeSite.id, label: activeSite.label, origin: activeSite.url || null },
    range,
    updatedAtISO: errors.updatedAtISO || null,
    totals: errors.totals,
    trend: errors.trend,
    topGroups: insights.rankedGroupsByHits.slice(0, 60),
    insights: {
      spikes: insights.spikes,
      topDrivers: insights.topDrivers,
      actions: insights.actions,
    },
  };

  // Ensure response is never cached across tenants.
  const res = NextResponse.json(payload, { status: 200 });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
