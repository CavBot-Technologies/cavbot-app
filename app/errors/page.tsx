// app/errors/page.tsx
/// <reference types="react" />
/// <reference types="react-dom" />
import "./errors.css";

import Image from "next/image";
import Script from "next/script";
import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import AppShell from "@/components/AppShell";
import CavAiRouteRecommendations from "@/components/CavAiRouteRecommendations";
import { resolveAnalyticsConsoleContext } from "@/lib/analyticsConsole.server";
import { gateModuleAccess } from "@/lib/moduleGate.server";
import { buildErrorInsights } from "@/lib/errors/errorInsights";

declare global {
  // JSX intrinsic element augmentation is one of the few valid namespace uses in TS.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      // This page renders some custom elements in scripts; keep permissive.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [elemName: string]: any;
    }
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type RangeKey = "24h" | "7d" | "14d" | "30d";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : null;
}

function n(x: unknown, fallback = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}
function nOrNull(x: unknown) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}
function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
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

type MaybeRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MaybeRecord {
  return typeof value === "object" && value !== null;
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

  type TrendPoint = {
    day: string;
    jsErrors: number | null;
    apiErrors: number | null;
    views404: number | null;
  };

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
          .filter((point): point is TrendPoint => Boolean(point))
      : [];

  const groups =
    Array.isArray(groupsRaw) && groupsRaw.length
      ? groupsRaw
          .map((entry) => {
            if (!isRecord(entry)) return null;
            const fingerprint = String(
              entry.fingerprint ?? entry.fp ?? entry.id ?? ""
            ).slice(0, 120);
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
              firstSeenISO:
                entry.firstSeenISO != null ? String(entry.firstSeenISO) : entry.firstSeen != null ? String(entry.firstSeen) : null,
              lastSeenISO:
                entry.lastSeenISO != null ? String(entry.lastSeenISO) : entry.lastSeen != null ? String(entry.lastSeen) : null,
            };
          })
          .filter((group): group is ErrorGroup => Boolean(group && group.fingerprint))
      : [];

  const recent =
    Array.isArray(recentRaw) && recentRaw.length
      ? recentRaw
          .map((entry) => {
            if (!isRecord(entry)) return null;
            return {
              tsISO:
                entry.tsISO != null
                  ? String(entry.tsISO)
                  : entry.event_timestamp != null
                  ? String(entry.event_timestamp)
                  : null,
              kind: entry.kind != null ? String(entry.kind) : null,
              message: entry.message != null ? String(entry.message) : null,
              routePath:
                entry.routePath != null
                  ? String(entry.routePath)
                  : entry.route_path != null
                  ? String(entry.route_path)
                  : null,
              fileName: entry.fileName != null ? String(entry.fileName) : null,
              line: entry.line != null ? Number(entry.line) : null,
              column: entry.column != null ? Number(entry.column) : null,
              status: entry.status != null ? Number(entry.status) : null,
              method: entry.method != null ? String(entry.method) : null,
              urlPath: entry.urlPath != null ? String(entry.urlPath) : null,
              fingerprint: entry.fingerprint != null ? String(entry.fingerprint) : null,
            };
          })
          .filter((entry): entry is ErrorEvent => Boolean(entry))
          .slice(0, 80)
      : [];

  const meta = asRecord(record?.meta);
  const updatedAtISO = record?.updatedAtISO ?? e?.updatedAtISO ?? e?.updatedAt ?? meta?.updatedAtISO ?? null;

  return { updatedAtISO: updatedAtISO != null ? String(updatedAtISO) : null, totals, trend, groups, recent };
}

type DeepFilter = "all" | "js" | "api" | "404" | "seo" | "stability";

function classifyGroup(g: ErrorGroup): DeepFilter {
  const kind = String(g.kind || "").toLowerCase();
  const msg = String(g.message || "").toLowerCase();
  const status = Number(g.status ?? 0);

  if (status === 404 || kind.includes("404") || msg.includes("not found")) return "404";
  if (kind.includes("api") || msg.includes("fetch") || status >= 400) return "api";
  if (kind.includes("reject") || msg.includes("unhandledrejection")) return "stability";
  if (kind.includes("js") || msg.includes("script") || msg.includes("typeerror") || msg.includes("referenceerror"))
    return "js";
  if (msg.includes("seo") || msg.includes("robots") || msg.includes("canonical")) return "seo";

  return "all";
}

