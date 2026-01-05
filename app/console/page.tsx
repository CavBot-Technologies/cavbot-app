// app/console/page.tsx
// CavBot Console — Glass Guardian (no external libs)
// Uses AppShell for header + sidebar. Console styles are scoped (no shell overrides).

import "./console.css";
import AppShell from "@/components/AppShell";
import { getProjectSummary } from "@/lib/cavbotApi.server";

type TrendPoint = { day: string; sessions: number; views404: number };
type TopRoute = { routePath: string; views: number };

type ConsoleMetrics = {
  pageViews24h: number;
  sessions30d: number;
  sessions40430d: number;
  badgeInteractions30d: number;
  views40430d: number;
  gameInteractions30d: number;
  catches30d: number;
  misses30d: number;
  uniqueVisitors30d: number;
  sessionsUnderGuard30d: number;
  routesMonitored: number;

  avgLcpMs: number | null;
  avgTtfbMs: number | null;
  globalCls: number | null;
  slowPagesCount: number;
  unstableLayoutPages: number;
  recoveryRate404: number | null;

  jsErrors30d: number;
  apiErrors30d: number;
  ctaClicks30d: number;
  formSubmits30d: number;
  engagementPings30d: number;
  scroll90Sessions30d: number;

  a11yAudits30d: number;
  a11yIssues30d: number;
  contrastFailures30d: number;
  keyboardNavSessions30d: number;
  focusInvisible30d: number;
  topA11yIssueTypes: Array<{ type: string; count: number }>;

  guardianScore: number;

  // Allow null so UI shows "—" instead of 0% when API hasn't populated yet
  piiRiskPercent: number | null;
  aggregationCoveragePercent: number | null;
  retentionHorizonPercent: number | null;

  trend7d: TrendPoint[];
  trend30d?: TrendPoint[];

  topRoutes: TopRoute[];
};

function n(v: unknown, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function nOrNull(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x));
}

/* ===== No-NaN formatters (company-grade guardrails) ===== */
function fmtInt(v: unknown, fallback = 0) {
  const x = n(v, fallback);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(x);
}
function fmtMs(v: unknown) {
  const x = nOrNull(v);
  if (x == null) return "—";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(x)} ms`;
}
function fmtCls(v: unknown) {
  const x = nOrNull(v);
  if (x == null) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(x);
}
function fmtPct(v: unknown, digits = 1) {
  const x = nOrNull(v);
  if (x == null) return "—";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(x)}%`;
}

function scoreLabel(score: number) {
  if (score >= 92) return { label: "Elite", hint: "Guardian posture is clean." };
  if (score >= 80) return { label: "Stable", hint: "Good coverage, watch regressions." };
  if (score >= 65) return { label: "At Risk", hint: "404 / errors are rising." };
  return { label: "Critical", hint: "Immediate stabilization needed." };
}

function parseISODate(iso: string) {
  // iso = "YYYY-MM-DD"
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function toISODateUTC(dt: Date) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addDaysUTC(dt: Date, days: number) {
  const x = new Date(dt);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function normalizeTrendDays(trend: TrendPoint[], daysWanted: number): TrendPoint[] {
  if (!Array.isArray(trend) || trend.length === 0) return [];

  // End at the last day the API gave you (keeps it “truthy”)
  const end = parseISODate(trend[trend.length - 1].day);

  const byDay = new Map<string, TrendPoint>();
  for (const t of trend) byDay.set(t.day, t);

  const out: TrendPoint[] = [];
  for (let i = daysWanted - 1; i >= 0; i--) {
    const dayISO = toISODateUTC(addDaysUTC(end, -i));
    const existing = byDay.get(dayISO);
    out.push(existing ?? { day: dayISO, sessions: 0, views404: 0 });
  }
  return out;
}

/* ===== Tone system for console posture ===== */
type Tone = "good" | "watch" | "bad";

function toneForBadgeLabel(lbl: string): Tone {
  if (lbl === "Critical") return "bad";
  if (lbl === "At Risk") return "watch";
  return "good"; // Stable + Elite
}

function toneLabel(t: Tone) {
  if (t === "good") return "Good";
  if (t === "watch") return "Watch";
  return "Bad";
}

function toneFromRate(rate: number, goodMax: number, watchMax: number): Tone {
  if (rate <= goodMax) return "good";
  if (rate <= watchMax) return "watch";
  return "bad";
}

// Lower is better -> fill more when smaller
function fillFromRate(rate: number, badAt: number) {
  const pct = 100 - (rate / Math.max(0.000001, badAt)) * 100;
  return clamp(pct, 8, 100);
}

// Higher is “more coverage” -> fill more when bigger
function fillFromCount(v: number, cap: number) {
  const pct = (v / Math.max(1, cap)) * 100;
  return clamp(pct, 8, 100);
}

function buildSeries(trend: TrendPoint[]) {
  const labels = trend.map((t) => t.day.slice(5).replace("-", "\u2011")); // MM-DD (non-breaking hyphen)
  const sessions = trend.map((t) => n(t.sessions));
  const views404 = trend.map((t) => n(t.views404));
  return { labels, sessions, views404 };
}

type LinePath = { d: string; min: number; max: number };

function svgLinePath(values: number[], w: number, h: number, pad: number): LinePath {
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1, max - min);

  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  const pts = values.map((v, i) => {
    const x = pad + innerW * (values.length === 1 ? 0 : i / (values.length - 1));
    const y = pad + innerH * (1 - (v - min) / span);
    return { x, y };
  });

  let d = "";
  for (let i = 0; i < pts.length; i++) {
    d += `${i === 0 ? "M" : "L"} ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)} `;
  }
  return { d: d.trim(), min, max };
}

type Bar = { x: number; y: number; w: number; h: number };

function svgBars(values: number[], w: number, h: number, pad: number): Bar[] {
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const count = Math.max(1, values.length);
  const max = Math.max(1, ...values);

  // Modern spacing: thicker bars, tighter gap
  const gap = Math.max(6, innerW / (count * 10));
  const barW = (innerW - gap * (count - 1)) / count;

  return values.map((v, i) => {
    const vv = Math.max(0, v);
    const bh = innerH * (vv / max);
    const x = pad + i * (barW + gap);
    const y = h - pad - bh;
    return { x, y, w: barW, h: bh };
  });
}

function isEnvMissingError(e: unknown) {
  const msg = e && typeof e === "object" && "message" in e ? String((e as any).message) : "";
  return (
    msg.includes("env vars are missing") ||
    msg.includes("Missing env vars") ||
    msg.includes("CAVBOT_API_BASE_URL") ||
    msg.includes("CAVBOT_PROJECT_KEY")
  );
}

function errText(e: unknown) {
  if (e instanceof Error) return e.message || String(e);
  return String(e);
}

function Donut({ score, label, tone }: { score: number; label: string; tone: Tone }) {
  const pct = clamp(score, 0, 100) / 100;
  const r = 46;
  const c = 2 * Math.PI * r;
  const dash = c * pct;

  const ring =
    tone === "bad"
      ? "rgba(255,120,120,0.82)"
      : tone === "watch"
      ? "rgba(185,200,90,0.80)"
      : "rgba(139,92,255,0.92)";

  return (
    <div className="cb-donut" aria-label={`Guardian Score ${fmtInt(score)} (${label})`} data-tone={tone}>
      <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={ring}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 60 60)"
        />
      </svg>

      <div className="cb-donut-center">
        <div className="cb-donut-score">{fmtInt(score)}</div>
        <div className="cb-donut-sub">{label}</div>
      </div>
    </div>
  );
}

