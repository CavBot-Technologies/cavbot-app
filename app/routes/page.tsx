// app/routes/page.tsx
import "./routes.css";

import Script from "next/script";
import { unstable_noStore as noStore } from "next/cache";

import AppShell from "@/components/AppShell";
import DashboardToolsControls from "@/components/DashboardToolsControls";
import CavAiRouteRecommendations from "@/components/CavAiRouteRecommendations";
import { resolveAnalyticsConsoleContext } from "@/lib/analyticsConsole.server";
import type { ProjectSummary } from "@/lib/cavbotTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type RangeKey = "24h" | "7d" | "14d" | "30d";

type ProjectSummaryWithTrend = ProjectSummary & {
  trend?: unknown;
  trend7d?: unknown;
  trend30d?: unknown;
  updatedAtISO?: string | null;
  meta?: { updatedAtISO?: string | null };
};

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Dict;
  }
  return null;
}

function firstDict(...values: unknown[]): Dict | null {
  for (const value of values) {
    const dict = asDict(value);
    if (dict) return dict;
  }
  return null;
}

function childDict(parent: Dict | null, key: string): Dict | null {
  if (!parent) return null;
  return asDict(parent[key]);
}

function childDictFromValue(value: unknown, key: string): Dict | null {
  const dict = asDict(value);
  return asDict(dict?.[key]);
}

function getString(dict: Dict | null, key: string): string | undefined {
  const value = dict?.[key];
  return typeof value === "string" ? value : undefined;
}

function getValue(dict: Dict | null, keys: string[]): unknown {
  if (!dict) return undefined;
  for (const key of keys) {
    const value = dict[key];
    if (typeof value !== "undefined") return value;
  }
  return undefined;
}

function firstArray(...values: unknown[]): unknown[] | null {
  for (const value of values) {
    if (Array.isArray(value) && value.length) {
      return value;
    }
  }
  return null;
}

function toSlug(v: string) {
  return (
    String(v || "")
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 63) || "site"
  );
}

function n(x: unknown, fallback = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}
function nOrNull(x: unknown) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}
function fmtInt(v: unknown) {
  const x = nOrNull(v);
  if (x == null) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(x);
}
function fmtPct(v: unknown, digits = 1) {
  const x = nOrNull(v);
  if (x == null) return "—";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(x)}%`;
}
function fmtMs(v: unknown) {
  const x = nOrNull(v);
  if (x == null) return "—";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(x)} ms`;
}