function classifyEvent(ev: ErrorEvent): DeepFilter {
  const kind = String(ev.kind || "").toLowerCase();
  const msg = String(ev.message || "").toLowerCase();
  const status = Number(ev.status ?? 0);

  if (status === 404 || kind.includes("404") || msg.includes("not found")) return "404";
  if (kind.includes("api") || msg.includes("fetch") || status >= 400) return "api";
  if (kind.includes("reject") || msg.includes("unhandledrejection")) return "stability";
  if (kind.includes("js") || msg.includes("script") || msg.includes("typeerror") || msg.includes("referenceerror"))
    return "js";
  if (msg.includes("seo") || msg.includes("robots") || msg.includes("canonical")) return "seo";

  return "all";
}

function seriesMax(trend: ErrorsPayload["trend"]) {
  let m = 0;
  for (const p of trend || []) {
    m = Math.max(m, n(p?.jsErrors, 0), n(p?.apiErrors, 0), n(p?.views404, 0));
  }
  return m || 1;
}

function svgLine(values: number[], w: number, h: number, pad: number, max: number) {
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const count = Math.max(1, values.length);

  const pts = values.map((v, i) => {
    const x = pad + innerW * (count === 1 ? 0 : i / (count - 1));
    const y = pad + innerH * (1 - clamp(v / max, 0, 1));
    return { x, y };
  });

  let d = "";
  for (let i = 0; i < pts.length; i++)
    d += `${i === 0 ? "M" : "L"} ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)} `;
  return d.trim();
}