/* ===== Hard normalize so UI never sees NaN/undefined shapes ===== */
function normalizeConsoleMetrics(raw: any): ConsoleMetrics {
  const safeTrend = (arr: any): TrendPoint[] => {
    const a = Array.isArray(arr) ? arr : [];
    return a
      .map((t) => ({
        day: typeof t?.day === "string" ? t.day : "",
        sessions: n(t?.sessions, 0),
        views404: n(t?.views404, 0),
      }))
      .filter((t) => Boolean(t.day));
  };

  const safeRoutes = (arr: any): TopRoute[] => {
    const a = Array.isArray(arr) ? arr : [];
    return a
      .map((r) => ({
        routePath: typeof r?.routePath === "string" ? r.routePath : String(r?.routePath ?? ""),
        views: n(r?.views, 0),
      }))
      .filter((r) => Boolean(r.routePath));
  };

  const safeA11yTypes = (arr: any) => {
    const a = Array.isArray(arr) ? arr : [];
    return a
      .map((x) => ({
        type: typeof x?.type === "string" ? x.type : String(x?.type ?? "Unknown"),
        count: n(x?.count, 0),
      }))
      .filter((x) => Boolean(x.type));
  };

  return {
    pageViews24h: n(raw?.pageViews24h),
    sessions30d: n(raw?.sessions30d),
    sessions40430d: n(raw?.sessions40430d),
    badgeInteractions30d: n(raw?.badgeInteractions30d),
    views40430d: n(raw?.views40430d),
    gameInteractions30d: n(raw?.gameInteractions30d),
    catches30d: n(raw?.catches30d),
    misses30d: n(raw?.misses30d),
    uniqueVisitors30d: n(raw?.uniqueVisitors30d),
    sessionsUnderGuard30d: n(raw?.sessionsUnderGuard30d),
    routesMonitored: n(raw?.routesMonitored),

    avgLcpMs: nOrNull(raw?.avgLcpMs),
    avgTtfbMs: nOrNull(raw?.avgTtfbMs),
    globalCls: nOrNull(raw?.globalCls),
    slowPagesCount: n(raw?.slowPagesCount),
    unstableLayoutPages: n(raw?.unstableLayoutPages),
    recoveryRate404: nOrNull(raw?.recoveryRate404),

    jsErrors30d: n(raw?.jsErrors30d),
    apiErrors30d: n(raw?.apiErrors30d),
    ctaClicks30d: n(raw?.ctaClicks30d),
    formSubmits30d: n(raw?.formSubmits30d),
    engagementPings30d: n(raw?.engagementPings30d),
    scroll90Sessions30d: n(raw?.scroll90Sessions30d),

    a11yAudits30d: n(raw?.a11yAudits30d),
    a11yIssues30d: n(raw?.a11yIssues30d),
    contrastFailures30d: n(raw?.contrastFailures30d),
    keyboardNavSessions30d: n(raw?.keyboardNavSessions30d),
    focusInvisible30d: n(raw?.focusInvisible30d),
    topA11yIssueTypes: safeA11yTypes(raw?.topA11yIssueTypes),

    guardianScore: n(raw?.guardianScore),

    piiRiskPercent: nOrNull(raw?.piiRiskPercent),
    aggregationCoveragePercent: nOrNull(raw?.aggregationCoveragePercent),
    retentionHorizonPercent: nOrNull(raw?.retentionHorizonPercent),

    trend7d: safeTrend(raw?.trend7d),
    trend30d: safeTrend(raw?.trend30d),

    topRoutes: safeRoutes(raw?.topRoutes),
  };
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export const runtime = "edge";
export default async function ConsolePage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const range = typeof sp?.range === "string" ? sp.range : "7d";
  const site = typeof sp?.site === "string" ? sp.site : "all";

  const SITES: Array<{ id: string; label: string; url: string }> = [
    { id: "all", label: "All Sites", url: "All monitored targets" },
    { id: "primary", label: "Primary Site", url: "https://www.cavbot.io" },
    { id: "secondary", label: "Secondary Site", url: "https://app.cavbot.io" },
    { id: "sandbox", label: "Sandbox", url: "https://staging.cavbot.io" },
  ];

  const activeSite = SITES.find((s) => s.id === site) || SITES[0];

  const hrefWith = (next: { range?: string; site?: string }) => {
    const p = new URLSearchParams();
    const r = next.range ?? range;
    const s = next.site ?? site;
    if (r) p.set("range", r);
    if (s) p.set("site", s);
    const str = p.toString();
    return str ? `?${str}` : "";
  };

  // Wire: map site -> projectId (replace ids when you have real multi-project wiring)
  const projectId = site === "secondary" ? "2" : site === "sandbox" ? "3" : "1"; // "all" + "primary" default to 1 for now

  let data: any = null;
  let loadError: unknown = null;

  try {
    // company-grade: pass range + origin, and let API decide how to aggregate
    data = await getProjectSummary(projectId, {
      range: range === "30d" ? "30d" : "7d",
      siteOrigin: site === "all" ? undefined : activeSite.url,
    });
  } catch (e) {
    loadError = e;
  }

  const metrics: ConsoleMetrics | null = data?.metrics ? normalizeConsoleMetrics(data.metrics) : null;

  const projectLabel =
    data?.project?.projectId != null ? `Project #${data.project.projectId}` : `Project ${projectId}`;

  const envMissing = Boolean(loadError && isEnvMissingError(loadError));
  const hasMetrics = Boolean(!loadError && metrics);

  const score = metrics ? n(metrics.guardianScore) : 0;
  const badge = scoreLabel(score);
  const scoreTone = toneForBadgeLabel(badge.label);

  const rawTrend =
    range === "30d" && (metrics?.trend30d?.length || 0) > 0 ? (metrics!.trend30d as TrendPoint[]) : metrics?.trend7d || [];

  const trend = normalizeTrendDays(rawTrend, range === "30d" ? 30 : 7);
  const series = buildSeries(trend);

  const W = 820;
  const H = 220;
  const PAD = 22;

  const bars = svgBars(series.sessions, W, H, PAD);

  const discoveryPct = metrics?.aggregationCoveragePercent ?? null;
  const discoveryTone = discoveryPct == null ? "watch" : discoveryPct >= 90 ? "good" : discoveryPct >= 70 ? "watch" : "bad";
  const discoveryFill = discoveryPct == null ? 0 : clamp(discoveryPct, 0, 100);

  // Scale 404 views into the same chart space (second series overlay)
  const maxSessions = Math.max(1, ...series.sessions);
  const max404 = Math.max(1, ...series.views404);
  const views404Scaled = series.views404.map((v) => (v / max404) * maxSessions * 0.92);
  const views404Path = svgLinePath(views404Scaled, W, H, PAD);

  const topRoutes = (metrics?.topRoutes || []).slice(0, 10);

  // --- CavBot Priority feedback (real, derived from metrics) ---
  const cavbotFeedback = (() => {
    const issues = {
      contrast: n(metrics?.contrastFailures30d),
      focus: n(metrics?.focusInvisible30d),
      unstable: n(metrics?.unstableLayoutPages),
      slow: n(metrics?.slowPagesCount),
      views404: n(metrics?.views40430d),
      sessions: n(metrics?.sessions30d),
      js: n(metrics?.jsErrors30d),
      api: n(metrics?.apiErrors30d),
      coverage: n(metrics?.aggregationCoveragePercent, 0),
      recovery: n(metrics?.recoveryRate404, 0),
    };

    const rate404Pct = issues.sessions > 0 ? (issues.views404 / issues.sessions) * 100 : 0;

    if (issues.contrast > 0) {
      return {
        tone: "bad" as Tone,
        headline: `Contrast failures are blocking trust (${fmtInt(issues.contrast)})`,
        body: "Your audits are flagging low-contrast text and rails. This makes the console feel “off” even if the data is strong.",
        steps: [
          "Raise label + pill text contrast (targets: small text ≥ 4.5:1, UI chrome ≥ 3:1).",
          "Standardize one “on-dark” text token for labels + microcopy (stop accidental gray drift).",
          "Re-run audits on the highest-traffic routes first (use Top Routes below as the order).",
        ],
        meta: `Coverage ${fmtPct(issues.coverage, 0)} · Target ${activeSite.url}`,
      };
    }

    if (issues.focus > 0) {
      return {
        tone: "watch" as Tone,
        headline: `Keyboard focus is getting lost (${fmtInt(issues.focus)})`,
        body: "Interactive controls need a visible, consistent focus ring so the surface feels truly “product-grade.”",
        steps: [
          "Add a single focus style for buttons, pills, tabs, and links (ring + offset, no layout shift).",
          "Ensure focus is not removed by outline: none without a replacement.",
          "Validate on the console bar + segment controls first (highest interaction density).",
        ],
        meta: `A11y issues ${fmtInt(n(metrics?.a11yIssues30d))} · Target ${activeSite.url}`,
      };
    }

    if (issues.unstable > 0) {
      return {
        tone: "bad" as Tone,
        headline: `Stabilize layout on ${fmtInt(issues.unstable)} routes`,
        body: "Layout shifts break the ‘control room’ feel. Fixing CLS on the worst routes will instantly raise perceived quality.",
        steps: [
          "Reserve space for charts/cards (explicit heights + skeleton rails).",
          "Lock font swapping and image dimensions (avoid late reflow).",
          "Fix the top 3 routes first (use Top Routes list).",
        ],
        meta: `CLS ${fmtCls(metrics?.globalCls ?? null)} · Target ${activeSite.url}`,
      };
    }

    if (issues.slow > 0) {
      return {
        tone: "watch" as Tone,
        headline: `Speed posture needs a pass (${fmtInt(issues.slow)} slow routes)`,
        body: "Crawl and user trust both drop when key routes feel heavy. Trim the slowest pages first.",
        steps: [
          "Reduce above-the-fold work (defer non-critical modules + heavy SVG redraw).",
          "Audit server timing (TTFB) and remove waterfall blockers.",
          "Focus on top routes first — optimize where it matters most.",
        ],
        meta: `LCP ${fmtMs(metrics?.avgLcpMs ?? null)} · TTFB ${fmtMs(metrics?.avgTtfbMs ?? null)}`,
      };
    }

    if (issues.views404 > 0) {
      return {
        tone: rate404Pct > 2 ? ("bad" as Tone) : ("watch" as Tone),
        headline: `404 exposure exists (${fmtInt(issues.views404)} views · ${fmtPct(rate404Pct, 1)})`,
        body: "Even a small 404 rate can hurt discovery and trust. Tighten redirects and recovery surfaces.",
        steps: [
          "Verify redirects for the top missing routes (start with highest traffic).",
          "Ensure the 404 page links to core routes + search.",
          "Track recovery rate changes after fixes.",
        ],
        meta: `Recovery ${fmtPct(issues.recovery, 0)} · Target ${activeSite.url}`,
      };
    }

    const errLoad = issues.js + issues.api;
    if (errLoad > 0) {
      return {
        tone: "watch" as Tone,
        headline: `Error load is present (${fmtInt(errLoad)} total)`,
        body: "JS/API errors degrade stability signals. Clearing these improves both UX and analytics accuracy.",
        steps: [
          "Fix the most frequent JS error first (usually one root cause).",
          "Harden API retries/backoff for flaky endpoints.",
          "Confirm events + badges still fire correctly after the patch.",
        ],
        meta: `JS ${fmtInt(issues.js)} · API ${fmtInt(issues.api)} · Target ${activeSite.url}`,
      };
    }

    return {
      tone: "good" as Tone,
      headline: "Posture is clean — keep it that way",
      body: "No priority flags are firing. Your next win is tightening polish and preventing regressions.",
      steps: ["Lock design tokens for text + rails (no drift).", "Add guardrails for layout stability (explicit sizing).", "Run weekly audits on Top Routes to stay elite."],
      meta: `Guardian ${fmtInt(score)} · Coverage ${fmtPct(n(metrics?.aggregationCoveragePercent, 0), 0)}`,
    };
  })();

  /* ===== A11y (REAL) ===== */
  const audits = metrics ? n(metrics.a11yAudits30d) : 0;
  const issuesCount = metrics ? n(metrics.a11yIssues30d) : 0;
  const contrastFails = metrics ? n(metrics.contrastFailures30d) : 0;
  const focusInvisible = metrics ? n(metrics.focusInvisible30d) : 0;

  const denom = Math.max(1, audits);
  const issueRate = audits > 0 ? issuesCount / denom : 0;
  const contrastRate = audits > 0 ? contrastFails / denom : 0;
  const focusRate = audits > 0 ? focusInvisible / denom : 0;

  // --- SEO snapshot (derived from real metrics; no fake numbers) ---
  const indexHealthPct =
    metrics ? clamp(n(metrics.guardianScore) * 0.55 + n(metrics.aggregationCoveragePercent, 0) * 0.45, 0, 100) : null;

  const crawlCoveragePct = metrics?.aggregationCoveragePercent ?? null;

  const rate404Pct =
    metrics && n(metrics.sessions30d) > 0 ? (n(metrics.views40430d) / Math.max(1, n(metrics.sessions30d))) * 100 : 0;

  const crawlFriction = metrics ? n(metrics.slowPagesCount) + n(metrics.unstableLayoutPages) : 0;

  const indexTone = indexHealthPct == null ? "watch" : indexHealthPct >= 90 ? "good" : indexHealthPct >= 75 ? "watch" : "bad";
  const crawlTone = crawlCoveragePct == null ? "watch" : crawlCoveragePct >= 90 ? "good" : crawlCoveragePct >= 75 ? "watch" : "bad";
  const rate404Tone = rate404Pct <= 0.5 ? "good" : rate404Pct <= 2 ? "watch" : "bad";
  const frictionTone = crawlFriction <= 3 ? "good" : crawlFriction <= 10 ? "watch" : "bad";

  const indexFill = indexHealthPct == null ? 0 : clamp(indexHealthPct, 0, 100);
  const crawlFill = crawlCoveragePct == null ? 0 : clamp(crawlCoveragePct, 0, 100);

  // Lower 404% = better (0% -> full bar)
  const rate404Fill = clamp(100 - (rate404Pct / 2) * 100, 0, 100);

  // Lower friction = better (0 -> full bar)
  const frictionFill = clamp(100 - (crawlFriction / 10) * 100, 0, 100);

  // “Good / Watch / Bad” thresholds (visual only; uses your real counts)
  const auditsTone: Tone = audits >= 30 ? "good" : audits >= 10 ? "watch" : "bad";
  const issuesTone: Tone = toneFromRate(issueRate, 0.05, 0.12);
  const contrastTone: Tone = toneFromRate(contrastRate, 0.08, 0.16);
  const focusTone: Tone = toneFromRate(focusRate, 0.02, 0.06);

  const auditsFill = fillFromCount(audits, 60);
  const issuesFill = fillFromRate(issueRate, 0.2);
  const contrastFill = fillFromRate(contrastRate, 0.25);
  const focusFill = fillFromRate(focusRate, 0.12);

  return (
    <AppShell title="CavCore Console" subtitle="Guardian posture · Routes · SEO · Events">
      <div className="cb-console">
        {/* SITE SWITCHER (CLEAN + SHIPPABLE) */}
        <section className="cb-consolebar" aria-label="Console page controls">
          <div className="cb-consolebar-left">
            <div className="cb-chip">Sites</div>

            {/* Semantic dropdown (no JS, no bleeding tabs) */}
            <details className="cb-dd" aria-label="Choose monitored site">
              <summary className="cb-dd-summary">
                <span className="cb-dd-value">{activeSite.label}</span>
                <span className="cb-dd-caret" aria-hidden="true">
                  ▾
                </span>
              </summary>

              <div className="cb-dd-menu" role="menu" aria-label="Monitored site list">
                {SITES.map((s) => (
                  <a
                    key={s.id}
                    href={hrefWith({ site: s.id })}
                    role="menuitem"
                    aria-current={site === s.id ? "page" : undefined}
                    className={`cb-dd-item ${site === s.id ? "is-on" : ""}`}
                    title={s.url}
                  >
                    <span className="cb-dd-item-title">{s.label}</span>
                    <span className="cb-dd-item-sub">{s.url}</span>
                  </a>
                ))}
              </div>
            </details>
          </div>

          {/* Dashboard scope summary */}
          <div className="cb-consolebar-mid" aria-label="Dashboard scope">
            <div className="cb-scope-chip">Dashboard</div>
            <br />
            <div className="cb-scope-title">{site === "all" ? "All Sites (Total)" : activeSite.label}</div>
            <div className="cb-scope-sub">
              {site === "all" ? (
                <>
                  Aggregated metrics across all monitored targets.{" "}
                  <span className="cb-targetpill">Targets: {fmtInt(SITES.length - 1)}</span>
                </>
              ) : (
                <>
                  Showing metrics for <span className="cb-targetpill">{activeSite.url}</span>
                </>
              )}
            </div>
          </div>

          <div className="cb-consolebar-right" aria-label="Manage sites">
            <a className="cb-linkpill" href="/console/urls">
              Manage URLs <span aria-hidden="true">›</span>
            </a>
          </div>
        </section>

        <br />
        <br />

        {envMissing ? (
          <section className="cb-card cb-card-danger" aria-label="Missing environment variables">
            <div className="cb-card-head">
              <h1 className="cb-h1">Console is wired — env is missing</h1>
              <p className="cb-sub">
                Set <code>CAVBOT_API_BASE_URL</code> and <code>CAVBOT_PROJECT_KEY</code> for the server runtime.
              </p>
            </div>

            <div className="cb-kv">
              <div className="cb-kv-row">
                <span className="cb-k">Expected</span>
                <span className="cb-v">https://api.cavbot.io</span>
              </div>
              <div className="cb-kv-row">
                <span className="cb-k">Header</span>
                <span className="cb-v">X-Project-Key</span>
              </div>
            </div>
          </section>
        ) : hasMetrics ? (
          <>
            {/* HERO GRID */}
            <section className="cb-grid" aria-label="Guardian Summary">
              <div className="cb-card cb-card-hero" data-tone={scoreTone}>
                <div className="cb-hero-head">
                  <Donut score={score} label={badge.label} tone={scoreTone} />

                  <div className="cb-hero-meta">
                    <div className="cb-hero-title">
                      Guardian Summary <span className="cb-hero-dot" aria-hidden="true" />{" "}
                      <span className={`cb-hero-hint tone-${scoreTone}`}>{badge.hint}</span>
                    </div>

                    <div className="cb-status-row">
                      <span className={`cb-status-badge tone-${scoreTone}`}>{badge.label}</span>
                      <span className="cb-status-sub">
                        Target: {activeSite.label} · {projectLabel}
                      </span>
                    </div>
                  </div>
                </div>

                <br />
                <br />

                <div className="cb-hero-metrics" role="list" aria-label="Primary metrics">
                  <div className="cb-metric" role="listitem">
                    <div className="cb-metric-k">Sessions (30d)</div>
                    <div className="cb-metric-v">{fmtInt(metrics!.sessions30d)}</div>
                    <div className="cb-metric-s">Under Guard: {fmtInt(metrics!.sessionsUnderGuard30d)}</div>
                  </div>

                  <div className="cb-metric" role="listitem">
                    <div className="cb-metric-k">Unique Visitors (30d)</div>
                    <div className="cb-metric-v">{fmtInt(metrics!.uniqueVisitors30d)}</div>
                    <div className="cb-metric-s">Routes monitored: {fmtInt(metrics!.routesMonitored)}</div>
                  </div>

                  <div className="cb-metric" role="listitem">
                    <div className="cb-metric-k">JS Errors (30d)</div>
                    <div className="cb-metric-v">{fmtInt(metrics!.jsErrors30d)}</div>
                    <div className="cb-metric-s">API Errors: {fmtInt(metrics!.apiErrors30d)}</div>
                  </div>

                  <div className="cb-metric" role="listitem">
                    <div className="cb-metric-k">404 Views (30d)</div>
                    <div className="cb-metric-v">{fmtInt(metrics!.views40430d)}</div>
                    <div className="cb-metric-s">Recovery rate: {fmtPct(metrics!.recoveryRate404)}</div>
                  </div>
                </div>

                <br />
                <br />
                <div className="cb-divider cb-divider-hero" />
                <br />
                <br />

                <div className="cb-insights" aria-label="Guardian insights">
                  <div className="cb-insight">
                    <div className="cb-insight-k">Under Guard</div>
                    <div className="cb-insight-v">
                      {fmtPct((n(metrics!.sessionsUnderGuard30d) / Math.max(1, n(metrics!.sessions30d))) * 100, 0)}
                    </div>
                    <br /> <div className="cb-insight-s">Covered sessions</div>
                  </div>

                  <div className="cb-insight">
                    <div className="cb-insight-k">Error Load</div>
                    <div className="cb-insight-v">{fmtInt(n(metrics!.jsErrors30d) + n(metrics!.apiErrors30d))}</div>
                    <br /> <div className="cb-insight-s">JS + API errors (30d)</div>
                  </div>

                  <div className="cb-insight">
                    <div className="cb-insight-k">404 Recovery</div>
                    <div className="cb-insight-v">{fmtPct(metrics!.recoveryRate404, 0)}</div>
                    <br /> <div className="cb-insight-s">Recovery rate</div>
                  </div>

                  <div className="cb-insight">
                    <div className="cb-insight-k">Primary Risk</div>
                    <div className="cb-insight-v">
                      {n(metrics!.unstableLayoutPages) > 0
                        ? "Layout"
                        : n(metrics!.slowPagesCount) > 0
                        ? "Speed"
                        : n(metrics!.piiRiskPercent ?? 0) >= 20
                        ? "PII"
                        : "Clean"}
                    </div>
                    <br />
                    <div className="cb-insight-s">
                      {n(metrics!.unstableLayoutPages) > 0
                        ? `${fmtInt(metrics!.unstableLayoutPages)} unstable routes`
                        : n(metrics!.slowPagesCount) > 0
                        ? `${fmtInt(metrics!.slowPagesCount)} slow routes`
                        : n(metrics!.piiRiskPercent ?? 0) >= 20
                        ? `PII risk ${fmtPct(metrics!.piiRiskPercent, 0)}`
                        : "No active risk flags"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="cb-card">
                <div className="cb-card-head">
                  <h2 className="cb-h2">Vitals</h2>
                  <p className="cb-sub">Route-aware averages (last 30d)</p>
                </div>

                <br />

                <div className="cb-vitals" role="list" aria-label="Web vitals">
                  <div className="cb-vital" role="listitem" data-tone="good">
                    <div className="cb-vital-top">
                      <span className="cb-vital-name">LCP</span>
                      <span className="cb-vital-badge">Good</span>
                      <span className="cb-vital-value">{fmtMs(metrics!.avgLcpMs)}</span>
                    </div>
                    <div className="cb-vital-rail" aria-hidden="true">
                      <span className="cb-vital-fill" style={{ width: "82%" }} />
                    </div>
                    <div className="cb-vital-sub">Target: &lt; 2500 ms</div>
                  </div>

                  <div className="cb-vital" role="listitem" data-tone="good">
                    <div className="cb-vital-top">
                      <span className="cb-vital-name">TTFB</span>
                      <span className="cb-vital-badge">Good</span>
                      <span className="cb-vital-value">{fmtMs(metrics!.avgTtfbMs)}</span>
                    </div>
                    <div className="cb-vital-rail" aria-hidden="true">
                      <span className="cb-vital-fill" style={{ width: "92%" }} />
                    </div>
                    <div className="cb-vital-sub">Target: &lt; 800 ms</div>
                  </div>

                  <div className="cb-vital" role="listitem" data-tone="good">
                    <div className="cb-vital-top">
                      <span className="cb-vital-name">CLS</span>
                      <span className="cb-vital-badge">Good</span>
                      <span className="cb-vital-value">{fmtCls(metrics!.globalCls)}</span>
                    </div>
                    <div className="cb-vital-rail" aria-hidden="true">
                      <span className="cb-vital-fill" style={{ width: "96%" }} />
                    </div>
                    <div className="cb-vital-sub">Target: &lt; 0.10</div>
                  </div>

                  <div className="cb-vital" role="listitem" data-tone="good">
                    <div className="cb-vital-top">
                      <span className="cb-vital-name">Slow pages</span>
                      <span className="cb-vital-badge">Good</span>
                      <span className="cb-vital-value">{fmtInt(metrics!.slowPagesCount)}</span>
                    </div>
                    <div className="cb-vital-rail" aria-hidden="true">
                      <span className="cb-vital-fill" style={{ width: "88%" }} />
                    </div>
                    <div className="cb-vital-sub">Target: 0–3</div>
                  </div>

                  <div className="cb-vital" role="listitem" data-tone="good">
                    <div className="cb-vital-top">
                      <span className="cb-vital-name">Unstable layout</span>
                      <span className="cb-vital-badge">Good</span>
                      <span className="cb-vital-value">{fmtInt(metrics!.unstableLayoutPages)}</span>
                    </div>
                    <div className="cb-vital-rail" aria-hidden="true">
                      <span className="cb-vital-fill" style={{ width: "90%" }} />
                    </div>
                    <div className="cb-vital-sub">Target: 0</div>
                  </div>
                </div>
              </div>
            </section>

            <br />
            <br />

            {/* CHART + INTEL */}
            <section className="cb-grid cb-grid-2" aria-label="Trends and Intelligence">
              <div className="cb-stack" aria-label="Trend stack">
                <div className="cb-card cb-card-chart">
                  <div className="cb-card-head cb-card-head-row">
                    <div>
                      <h2 className="cb-h2">Sessions Trend</h2>
                      <p className="cb-sub">Modern bar + overlay (sessions / 404)</p>
                    </div>

                    <div className="cb-seg cb-seg-sm" role="tablist" aria-label="Trend range">
                      <a
                        role="tab"
                        aria-selected={range === "7d"}
                        className={`cb-seg-item ${range === "7d" ? "is-on" : ""}`}
                        href={hrefWith({ range: "7d" })}
                      >
                        7D
                      </a>
                      <a
                        role="tab"
                        aria-selected={range === "30d"}
                        className={`cb-seg-item ${range === "30d" ? "is-on" : ""} ${
                          !(metrics?.trend30d?.length || 0) ? "is-disabled" : ""
                        }`}
                        href={hrefWith({ range: "30d" })}
                        aria-disabled={!(metrics?.trend30d?.length || 0)}
                      >
                        30D
                      </a>
                    </div>
                  </div>

                  <br />

                  <div className="cb-chart-wrap" role="img" aria-label="Sessions bar chart">
                    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
                      {/* grid */}
                      <g opacity="0.33">
                        {Array.from({ length: 5 }).map((_, i) => {
                          const y = PAD + (H - PAD * 2) * (i / 4);
                          return (
                            <line
                              key={i}
                              x1={PAD}
                              y1={y}
                              x2={W - PAD}
                              y2={y}
                              stroke="rgba(255,255,255,0.12)"
                              strokeWidth="1"
                            />
                          );
                        })}
                      </g>

                      {/* bars */}
                      {bars.map((b, i) => (
                        <rect
                          key={i}
                          x={b.x}
                          y={b.y}
                          width={b.w}
                          height={Math.max(1, b.h)}
                          rx="10"
                          ry="10"
                          fill="rgba(78,168,255,0.18)"
                          stroke="rgba(78,168,255,0.38)"
                          strokeWidth="1"
                        />
                      ))}

                      {/* 404 overlay line (scaled) */}
                      <path
                        d={views404Path.d}
                        fill="none"
                        stroke="rgba(139,92,255,0.92)"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      />

                      {/* points (no unused vars, matches line scale) */}
                      {(() => {
                        const innerW = W - PAD * 2;
                        const innerH = H - PAD * 2;
                        const span = Math.max(1, views404Path.max - views404Path.min);

                        return views404Scaled.map((v, i) => {
                          const x =
                            PAD + innerW * (views404Scaled.length === 1 ? 0 : i / (views404Scaled.length - 1));
                          const y = PAD + innerH * (1 - (v - views404Path.min) / span);

                          return (
                            <circle
                              key={i}
                              cx={x}
                              cy={y}
                              r="3.4"
                              fill="rgba(139,92,255,0.95)"
                              stroke="rgba(0,0,0,0.35)"
                              strokeWidth="1"
                            />
                          );
                        });
                      })()}
                    </svg>

                    <div className="cb-chart-legend" aria-label="Legend">
                      <span className="cb-legend">
                        <i className="cb-swatch cb-swatch-blue" aria-hidden="true" /> Sessions (bars)
                      </span>
                      <span className="cb-legend">
                        <i className="cb-swatch cb-swatch-violet" aria-hidden="true" /> 404 views (overlay)
                      </span>
                    </div>
                  </div>

                  <br />

                  <div className="cb-mini-row" aria-label="Trend labels">
                    {series.labels.map((l, idx) => (
                      <div key={idx} className="cb-mini-day">
                        <span className="cb-mini-l">{l}</span>
                        <span className="cb-mini-v">{fmtInt(series.sessions[idx] || 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SEO Snapshot */}
                <div className="cb-card" aria-label="SEO Snapshot">
                  <div className="cb-card-head">
                    <h2 className="cb-h2">SEO Snapshot</h2>
                    <p className="cb-sub">Index posture + crawl readiness (last 30d)</p>
                  </div>

                  <br />
                  <br />

                  <div className="cb-vitals" role="list" aria-label="SEO posture metrics">
                    <div className="cb-vital" role="listitem" data-tone={indexTone}>
                      <div className="cb-vital-top">
                        <span className="cb-vital-name">Index health</span>
                        <span className="cb-vital-badge">
                          {indexTone === "bad" ? "Bad" : indexTone === "watch" ? "Watch" : "Good"}
                        </span>
                        <span className="cb-vital-value">{fmtPct(indexHealthPct, 0)}</span>
                      </div>
                      <div className="cb-vital-rail" aria-hidden="true">
                        <span className="cb-vital-fill" style={{ width: `${indexFill}%` }} />
                      </div>
                      <div className="cb-vital-sub">Derived from Guardian Score + coverage</div>
                    </div>

                    <br />

                    <div className="cb-vital" role="listitem" data-tone={crawlTone}>
                      <div className="cb-vital-top">
                        <span className="cb-vital-name">Crawl coverage</span>
                        <span className="cb-vital-badge">
                          {crawlTone === "bad" ? "Bad" : crawlTone === "watch" ? "Watch" : "Good"}
                        </span>
                        <span className="cb-vital-value">{fmtPct(crawlCoveragePct, 0)}</span>
                      </div>
                      <div className="cb-vital-rail" aria-hidden="true">
                        <span className="cb-vital-fill" style={{ width: `${crawlFill}%` }} />
                      </div>
                      <div className="cb-vital-sub">Routes observed + aggregating cleanly</div>
                    </div>

                    <br />

                    <div className="cb-vital" role="listitem" data-tone={rate404Tone}>
                      <div className="cb-vital-top">
                        <span className="cb-vital-name">404 rate</span>
                        <span className="cb-vital-badge">
                          {rate404Tone === "bad" ? "Bad" : rate404Tone === "watch" ? "Watch" : "Good"}
                        </span>
                        <span className="cb-vital-value">{fmtPct(rate404Pct, 1)}</span>
                      </div>
                      <div className="cb-vital-rail" aria-hidden="true">
                        <span className="cb-vital-fill" style={{ width: `${rate404Fill}%` }} />
                      </div>
                      <div className="cb-vital-sub">Views404 ÷ Sessions (30d)</div>
                    </div>

                    <br />

                    <div className="cb-vital" role="listitem" data-tone={frictionTone}>
                      <div className="cb-vital-top">
                        <span className="cb-vital-name">Crawl friction</span>
                        <span className="cb-vital-badge">
                          {frictionTone === "bad" ? "Bad" : frictionTone === "watch" ? "Watch" : "Good"}
                        </span>
                        <span className="cb-vital-value">{fmtInt(crawlFriction)}</span>
                      </div>
                      <div className="cb-vital-rail" aria-hidden="true">
                        <span className="cb-vital-fill" style={{ width: `${frictionFill}%` }} />
                      </div>
                      <div className="cb-vital-sub">Slow pages + unstable layout routes</div>
                    </div>

                    <br />

                    <div className="cb-vital" role="listitem" data-tone={discoveryTone}>
                      <div className="cb-vital-top">
                        <span className="cb-vital-name">Discovery coverage</span>
                        <span className="cb-vital-badge">
                          {discoveryTone === "bad" ? "Bad" : discoveryTone === "watch" ? "Watch" : "Good"}
                        </span>
                        <span className="cb-vital-value">{fmtPct(discoveryPct, 0)}</span>
                      </div>

                      <div className="cb-vital-rail" aria-hidden="true">
                        <span className="cb-vital-fill" style={{ width: `${discoveryFill}%` }} />
                      </div>

                      <div className="cb-vital-sub">Routes discoverable via crawl + internal linking</div>
                    </div>
                  </div>

                  <br />
                  <br />
                  <br />
                  <br />

                  <div className="cb-tagrow" aria-label="SEO signals">
                    <span className="cb-tag">SLOW_PAGES · {fmtInt(metrics!.slowPagesCount)}</span>
                    <span className="cb-tag">UNSTABLE_LAYOUT · {fmtInt(metrics!.unstableLayoutPages)}</span>
                    <span className="cb-tag">404_VIEWS · {fmtInt(metrics!.views40430d)}</span>
                    <span className="cb-tag">ROUTES_WATCHED · {fmtInt(metrics!.routesMonitored)}</span>
                  </div>
                </div>
              </div>

              <div className="cb-card">
                <div className="cb-card-head">
                  <h2 className="cb-h2">Intelligence</h2>
                  <p className="cb-sub">Behavior + safety posture</p>
                </div>

                <br />

                <div className="cb-kpi-grid" role="list" aria-label="Secondary metrics">
                  <div className="cb-kpi" role="listitem">
                    <div className="cb-kpi-k">CTA Clicks</div>
                    <div className="cb-kpi-v">{fmtInt(metrics!.ctaClicks30d)}</div>
                  </div>

                  <div className="cb-kpi" role="listitem">
                    <div className="cb-kpi-k">Form Submits</div>
                    <div className="cb-kpi-v">{fmtInt(metrics!.formSubmits30d)}</div>
                  </div>

                  <div className="cb-kpi" role="listitem">
                    <div className="cb-kpi-k">Engagement Pings</div>
                    <div className="cb-kpi-v">{fmtInt(metrics!.engagementPings30d)}</div>
                  </div>

                  <div className="cb-kpi" role="listitem">
                    <div className="cb-kpi-k">Scroll 90%</div>
                    <div className="cb-kpi-v">{fmtInt(metrics!.scroll90Sessions30d)}</div>
                  </div>

                  <div className="cb-kpi" role="listitem">
                    <div className="cb-kpi-k">PII Risk</div>
                    <div className="cb-kpi-v">{fmtPct(metrics!.piiRiskPercent, 0)}</div>
                  </div>

                  <div className="cb-kpi" role="listitem">
                    <div className="cb-kpi-k">Coverage</div>
                    <div className="cb-kpi-v">{fmtPct(metrics!.aggregationCoveragePercent, 0)}</div>
                  </div>

                  <div className="cb-kpi" role="listitem">
                    <div className="cb-kpi-k">Retention</div>
                    <div className="cb-kpi-v">{fmtPct(metrics!.retentionHorizonPercent, 0)}</div>
                  </div>

                  <div className="cb-kpi" role="listitem">
                    <div className="cb-kpi-k">Badge Interactions</div>
                    <div className="cb-kpi-v">{fmtInt(metrics!.badgeInteractions30d)}</div>
                  </div>
                </div>

                <br />

                <div className="cb-divider cb-divider-full" />

                <div className="cb-card-head" style={{ paddingTop: 16 }}>
                  <h3 className="cb-h3">A11y Snapshot</h3>
                  <p className="cb-sub">Audits + issues (safe, fingerprinted)</p>
                </div>

                <br />
                <br />

                <div className="cb-a11y" role="list" aria-label="Accessibility snapshot">
                  <div className="cb-a11y-item" role="listitem" data-tone={auditsTone}>
                    <div className="cb-a11y-top">
                      <span className="cb-a11y-name">Audits</span>
                      <span className="cb-a11y-badge">{toneLabel(auditsTone)}</span>
                      <span className="cb-a11y-value">{fmtInt(audits)}</span>
                    </div>
                    <div className="cb-a11y-rail" aria-hidden="true">
                      <span className="cb-a11y-fill" style={{ width: `${auditsFill}%` }} />
                    </div>
                    <div className="cb-a11y-sub">Last 30d scans recorded</div>
                  </div>

                  <div className="cb-a11y-item" role="listitem" data-tone={issuesTone}>
                    <div className="cb-a11y-top">
                      <span className="cb-a11y-name">Issues</span>
                      <span className="cb-a11y-badge">{toneLabel(issuesTone)}</span>
                      <span className="cb-a11y-value">{fmtInt(issuesCount)}</span>
                    </div>
                    <div className="cb-a11y-rail" aria-hidden="true">
                      <span className="cb-a11y-fill" style={{ width: `${issuesFill}%` }} />
                    </div>
                    <div className="cb-a11y-sub">Issue rate: {fmtPct(issueRate * 100, 0)} of audits</div>
                  </div>

                  <div className="cb-a11y-item" role="listitem" data-tone={contrastTone}>
                    <div className="cb-a11y-top">
                      <span className="cb-a11y-name">Contrast fails</span>
                      <span className="cb-a11y-badge">{toneLabel(contrastTone)}</span>
                      <span className="cb-a11y-value">{fmtInt(contrastFails)}</span>
                    </div>
                    <div className="cb-a11y-rail" aria-hidden="true">
                      <span className="cb-a11y-fill" style={{ width: `${contrastFill}%` }} />
                    </div>
                    <div className="cb-a11y-sub">Contrast rate: {fmtPct(contrastRate * 100, 0)} of audits</div>
                  </div>

                  <div className="cb-a11y-item" role="listitem" data-tone={focusTone}>
                    <div className="cb-a11y-top">
                      <span className="cb-a11y-name">Focus invisible</span>
                      <span className="cb-a11y-badge">{toneLabel(focusTone)}</span>
                      <span className="cb-a11y-value">{fmtInt(focusInvisible)}</span>
                    </div>
                    <div className="cb-a11y-rail" aria-hidden="true">
                      <span className="cb-a11y-fill" style={{ width: `${focusFill}%` }} />
                    </div>
                    <div className="cb-a11y-sub">Focus rate: {fmtPct(focusRate * 100, 0)} of audits</div>
                  </div>
                </div>

                <br />

                <div className="cb-feedback" role="region" aria-label="CavBot priority suggestions" data-tone={cavbotFeedback.tone}>
                  <div className="cb-feedback-top">
                    <span className="cb-feedback-chip">Top Priority</span>
                    <span className="cb-feedback-meta">{cavbotFeedback.meta}</span>
                  </div>

                  <br />
                  <br />

                  <div className="cb-feedback-h">{cavbotFeedback.headline}</div>
                  <br />
                  <p className="cb-feedback-p">{cavbotFeedback.body}</p>
                  <br />

                  <ul className="cb-feedback-list" aria-label="Recommended actions">
                    {cavbotFeedback.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>

                  <br />
                  <br />

                  <a className="cb-linkpill cb-feedback-cta" href="/insights">
                    Open Insights <span aria-hidden="true">›</span>
                  </a>
                </div>
              </div>
            </section>

            <br />
            <br />

            {/* TOP ROUTES */}
            <section className="cb-card" aria-label="Top routes">
              <div className="cb-card-head">
                <h2 className="cb-h2">Top Routes</h2>
                <p className="cb-sub">Most viewed paths (last 30d)</p>
              </div>

              <br />

              <div className="cb-table-wrap">
                <table className="cb-table" role="table" aria-label="Top routes table">
                  <thead>
                    <tr>
                      <th scope="col">Route</th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Views
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topRoutes.map((r) => (
                      <tr key={r.routePath}>
                        <td className="cb-route">{r.routePath}</td>
                        <td style={{ textAlign: "right" }}>{fmtInt(r.views)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : loadError ? (
          <section className="cb-card cb-card-danger" aria-label="Console load failed">
            <div className="cb-card-head">
              <h1 className="cb-h1">Console failed to load</h1>
              <p className="cb-sub">Your API is reachable, but this page couldn’t pull the summary.</p>
            </div>
            <pre className="cb-pre">{errText(loadError)}</pre>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}