function csvEscape(value: string) {
  const v = String(value ?? "");
  if (v.includes('"') || v.includes(",") || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function buildRoutesReportCSV(input: {
  siteLabel: string;
  siteUrl: string;
  range: string;
  updatedAtLabel: string;
  routesObserved?: number | null;
  uniqueRoutes?: number | null;
  pageViews?: number | null;
  routeChanges?: number | null;
  topRoutes: Array<{
    routePath?: string | null;
    views?: number | null;
    sessions?: number | null;
    views404?: number | null;
    jsErrors?: number | null;
    avgLoadMs?: number | null;
  }>;
}) {
  const rows: string[] = [];
  rows.push("CavBot Routes Report");
  rows.push(`Target,${csvEscape(input.siteLabel || "—")}`);
  rows.push(`Origin,${csvEscape(input.siteUrl || "—")}`);
  rows.push(`Range,${csvEscape(input.range || "—")}`);
  rows.push(`Updated,${csvEscape(input.updatedAtLabel || "—")}`);
  rows.push("");
  rows.push("Summary");
  rows.push(`Routes observed,${csvEscape(String(input.routesObserved ?? ""))}`);
  rows.push(`Unique routes,${csvEscape(String(input.uniqueRoutes ?? ""))}`);
  rows.push(`Page views,${csvEscape(String(input.pageViews ?? ""))}`);
  rows.push(`Route changes,${csvEscape(String(input.routeChanges ?? ""))}`);
  rows.push("");
  rows.push("Top routes");
  rows.push("Path,Views,Sessions,404 Views,JS Errors,Avg Load (ms)");
  for (const r of input.topRoutes) {
    rows.push([
      csvEscape(String(r.routePath || "—")),
      csvEscape(String(r.views ?? "")),
      csvEscape(String(r.sessions ?? "")),
      csvEscape(String(r.views404 ?? "")),
      csvEscape(String(r.jsErrors ?? "")),
      csvEscape(String(r.avgLoadMs ?? "")),
    ].join(","));
  }
  return rows.join("\n");
}

/* =========================
  Routes payload normalization
========================= */
type RouteRow = {
  routePath?: string | null;
  views?: number | null;
  sessions?: number | null;
  views404?: number | null;
  jsErrors?: number | null;
  apiErrors?: number | null;
  avgLoadMs?: number | null;
  lcpP75Ms?: number | null;
  inpP75Ms?: number | null;
  lastSeenISO?: string | null;
  issues?: string[] | null;
};

type RoutesPayload = {
  updatedAtISO?: string | null;

  routesObserved?: number | null;
  uniqueRoutes?: number | null;
  pageViews?: number | null;
  sessions?: number | null;

  routeChanges?: number | null; // SPA navigations / route_change events
  spaNavigations?: number | null;

  views404Pct?: number | null;
  jsErrorPct?: number | null;
  slowRoutePct?: number | null;

  views404Count?: number | null;
  jsErrorCount?: number | null;
  slowRouteCount?: number | null;

  topRoutes?: RouteRow[];
};

function normalizeRoutesFromSummary(summary: unknown): RoutesPayload {
  const summaryDict = asDict(summary);
  const s = firstDict(
    summaryDict?.["routes"],
    summaryDict?.["routesIntelligence"],
    summaryDict?.["routeIntelligence"],
    summaryDict?.["routing"],
    childDictFromValue(summaryDict?.["analytics"], "routes"),
    childDictFromValue(summaryDict?.["diagnostics"], "routes"),
    childDictFromValue(summaryDict?.["snapshot"], "routes")
  );

  const rollup = firstDict(s?.rollup, s?.summary, s?.totals, s?.counts, s);

  const summaryRoutes = childDict(summaryDict, "routes");
  const rowsRaw = firstArray(
    s?.["topRoutes"],
    s?.["routes"],
    s?.["rows"],
    s?.["pageRows"],
    summaryDict?.["topRoutes"],
    summaryRoutes?.["topRoutes"]
  );

  const rows: RouteRow[] =
    rowsRaw && rowsRaw.length
      ? (rowsRaw as unknown[])
          .map((rRaw) => {
            const r = asDict(rRaw);
            const routePath =
              r?.routePath != null
                ? String(r.routePath)
                : r?.path != null
                ? String(r.path)
                : r?.route != null
                ? String(r.route)
                : r?.urlPath != null
                ? String(r.urlPath)
                : r?.pathname != null
                ? String(r.pathname)
                : null;

            return {
              routePath,
              views: nOrNull(r?.views ?? r?.pageViews ?? r?.hits ?? r?.count ?? null),
              sessions: nOrNull(r?.sessions ?? r?.sessionCount ?? null),
              views404: nOrNull(r?.views404 ?? r?.notFoundViews ?? r?.v404 ?? null),
              jsErrors: nOrNull(r?.jsErrors ?? r?.jsErrorCount ?? r?.errorsJs ?? null),
              apiErrors: nOrNull(r?.apiErrors ?? r?.apiErrorCount ?? r?.errorsApi ?? null),
              avgLoadMs: nOrNull(r?.avgLoadMs ?? r?.avgMs ?? r?.loadMs ?? r?.ttfbMs ?? null),
              lcpP75Ms: nOrNull(r?.lcpP75Ms ?? r?.lcpMs ?? null),
              inpP75Ms: nOrNull(r?.inpP75Ms ?? r?.inpMs ?? null),
              lastSeenISO:
                r?.lastSeenISO != null
                  ? String(r.lastSeenISO)
                  : r?.lastSeen != null
                  ? String(r.lastSeen)
                  : r?.updatedAtISO != null
                  ? String(r.updatedAtISO)
                  : null,
              issues:
                Array.isArray(r?.issues) && r.issues.length
                  ? r.issues.map((x) => String(x)).slice(0, 16)
                  : null,
            };
          })
          .filter((route) => !!route.routePath)
          .slice(0, 120)
      : [];

  const updatedAtISO =
    getString(s, "updatedAtISO") ??
    getString(s, "updatedAt") ??
    getString(rollup, "updatedAtISO") ??
    getString(summaryDict, "updatedAtISO") ??
    getString(childDict(summaryDict, "meta"), "updatedAtISO") ??
    null;

  return {
    updatedAtISO: updatedAtISO ? String(updatedAtISO) : null,

    routesObserved: nOrNull(getValue(rollup, ["routesObserved", "routes_observed", "routes", "pagesObserved"])),
    uniqueRoutes: nOrNull(getValue(rollup, ["uniqueRoutes", "unique_routes", "uniquePaths", "unique_paths"])),
    pageViews: nOrNull(getValue(rollup, ["pageViews", "page_views", "views"])),
    sessions: nOrNull(getValue(rollup, ["sessions", "sessionCount", "sessionsCount"])),

    routeChanges: nOrNull(
      getValue(rollup, ["routeChanges", "route_changes", "routeChangeCount", "route_change_events"])
    ),
    spaNavigations: nOrNull(getValue(rollup, ["spaNavigations", "spa_navigations", "spaRouteChanges"])),

    views404Pct: nOrNull(getValue(rollup, ["views404Pct", "views_404_pct", "notFoundPct"])),
    jsErrorPct: nOrNull(getValue(rollup, ["jsErrorPct", "js_error_pct", "jsErrorsPct"])),
    slowRoutePct: nOrNull(getValue(rollup, ["slowRoutePct", "slow_route_pct", "slowRoutesPct"])),

    views404Count: nOrNull(getValue(rollup, ["views404Count", "views_404_count", "notFoundCount"])),
    jsErrorCount: nOrNull(getValue(rollup, ["jsErrorCount", "js_error_count", "jsErrorsCount"])),
    slowRouteCount: nOrNull(getValue(rollup, ["slowRouteCount", "slow_route_count", "slowRoutesCount"])),

    topRoutes: rows,
  };
}

/* =========================
  Trend helpers (re-use summary trend arrays if present)
========================= */
type TrendPoint = { day: string; sessions: number; views404: number };

function toISODateUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function parseISODate(s: string) {
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
function normalizeTrendDays(raw: unknown, windowDays: number): TrendPoint[] {
  const arr = Array.isArray(raw) ? raw : [];
  const points: TrendPoint[] = arr
    .map((pRaw) => {
      const p = asDict(pRaw);
      return {
        day:
          p?.day != null
            ? String(p.day).slice(0, 10)
            : p?.date != null
            ? String(p.date).slice(0, 10)
            : "",
        sessions: n(p?.sessions ?? p?.views ?? p?.pageViews ?? 0, 0),
        views404: n(p?.views404 ?? p?.notFoundViews ?? p?.v404 ?? 0, 0),
      };
    })
    .filter((p) => !!p.day);

  if (!points.length) return [];

  const last = parseISODate(points[points.length - 1].day) || new Date();
  const start = addDaysUTC(last, -(windowDays - 1));

  const byDay = new Map(points.map((p) => [p.day, p]));
  const out: TrendPoint[] = [];
  for (let i = 0; i < windowDays; i++) {
    const day = toISODateUTC(addDaysUTC(start, i));
    const p = byDay.get(day);
    out.push({ day, sessions: p ? n(p.sessions, 0) : 0, views404: p ? n(p.views404, 0) : 0 });
  }
  return out;
}

function svgBars(series: number[], w: number, h: number, pad = 10) {
  const max = Math.max(1, ...series);
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const nBars = Math.max(1, series.length);
  const gap = Math.max(2, Math.floor(innerW / nBars) * 0.22);
  const barW = Math.max(3, Math.floor((innerW - gap * (nBars - 1)) / nBars));

  let x = pad;
  const rects: string[] = [];
  for (let i = 0; i < nBars; i++) {
    const v = series[i] ?? 0;
    const bh = Math.max(1, Math.round((v / max) * innerH));
    const y = pad + (innerH - bh);
    rects.push(`<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="6" ry="6" />`);
    x += barW + gap;
  }
  return rects.join("");
}

function svgLinePath(series: number[], w: number, h: number, pad = 10) {
  const max = Math.max(1, ...series);
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const nPts = Math.max(1, series.length);
  const step = nPts > 1 ? innerW / (nPts - 1) : 0;

  const pts: Array<[number, number]> = [];
  for (let i = 0; i < nPts; i++) {
    const v = series[i] ?? 0;
    const x = pad + step * i;
    const y = pad + (innerH - (v / max) * innerH);
    pts.push([x, y]);
  }

  if (!pts.length) return "";
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
  return d;
}

/* =========================
  Tone (bad=red, ok=lime, good=blue)
========================= */
type Tone = "good" | "ok" | "bad";

function toneFromIssuePct(pct: number | null): Tone {
  if (pct == null) return "ok";
  if (pct <= 1) return "good";
  if (pct <= 5) return "ok";
  return "bad";
}

function postureLabel(routes: RoutesPayload): { label: string; tone: Tone } {
  const cov = routes.uniqueRoutes ?? routes.routesObserved ?? null;
  const js = routes.jsErrorPct ?? null;
  const nf = routes.views404Pct ?? null;
  const slow = routes.slowRoutePct ?? null;

  const hasCoverage = cov != null && cov >= 25;
  const lowRisk = (js ?? 0) <= 1 && (nf ?? 0) <= 1 && (slow ?? 0) <= 5;

  if (hasCoverage && lowRisk) return { label: "Elite", tone: "good" };
  if ((js ?? 0) <= 5 && (nf ?? 0) <= 5 && (slow ?? 0) <= 10) return { label: "Stable", tone: "ok" };
  if ((js ?? 0) <= 10 && (nf ?? 0) <= 10) return { label: "At Risk", tone: "bad" };
  return { label: "Critical", tone: "bad" };
}

function routeChips(r: RouteRow) {
  const chips: string[] = [];
  if ((r.views404 ?? 0) > 0) chips.push("404 hot");
  if ((r.jsErrors ?? 0) > 0) chips.push("JS unstable");
  if ((r.apiErrors ?? 0) > 0) chips.push("API errors");
  if ((r.avgLoadMs ?? 0) >= 3000) chips.push("Slow");
  if ((r.inpP75Ms ?? 0) >= 500) chips.push("High INP");
  if (Array.isArray(r.issues)) chips.push(...r.issues.slice(0, 4));
  return chips.slice(0, 6);
}

export default async function RoutesPage({ searchParams }: PageProps) {
  noStore();
  const sp = await searchParams;

  const range = (typeof sp?.range === "string" ? sp.range : "24h") as RangeKey;
  const pathParam = typeof sp?.path === "string" ? sp.path : "";

  const analyticsContext = await resolveAnalyticsConsoleContext({
    searchParams: sp,
    defaultRange: range,
    pathname: "/routes",
  });
  const sites = analyticsContext.sites;
  const activeSite = analyticsContext.activeSite;
  const projectId = analyticsContext.projectId;

  const summary = analyticsContext.summary as ProjectSummaryWithTrend | null;
  let routes: RoutesPayload = {};
  let trend: TrendPoint[] = [];

  if (summary) {
    routes = normalizeRoutesFromSummary(summary);

    const rawTrend = range === "30d" ? summary?.trend30d ?? summary?.trend ?? null : summary?.trend7d ?? summary?.trend ?? null;
    trend = normalizeTrendDays(rawTrend, range === "24h" ? 7 : range === "7d" ? 7 : range === "14d" ? 14 : 30);
  }

  const summaryDict = asDict(summary);
  const summaryMetaDict = childDict(summaryDict, "meta");
  const updatedAtISO =
    routes.updatedAtISO ??
    getString(summaryDict, "updatedAtISO") ??
    getString(summaryDict, "updatedAt") ??
    getString(summaryMetaDict, "updatedAtISO") ??
    null;
  const updatedAtLabel = updatedAtISO ? String(updatedAtISO).replace("T", " ").replace("Z", " UTC").slice(0, 19) : "—";

  function hrefWith(next: Partial<{ range: RangeKey; site: string; path: string }>) {
    const p = new URLSearchParams();
    p.set("range", next.range || range);
    p.set("site", next.site || activeSite.id);
    if (next.path || pathParam) p.set("path", next.path || pathParam);
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  const posture = postureLabel(routes);

  const LIVE_TZ = "America/Los_Angeles";

  const top = (routes.topRoutes || []).slice(0, 40);
  const selected =
    pathParam && top.length
      ? top.find((r) => String(r.routePath || "") === pathParam) || null
      : null;

  const w = 980;
  const h = 210;
  const sessionsSeries = trend.map((p) => p.sessions);
  const v404Series = trend.map((p) => p.views404);

  const cov404Tone = toneFromIssuePct(routes.views404Pct ?? null);
  const jsTone = toneFromIssuePct(routes.jsErrorPct ?? null);
  const slowTone = toneFromIssuePct(routes.slowRoutePct ?? null);

  const reportCsv = buildRoutesReportCSV({
    siteLabel: activeSite.label || "Site",
    siteUrl: activeSite.url || "",
    range,
    updatedAtLabel,
    routesObserved: routes.routesObserved ?? null,
    uniqueRoutes: routes.uniqueRoutes ?? null,
    pageViews: routes.pageViews ?? null,
    routeChanges: (routes.routeChanges ?? routes.spaNavigations) ?? null,
    topRoutes: top,
  });
  void reportCsv;
  const reportParams = new URLSearchParams();
  reportParams.set("module", "routes");
  reportParams.set("projectId", projectId);
  reportParams.set("range", range);
  if (activeSite.id && activeSite.id !== "none") reportParams.set("siteId", activeSite.id);
  if (activeSite.url) reportParams.set("origin", activeSite.url);
  if (pathParam) reportParams.set("path", pathParam);
  const reportHref = `/dashboard/report?${reportParams.toString()}`;
  const reportFileName = `routes-report-${toSlug(activeSite.label || activeSite.id || "site")}-${range}.html`;

  return (
    <AppShell title="Workspace" subtitle="Workspace command center">
      <div className="err-page">
        <div className="cb-console">

          {/* HEADER */}
          <header className="routes-head">
            <div className="routes-head-left">
              <div className="routes-titleblock">
                <h1 className="routes-h1">Routes Intelligence</h1>
                <p className="routes-sub">
                  Route-level visibility for the modern web: paths, performance, faults, and recovery posture.
                </p>
              </div>

              <div className="routes-meta" />
            </div>

            <div className="routes-head-right" aria-label="Controls">
              <DashboardToolsControls
                containerClassName="routes-controls"
                rangeLabelClassName="routes-range"
                rangeLabelTextClassName="routes-range-label"
                rangeSelectClassName="routes-range-select"
                buttonClassName="cb-tool-pill"
                range={range}
                path={pathParam}
                sites={sites}
                selectedSiteId={activeSite.id}
                reportHref={reportHref}
                reportFileName={reportFileName}
              />
            </div>
          </header>

          <br />
          <br />
          <br />
          <br />

          {/* HERO METRICS */}
          <section className="routes-grid" aria-label="Routes rollups">
            <article className={`cb-card tone-${posture.tone}`}>
              <div className="cb-card-top">
                <div className="cb-card-label">Routes Observed</div>
                <div className="cb-card-metric">{fmtInt(routes.routesObserved)}</div>
              </div>
              <br />
              <div className="cb-card-sub">Total route rows ingested for the selected target and range.</div>
            </article>

            <article className="cb-card">
              <div className="cb-card-top">
                <div className="cb-card-label">Unique Routes</div>
                <div className="cb-card-metric">{fmtInt(routes.uniqueRoutes)}</div>
              </div>
              <br />
              <div className="cb-card-sub">Distinct paths seen (deduped) — ideal for coverage and discovery.</div>
            </article>

            <article className="cb-card">
              <div className="cb-card-top">
                <div className="cb-card-label">Page Views</div>
                <div className="cb-card-metric">{fmtInt(routes.pageViews)}</div>
              </div>
              <br />
              <div className="cb-card-sub">Total page views attributed to observed routes.</div>
            </article>

            <article className="cb-card">
              <div className="cb-card-top">
                <div className="cb-card-label">Route Changes</div>
                <div className="cb-card-metric">{fmtInt(routes.routeChanges ?? routes.spaNavigations)}</div>
              </div>
              <br />
              <div className="cb-card-sub">Client-side navigation events (SPA) captured by CavBot Analytics.</div>
            </article>
          </section>

          <br />

          {/* QUALITY + FAULTS */}
          <section className="routes-split" aria-label="Route quality">
            <article className="cb-card cb-card-pad">
              <div className="cb-card-head">
                <div>
                  <h2 className="cb-h2">Fault Surface</h2>
                  <p className="cb-sub">Which routes are damaging trust, conversion, and crawl stability.</p>
                </div>
              </div>

              <br />

              <div className="routes-mini-grid routes-mini-grid-compact">
                <div className={`routes-mini routes-mini-compact tone-${cov404Tone}`}>
                  <div className="routes-mini-k">404 Views</div>
                  <div className="routes-mini-v">{fmtPct(routes.views404Pct)}</div>
                  <div className="routes-mini-sub">{fmtInt(routes.views404Count)} views affected</div>
                </div>

                <div className={`routes-mini routes-mini-compact tone-${jsTone}`}>
                  <div className="routes-mini-k">JS Error Rate</div>
                  <div className="routes-mini-v">{fmtPct(routes.jsErrorPct)}</div>
                  <div className="routes-mini-sub">{fmtInt(routes.jsErrorCount)} errors observed</div>
                </div>

                <div className={`routes-mini routes-mini-compact tone-${slowTone}`}>
                  <div className="routes-mini-k">Slow Routes</div>
                  <div className="routes-mini-v">{fmtPct(routes.slowRoutePct)}</div>
                  <div className="routes-mini-sub">{fmtInt(routes.slowRouteCount)} routes flagged</div>
                </div>
              </div>
            </article>

            <article className="cb-card cb-card-pad">
              <div className="cb-card-head">
                <div>
                  <h2 className="cb-h2">Route Activity</h2>
                  <p className="cb-sub">Sessions trend with a 404 overlay.</p>
                </div>
              </div>

              <br />

              {trend.length ? (
                <div className="routes-chartwrap" aria-label="Trend chart">
                  <div className="routes-chartmeta">
                    <span className="routes-pill">
                      Window: <b>{range === "24h" ? "7D" : range.toUpperCase()}</b>
                    </span>
                    <span className="routes-pill">
                      Points: <b>{fmtInt(trend.length)}</b>
                    </span>
                  </div>

                  <br />

                  <div className="routes-chart">
                    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="210" role="img" aria-label="Sessions bars with 404 line">
                      <g className="routes-bars" dangerouslySetInnerHTML={{ __html: svgBars(sessionsSeries, w, h, 12) }} />
                      <path className="routes-line" d={svgLinePath(v404Series, w, h, 12)} />
                    </svg>
                    <div className="routes-chartlegend">
                      <span className="routes-legend-item">
                        <span className="routes-dot routes-dot-bars" /> Sessions
                      </span>
                      <span className="routes-legend-item">
                        <span className="routes-dot routes-dot-line" /> 404 views
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="routes-empty routes-empty-trend">
                  <div className="routes-empty-title">No trend data available yet.</div>
                  <div className="routes-empty-sub">
                    As traffic arrives, CavBot will build a route activity timeline (sessions + 404 overlay) without synthetic filler.
                  </div>
                </div>
              )}
            </article>
          </section>

          <br />
          <br />

          {/* ROUTES TABLE */}
          <section className="cb-card cb-card-pad" aria-label="Route table">
            <div className="cb-card-head routes-headrow">
              <div>
                <h2 className="cb-h2">Top Routes</h2>
                <p className="cb-sub">Highest-impact paths with fault signals and performance hints.</p>
              </div>
              <div className="routes-pillrow routes-pillrow-right">
                <span className="routes-pill">
                  Showing: <b>{fmtInt(top.length)}</b>
                </span>
              </div>
            </div>

            <br />
            <br />

            {top.length ? (
              <div className="routes-tablewrap">
                <table className="routes-table" aria-label="Routes table">
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th className="t-right">Views</th>
                      <th className="t-right">Sessions</th>
                      <th className="t-right">404</th>
                      <th className="t-right">JS</th>
                      <th className="t-right">Avg Load</th>
                      <th>Signals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((r, i) => {
                      const path = String(r.routePath || "—");
                      const sigs = routeChips(r);
                      const isOn = selected && selected.routePath === r.routePath;
                      return (
                        <tr key={`${path}-${i}`} className={isOn ? "is-on" : ""}>
                          <td className="mono">
                            <a className="routes-link" href={hrefWith({ path })}>
                              {path}
                            </a>
                          </td>
                          <td className="t-right">{fmtInt(r.views)}</td>
                          <td className="t-right">{fmtInt(r.sessions)}</td>
                          <td className="t-right">{fmtInt(r.views404)}</td>
                          <td className="t-right">{fmtInt(r.jsErrors)}</td>
                          <td className="t-right">{fmtMs(r.avgLoadMs)}</td>
                          <td>
                            <div className="routes-chips">
                              {sigs.length ? (
                                sigs.map((s, idx) => (
                                  <span key={idx} className="routes-chip-mini">
                                    {s}
                                  </span>
                                ))
                              ) : (
                                <span className="routes-chip-mini tone-good">Clean</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="routes-empty">
                <div className="routes-empty-title">No routes available yet.</div>
                <div className="routes-empty-sub">
                  Once CavBot is ingesting route telemetry for this target, this table will populate with real paths.
                </div>
              </div>
            )}
          </section>

          <br /><br />

          {/* DEEP READ */}
          <section className="routes-deep" aria-label="Route deep read">
            <article className="cb-card cb-card-pad">
              <div className="cb-card-head">
                <div>
                  <h2 className="cb-h2">Deep Read</h2>
                  <p className="cb-sub">Focused view for one route: what it is, what it’s doing, and what it’s breaking.</p>
                </div>
                <div className="routes-pillrow routes-pillrow-right">
                  {pathParam ? (
                    <a className="routes-pill routes-pill-link" href={hrefWith({ path: "" })}>
                      Clear
                    </a>
                  ) : (
                    <span className="routes-pill">
                      Select a route
                    </span>
                  )}
                </div>
              </div>

              <br />

              {selected ? (
                <div className="routes-deep-grid">
                  <div className="routes-field">
                    <div className="routes-field-k">Route</div>
                    <br />
                    <div className="routes-field-v mono">{selected.routePath || "—"}</div>
                  </div>

                  <div className="routes-field">
                    <div className="routes-field-k">Resolved URL</div>
                    <br />
                    <div className="routes-field-v mono">
                      {(() => {
                        const base = activeSite.url || "";
                        const p = String(selected.routePath || "");
                        if (!base || !p) return "—";
                        try {
                          const u = new URL(base);
                          const joined = new URL(p.startsWith("/") ? p : `/${p}`, u.origin);
                          return joined.toString();
                        } catch {
                          return `${base}${p.startsWith("/") ? "" : "/"}${p}`;
                        }
                      })()}
                    </div>
                  </div>

                  <div className="routes-deep-mini-grid">
                    <div className="routes-mini">
                      <div className="routes-mini-k">Views</div>
                      <div className="routes-mini-v">{fmtInt(selected.views)}</div>
                      <br />
                      <div className="routes-mini-sub">Route demand for this range.</div>
                    </div>

                    <div className="routes-mini">
                      <div className="routes-mini-k">404 Views</div>
                      <div className="routes-mini-v">{fmtInt(selected.views404)}</div>
                      <br />
                      <div className="routes-mini-sub">Broken navigation impact.</div>
                    </div>

                    <div className="routes-mini">
                      <div className="routes-mini-k">JS Errors</div>
                      <div className="routes-mini-v">{fmtInt(selected.jsErrors)}</div>
                      <br />
                      <div className="routes-mini-sub">Client instability signals.</div>
                    </div>

                    <div className="routes-mini">
                      <div className="routes-mini-k">Avg Load</div>
                      <div className="routes-mini-v">{fmtMs(selected.avgLoadMs)}</div>
                      <br />
                      <div className="routes-mini-sub">Observed page load time (when available).</div>
                    </div>
                  </div>

                  <div className="routes-notes">
                    <div className="routes-notes-k">Signals</div>
                    <br />
                    <div className="routes-chips">
                      {routeChips(selected).length ? (
                        routeChips(selected).map((s, idx) => (
                          <span key={idx} className="routes-chip-mini">
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="routes-chip-mini tone-good">Clean</span>
                      )}
                    </div>

                    <br />

                    <div className="routes-notes-sub">
                      CavBot only reports what the client actually experiences. If these are zeros, you’ve successfully wired the surface — now
                      send traffic and CavBot will reveal the route story.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="routes-empty">
                  <div className="routes-empty-title">No route selected.</div>
                  <div className="routes-empty-sub">Click a route from Top Routes to open a deep read panel here.</div>
                </div>
              )}
            </article>
          </section>

          <br /><br />

          <CavAiRouteRecommendations
            panelId="routes"
            snapshot={summary}
            origin={activeSite.url || ""}
            pagesScanned={routes.routesObserved ?? routes.uniqueRoutes ?? top.length ?? 1}
            title="CavBot Reliability Priorities"
            subtitle="Deterministic route, 404, and navigation resilience recommendations."
            pillars={["reliability", "ux", "performance", "engagement"]}
          />

          {/* LIVE time ticker */}
          <Script id="cb-routes-live-time" strategy="afterInteractive">
            {`
(function(){
  try{
    if(window.__cbRoutesLiveTimeInt) clearInterval(window.__cbRoutesLiveTimeInt);
  }catch(e){}
  var tz = ${JSON.stringify(LIVE_TZ)};
  function fmt(){
    try{
      var d = new Date();
      return d.toLocaleString("en-US", {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZoneName: "short"
      });
    }catch(e){
      return new Date().toLocaleString();
    }
  }
  function tick(){
    var el = document.getElementById("cb-live-time");
    if(el) el.textContent = fmt();
  }
  tick();
  window.__cbRoutesLiveTimeInt = setInterval(tick, 10000);
})();`}
          </Script>

        </div>
      </div>
    </AppShell>
  );
}