export default async function ErrorsPage({ searchParams }: PageProps) {
  noStore();
  const sp = await searchParams;
  const requestHeaders = await headers();
  const req = new Request("https://cavbot.local/errors", {
    headers: new Headers(requestHeaders),
  });

  await gateModuleAccess(req, "errors");

  const range = (typeof sp?.range === "string" ? sp.range : "24h") as RangeKey;
  const fp = typeof sp?.fp === "string" ? sp.fp.slice(0, 180) : "";

  const analyticsContext = await resolveAnalyticsConsoleContext({
    searchParams: sp,
    defaultRange: range,
    pathname: "/errors",
  });
  const sites = analyticsContext.sites;
  const activeSite = analyticsContext.activeSite;
  const projectId = analyticsContext.projectId;
  let summary: unknown = null;
  let errors: ErrorsPayload = { updatedAtISO: null, totals: {}, trend: [], groups: [], recent: [] };

  if (analyticsContext.summary) {
    summary = analyticsContext.summary;
    errors = normalizeErrorsFromSummary(summary);
  }

  // Logic-only enrichments (no UI changes): deterministic spikes, hints, risk scoring, and action generation.
  const insights = buildErrorInsights(errors, { selectedFingerprint: fp });
  errors = { ...errors, groups: insights.groups, recent: insights.recent };
  const actions = insights.actions;
  const spikes = insights.spikes;
  const topDrivers = insights.topDrivers;
  const diagnosis = insights.diagnosis;
  void actions;
  void spikes;
  void topDrivers;
  void diagnosis;

  const trend = errors.trend || [];
  const max = seriesMax(trend);

  const valuesJS = trend.map((p) => n(p?.jsErrors, 0));
  const valuesAPI = trend.map((p) => n(p?.apiErrors, 0));
  const values404 = trend.map((p) => n(p?.views404, 0));

  const W = 920;
  const H = 220;
  const PAD = 18;

  const dJS = svgLine(valuesJS, W, H, PAD, max);
  const dAPI = svgLine(valuesAPI, W, H, PAD, max);
  const d404 = svgLine(values404, W, H, PAD, max);

  const selectedGroup = fp ? (errors.groups || []).find((g) => g.fingerprint === fp) : null;
  function hrefWith(next: Partial<{ range: RangeKey; site: string; fp: string }>) {
    const p = new URLSearchParams();
    p.set("module", "errors");
    p.set("projectId", projectId);
    p.set("range", next.range || range);
    const siteId = next.site || activeSite.id;
    if (siteId && siteId !== "none") p.set("siteId", siteId);
    if (next.fp) p.set("fp", next.fp);
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  const LIVE_TZ = "America/Los_Angeles";

  return (
    <AppShell title="Workspace" subtitle="Workspace command center">
      <div className="err-page">
        <div className="cb-console">
          {/* Header row (match Console rhythm: left identity, right controls) */}
          <header className="err-head">
            <div className="err-head-left">
              <h1 className="err-h1">Error Intelligence</h1>
              <p className="seo-sub">JS failures, API errors, 404 volume, and stability.</p>
            </div>

            <div className="err-head-right" aria-label="Controls">
              <label className="seo-range" aria-label="Timeline">
                <span className="seo-range-label">Timeline</span>
                <select className="seo-range-select" defaultValue={range} data-range-select>
                  <option value="24h">24H</option>
                  <option value="7d">7D</option>
                  <option value="14d">14D</option>
                  <option value="30d">30D</option>
                </select>
              </label>

              {/* Tools pill (wrench icon, Console-style) */}
              <button
                className="cb-tool-pill"
                type="button"
                data-tools-open
                aria-haspopup="dialog"
                aria-expanded="false"
                aria-label="Dashboard tools"
                title="Dashboard tools"
              >
                <Image
                  src="/icons/app/tools-svgrepo-com.svg"
                  alt=""
                  width={16}
                  height={16}
                  className="cb-tool-ico cb-tools-icon"
                  aria-hidden="true"
                  unoptimized
                />
              </button>
            </div>
          </header>

          <br />
          <br />
          <br />
          <br />

          {/* Totals (Console cards) */}
          <section className="err-grid" aria-label="Totals">
            <article className="cb-card">
              <div className="cb-card-top">
                <div className="cb-card-label">JavaScript Errors</div>
                <div className="cb-card-metric">{fmtInt(errors.totals?.jsErrors)}</div>
              </div><br />
              <div className="cb-card-sub">Client-side exceptions and rejected promises.</div>
            </article>

            <article className="cb-card">
              <div className="cb-card-top">
                <div className="cb-card-label">API Errors</div>
                <div className="cb-card-metric">{fmtInt(errors.totals?.apiErrors)}</div>
              </div><br />
              <div className="cb-card-sub">Failed requests and error statuses.</div>
            </article>

            <article className="cb-card">
              <div className="cb-card-top">
                <div className="cb-card-label">404 Views</div>
                <div className="cb-card-metric">{fmtInt(errors.totals?.views404)}</div>
              </div><br />
              <div className="cb-card-sub">Broken routes impacting recovery posture.</div>
            </article>

            <article className="cb-card">
              <div className="cb-card-top">
                <div className="cb-card-label">Crash-Free Sessions</div>
                <div className="cb-card-metric">{fmtPct(errors.totals?.crashFreeSessionsPct)}</div>
              </div><br />
              <div className="cb-card-sub">Stability percentage across sessions.</div>
            </article>
          </section>
          <br />
          {/* Drivers chart (Console chart glass) */}
          <section className="cb-card cb-card-pad err-chartcard" aria-label="Drivers chart">
            <div className="cb-card-head">
              <div>
                <h2 className="cb-h2">Drivers</h2>
                <p className="cb-sub">Compare impact across the selected range.</p>
              </div>

              <div className="err-legend" aria-label="Legend">
                <span className="err-leg">
                  <i className="err-dot dot-js" aria-hidden="true" /> JS
                </span>
                <span className="err-leg">
                  <i className="err-dot dot-api" aria-hidden="true" /> API
                </span>
                <span className="err-leg">
                  <i className="err-dot dot-404" aria-hidden="true" /> 404
                </span>
              </div>
            </div>

            <div className="err-chartwrap">
              <svg className="err-lines" viewBox={`0 0 ${W} ${H}`} aria-label="Drivers line chart">
                <g opacity="0.26">
                  {Array.from({ length: 6 }).map((_, i) => {
                    const y = (H / 5) * i;
                    return <line key={i} x1={0} y1={y} x2={W} y2={y} stroke="rgba(255,255,255,0.10)" strokeWidth="1" />;
                  })}
                </g>

                <path d={dJS} className="err-line err-line-js" />
                <path d={dAPI} className="err-line err-line-api" />
                <path d={d404} className="err-line err-line-404" />
              </svg>
            </div>
          </section>
<br />
          {/* Groups + Stream split (Console layout) */}
          <section className="err-split" aria-label="Groups and stream">
            <article className="cb-card cb-card-pad">
              <div className="cb-card-head err-headrow">
                <div>
                  <h2 className="cb-h2">Top Groups</h2>
                  <p className="cb-sub">Grouped signatures for fast triage.</p>
                </div>

                <div className="err-filter">
                  <label className="err-filter-label" htmlFor="cb-deep-filter">
                    Filter
                  </label>
                  <select id="cb-deep-filter" className="err-filter-select" defaultValue="all" data-deep-filter>
                    <option value="all">All</option>
                    <option value="js">JavaScript</option>
                    <option value="api">API</option>
                    <option value="404">404</option>
                    <option value="seo">SEO</option>
                    <option value="stability">Stability</option>
                  </select>
                </div>
              </div>
<br /><br />
              {(errors.groups || []).length ? (
                <div className="err-tablewrap">
                  <table className="err-table" aria-label="Top error groups">
                    <thead>
                      <tr>
                        <th>Group</th>
                        <th className="t-right">Hits</th>
                        <th className="t-right">Sessions</th>
                        <th>Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(errors.groups || []).slice(0, 16).map((g) => {
                        const msg = (g.message || "").slice(0, 110);
                        const last = g.lastSeenISO ? String(g.lastSeenISO).replace("T", " ").slice(0, 19) : "—";
                        const cat = classifyGroup(g);

                        return (
                          <tr key={g.fingerprint} data-cat={cat} className={fp === g.fingerprint ? "is-selected" : ""}>
                            <td>
                              <a className="err-link" href={hrefWith({ fp: g.fingerprint })}>
                                <div className="err-rowtitle">{msg || g.fingerprint}</div>
                                <div className="err-rowsub">
                                  {cat !== "all" ? <span className="err-chip">{cat.toUpperCase()}</span> : null}
                                  {g.routePath ? <span className="err-chip">{g.routePath}</span> : null}
                                  {g.fileName ? <span className="err-chip">{g.fileName}</span> : null}
                                  {g.status != null ? <span className="err-chip">HTTP {g.status}</span> : null}
                                </div>
                              </a>
                            </td>
                            <td className="t-right">{fmtInt(g.count)}</td>
                            <td className="t-right">{fmtInt(g.sessions)}</td>
                            <td>{last}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="err-empty">
                  <div className="err-empty-title">No groups captured for this range.</div>
                  <div className="err-empty-sub">Once traffic and monitoring are active, grouped signatures will appear here.</div>
                </div>
              )}
            </article>

            <article className="cb-card cb-card-pad">
              <div className="cb-card-head">
                <div>
                  <h2 className="cb-h2">Stream</h2>
                  <p className="cb-sub">Most recent events, with stable fingerprints.</p>
                </div>
              </div>
<br /><br />
              {(errors.recent || []).length ? (
                <div className="err-stream">
                  {(errors.recent || []).slice(0, 26).map((ev, i) => {
                    const ts = ev.tsISO ? ev.tsISO.replace("T", " ").slice(0, 19) : "—";
                    const title = ev.message || (ev.status != null ? `HTTP ${ev.status}` : "") || "Event";
                    const meta = [
                      ev.kind ? ev.kind : null,
                      ev.method ? ev.method : null,
                      ev.urlPath ? ev.urlPath : null,
                      ev.routePath ? ev.routePath : null,
                      ev.fileName ? ev.fileName : null,
                      ev.line != null ? `L${ev.line}` : null,
                    ].filter(Boolean);

                    const cat = classifyEvent(ev);
                    const isMatch = fp && ev.fingerprint && ev.fingerprint === fp;

                    return (
                      <div key={`${ev.fingerprint || "ev"}-${i}`} data-cat={cat} className={`err-stream-item ${isMatch ? "is-highlight" : ""}`}>
                        <div className="err-stream-top">
                          <div className="err-stream-title">{title}</div>
                          <div className="err-stream-ts">{ts}</div>
                        </div>

                        <div className="err-stream-meta">
                          {cat !== "all" ? <span className="err-chip">{cat.toUpperCase()}</span> : null}
                          {meta.map((m, idx) => (
                            <span key={idx} className="err-chip">
                              {m}
                            </span>
                          ))}

                          {ev.fingerprint ? (
                            <a className="err-fp" href={hrefWith({ fp: ev.fingerprint })}>
                              {ev.fingerprint}
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="err-empty">
                  <div className="err-empty-title">No events yet.</div>
                  <div className="err-empty-sub">When events are ingested, this stream becomes the live timeline.</div>
                </div>
              )}
            </article>
          </section>
<br />
          {/* Deep Read (Console card + actions) */}
          <section className="cb-card cb-card-pad err-detail" aria-label="Deep read">
            <div className="cb-card-head">
              <div>
                <h2 className="cb-h2">Deep Read</h2>
                <p className="cb-sub">A clean signature view for the selected group.</p>
              </div>
            </div>
<br /><br />
            {selectedGroup ? (
              <div className="err-detailcard">
                <div className="err-detailgrid">
                  <div>
                    <div className="err-k">Fingerprint</div>
                    <div className="err-v">{selectedGroup.fingerprint}</div>
                  </div>

                  <div>
                    <div className="err-k">Category</div>
                    <div className="err-v">{classifyGroup(selectedGroup) === "all" ? "—" : classifyGroup(selectedGroup).toUpperCase()}</div>
                  </div>

                  <div>
                    <div className="err-k">Hits</div>
                    <div className="err-v">{fmtInt(selectedGroup.count)}</div>
                  </div>

                  <div>
                    <div className="err-k">Sessions</div>
                    <div className="err-v">{fmtInt(selectedGroup.sessions)}</div>
                  </div>

                  <div className="span-2">
                    <div className="err-k">Message</div>
                    <div className="err-v">{selectedGroup.message || "—"}</div>
                  </div>

                  <div>
                    <div className="err-k">Route</div>
                    <div className="err-v">{selectedGroup.routePath || "—"}</div>
                  </div>

                  <div>
                    <div className="err-k">File</div>
                    <div className="err-v">{selectedGroup.fileName || "—"}</div>
                  </div>

                  <div>
                    <div className="err-k">First Seen</div>
                    <div className="err-v">{selectedGroup.firstSeenISO ? selectedGroup.firstSeenISO.replace("T", " ").slice(0, 19) : "—"}</div>
                  </div>

                  <div>
                    <div className="err-k">Last Seen</div>
                    <div className="err-v">{selectedGroup.lastSeenISO ? selectedGroup.lastSeenISO.replace("T", " ").slice(0, 19) : "—"}</div>
                  </div>
                </div>

                <div className="err-actions">
                  <a className="cb-btn" href={hrefWith({ fp: "" })}>
                    Clear
                  </a>

                  <a className="cb-btn cb-btn-ghost" href={`/dashboard/report${hrefWith({ fp })}`} target="_blank" rel="noreferrer">
                    Download report
                  </a>
                </div>
              </div>
            ) : (
              <div className="err-empty">
                <div className="err-empty-title">Select a group to open Deep Read.</div>
                <div className="err-empty-sub">Click any group row to inspect its signature and impact.</div>
              </div>
            )}
          </section>

          <br /><br />

          <CavAiRouteRecommendations
            panelId="errors"
            snapshot={summary}
            origin={activeSite.url || ""}
            pagesScanned={trend.length || 1}
            title="CavBot Error Priorities"
            subtitle="Deterministic reliability, route, and auth-funnel priorities for this target."
            pillars={["reliability", "ux", "performance", "engagement"]}
          />

          {/* Tools modal (Console-grade: above glass, body lock, synced links) */}
          <div className="cb-modal cb-dashboard-tools-modal" role="dialog" aria-modal="true" aria-label="Dashboard tools" hidden data-tools-modal>
            <div className="cb-modal-backdrop" data-tools-close />
            <div className="cb-modal-card" role="document">
              <div className="cb-modal-top">
                <div className="cb-modal-title">Dashboard Tools</div>
                <button className="cb-iconbtn" type="button" aria-label="Close" data-tools-close>
                  <span className="cb-closeIcon" aria-hidden="true" />
                </button>
              </div>

              <div className="cb-modal-body">
                <div className="cb-field">
                  <div className="cb-field-label">Target</div>
                  <select className="cb-select" defaultValue={activeSite.id} data-tools-site>
                    {sites.length ? (
                      sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))
                    ) : (
                      <option value="none">No sites</option>
                    )}
                  </select>
                  <div className="cb-field-hint">Select which site to analyze.</div>
                </div>

                <div className="cb-modal-actions">
                  <a className="cb-btn cb-btn-ghost" data-tools-report href={`/dashboard/report${hrefWith({ fp })}`} target="_blank" rel="noreferrer">
                    Download report
                  </a>
                  <button className="cb-btn" type="button" data-tools-apply>
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* LIVE time ticker (LA time + 10s tick) */}
          <Script id="cb-errors-live-time" strategy="afterInteractive">
  {`
(function(){
  try{
    // clear any previous interval (route nav protection)
    if(window.__cbErrorsLiveTimeInt) clearInterval(window.__cbErrorsLiveTimeInt);
  }catch(e){}

  var tz = ${JSON.stringify(LIVE_TZ)};

  function fmt(){
    try{
      var d = new Date();
      // Let the browser provide PST/PDT correctly
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
  window.__cbErrorsLiveTimeInt = setInterval(tick, 10000);
})();`}
</Script>

          {/* Tools + Deep filter wiring (guarded to prevent double-binding) */}
          <Script id="cb-errors-tools-wire" strategy="afterInteractive">
            {`
(function(){
  if(document.documentElement.dataset.cbErrorsToolsWired === "1") return;
  document.documentElement.dataset.cbErrorsToolsWired = "1";

  // Timeline select (imperative navigation; match SEO)
  var rangeSel = document.querySelector("[data-range-select]");
  if(rangeSel){
    rangeSel.addEventListener("change", function(){
      try{
        var v = String(rangeSel.value || "24h");
        var p = new URLSearchParams(window.location.search || "");
        p.set("range", v);
        window.location.search = "?" + p.toString();
      }catch(e){}
    });
  }

  var modal = document.querySelector("[data-tools-modal]");
  var openBtn = document.querySelector("[data-tools-open]");
  var closeEls = document.querySelectorAll("[data-tools-close]");
  var siteSel = document.querySelector("[data-tools-site]");
  var applyBtn = document.querySelector("[data-tools-apply]");
  var reportLink = document.querySelector("[data-tools-report]");
  var deepFilter = document.querySelector("[data-deep-filter]");

  // Hard safety: modal must NEVER be visible on first paint.
  if(modal){
    modal.hidden = true;
  }
  lockBody(false);
  if(openBtn) openBtn.setAttribute("aria-expanded","false");

  function lockBody(on){
    try{
      document.body.classList.toggle("cb-modal-open", !!on);
    }catch(e){}
  }

  function syncReportLink(){
    if(!reportLink) return;
    try{
      var p = new URLSearchParams(window.location.search || "");
      var range = p.get("range") || "24h";
      var fp = p.get("fp") || "";
      var site = (siteSel && siteSel.value) ? siteSel.value : (p.get("site") || "none");
      var projectId = ${JSON.stringify(projectId)};

      var next = new URLSearchParams();
      next.set("module", "errors");
      if(projectId) next.set("projectId", projectId);
      next.set("range", range);
      if(site && site !== "none") next.set("siteId", site);
      if(fp) next.set("fp", fp);

      reportLink.setAttribute("href", "/dashboard/report?" + next.toString());
    }catch(e){}
  }

  function open(){
    if(!modal) return;
    modal.hidden = false;
    lockBody(true);
    if(openBtn) openBtn.setAttribute("aria-expanded","true");
    try{
      syncReportLink();
      if(siteSel) siteSel.focus();
    }catch(e){}
  }

  function close(){
    if(!modal) return;
    modal.hidden = true;
    lockBody(false);
    if(openBtn) openBtn.setAttribute("aria-expanded","false");
    try{
      if(openBtn) openBtn.focus();
    }catch(e){}
  }

  if(openBtn) openBtn.addEventListener("click", open);
  closeEls.forEach(function(el){ el.addEventListener("click", close); });
  document.addEventListener("keydown", function(e){ if(e.key === "Escape") close(); });

  function apply(){
    try{
      var p = new URLSearchParams(window.location.search || "");
      var range = p.get("range") || "24h";
      var fp = p.get("fp") || "";
      var site = siteSel && siteSel.value ? siteSel.value : (p.get("site") || "none");

      var next = new URLSearchParams();
      next.set("range", range);
      next.set("site", site);
      if(fp) next.set("fp", fp);

      window.location.search = "?" + next.toString();
    }catch(e){}
  }
  if(applyBtn) applyBtn.addEventListener("click", apply);

  if(siteSel){
    siteSel.addEventListener("change", function(){
      syncReportLink();
    });
  }

  function applyDeepFilter(){
    var v = deepFilter && deepFilter.value ? deepFilter.value : "all";
    var nodes = document.querySelectorAll("[data-cat]");
    nodes.forEach(function(node){
      var cat = node.getAttribute("data-cat") || "all";
      var show = (v === "all") || (cat === v);
      node.style.display = show ? "" : "none";
    });
  }

  if(deepFilter){
    deepFilter.addEventListener("change", applyDeepFilter);
    applyDeepFilter();
  }

  syncReportLink();
})();`}
          </Script>
        </div>
      </div>
    </AppShell>
  );
}
