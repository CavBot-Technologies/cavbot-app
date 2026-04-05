// app/insights/page.tsx
import "./insights.css";

import Image from "next/image";
import Script from "next/script";
import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { gateModuleAccess } from "@/lib/moduleGate.server";
import LockedModule from "@/components/LockedModule";
import AppShell from "@/components/AppShell";
import { readWorkspace } from "@/lib/workspaceStore.server";
import type { WorkspacePayload } from "@/lib/workspaceStore.server";
import { getProjectSummary } from "@/lib/cavbotApi.server";
import type { ProjectSummary } from "@/lib/cavbotTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type RangeKey = "24h" | "7d" | "14d" | "30d";

type WorkspaceView = WorkspacePayload & {
  // Some pages defensively check these alternate containers when present.
  selection?: { activeSiteOrigin?: string | null };
  activeSite?: { origin?: string | null };
  project?: { id?: string | number | null };
};

/* =========================
  Shared helpers (match SEO/Errors)
  ========================== */
function canonicalOrigin(input: string) {
  const s = String(input || "").trim();
  if (!s) return "";
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/\//, "")}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return "";
  }
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

function nOrNull(x: unknown) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}
function n(x: unknown, fallback = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
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
function fmtCls(v: unknown) {
  const x = nOrNull(v);
  if (x == null) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(x);
}

/* =========================
  Targets (match SEO/Console)
  ========================== */
type ClientTarget = { id: string; label?: string | null; origin: string };

function resolveSiteLabel(t: ClientTarget) {
  if (t.label && String(t.label).trim()) return String(t.label).trim();
  const s = String(t.id || "").replace(/-/g, " ").trim();
  if (s) return s.replace(/\b\w/g, (m) => m.toUpperCase());
  try {
    const u = new URL(t.origin);
    return u.hostname;
  } catch {
    return "Site";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeTargets(raw: unknown): ClientTarget[] {
  const roots: Record<string, unknown>[] = [];
  const push = (x: unknown) => {
    const record = asRecord(x);
    if (record) roots.push(record);
  };

  const maybe = asRecord(raw);
  push(maybe);
  push(maybe?.workspace);
  push(maybe?.commandDeck);
  push(maybe?.deck);
  push(maybe?.data);
  push(maybe?.state);
  push(maybe?.project);
  push(maybe?.account);
  push(maybe?.payload);

  const keys = ["targets", "sites", "monitoredSites", "origins", "monitoredOrigins", "sitesList", "targetsList"];

  for (const r of roots) {
    for (const k of keys) {
      const v = r[k];
      if (!Array.isArray(v) || !v.length) continue;

      const out: ClientTarget[] = [];
      const seen = new Set<string>();

      for (const item of v) {
        let origin = "";
        let id = "";
        let label: string | null = null;

        if (typeof item === "string") {
          origin = canonicalOrigin(item);
          id = toSlug(origin || item);
        } else {
          const obj = asRecord(item);
          if (!obj) continue;

          const rawOrigin =
            typeof obj.origin === "string"
              ? obj.origin
              : typeof obj.url === "string"
              ? obj.url
              : typeof obj.siteOrigin === "string"
              ? obj.siteOrigin
              : typeof obj.href === "string"
              ? obj.href
              : typeof obj.baseUrl === "string"
              ? obj.baseUrl
              : typeof obj.website === "string"
              ? obj.website
              : typeof obj.primaryOrigin === "string"
              ? obj.primaryOrigin
              : "";

          origin = canonicalOrigin(rawOrigin);
          id = toSlug(String(obj.slug || obj.id || origin || "site"));
          label =
            typeof obj.label === "string"
              ? obj.label
              : typeof obj.name === "string"
              ? obj.name
              : typeof obj.displayName === "string"
              ? obj.displayName
              : typeof obj.title === "string"
              ? obj.title
              : null;
        }

        if (!origin) continue;
        if (seen.has(origin)) continue;
        seen.add(origin);

        out.push({ id, origin, label });
      }

      return out;
    }
  }

  return [];
}

/* =========================
  Insights normalization (REAL only)
  ========================== */
type Tone = "good" | "ok" | "bad";

function scoreLabel(score: number | null): { label: string; tone: Tone } {
  if (score == null) return { label: "—", tone: "ok" };
  if (score >= 90) return { label: "Elite", tone: "good" };
  if (score >= 75) return { label: "Stable", tone: "ok" };
  if (score >= 55) return { label: "At Risk", tone: "bad" };
  return { label: "Critical", tone: "bad" };
}

function toneForScore(score: number | null): Tone {
  if (score == null) return "ok";
  if (score >= 92) return "good";
  if (score >= 80) return "ok";
  return "bad";
}

function toneForCount(v: number | null): Tone {
  if (v == null) return "ok";
  if (v <= 0) return "good";
  if (v <= 3) return "ok";
  return "bad";
}

function toneForRatePct(v: number | null): Tone {
  if (v == null) return "ok";
  if (v <= 1) return "good";
  if (v <= 5) return "ok";
  return "bad";
}

function toneForLcp(ms: number | null): Tone {
  if (ms == null) return "ok";
  if (ms <= 2500) return "good";
  if (ms <= 4000) return "ok";
  return "bad";
}
function toneForInp(ms: number | null): Tone {
  if (ms == null) return "ok";
  if (ms <= 200) return "good";
  if (ms <= 500) return "ok";
  return "bad";
}
function toneForCls(v: number | null): Tone {
  if (v == null) return "ok";
  if (v <= 0.1) return "good";
  if (v <= 0.25) return "ok";
  return "bad";
}
function toneFromCoveragePct(pct: number | null): Tone {
  if (pct == null) return "ok";
  if (pct >= 95) return "good";
  if (pct >= 80) return "ok";
  return "bad";
}

function lookupPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const key of path.split(".")) {
    const record = asRecord(cur);
    if (!record) return undefined;
    cur = record[key];
  }
  return cur;
}

function firstArray(root: unknown, paths: string[]): unknown[] | null {
  for (const path of paths) {
    const candidate = lookupPath(root, path);
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

function pickNumber(summary: ProjectSummary | null | undefined, paths: string[]): number | null {
  for (const p of paths) {
    const v = nOrNull(lookupPath(summary, p));
    if (v != null) return v;
  }
  return null;
}

type TrendPoint = { day: string; sessions?: number; views404?: number; errors?: number; signals?: number };

function normalizeTrend(summary: ProjectSummary | null | undefined): TrendPoint[] {
  const raw = firstArray(summary, [
    "trend7d",
    "trend",
    "trends.trend7d",
    "metrics.trend7d",
    "diagnostics.trend7d",
    "insights.trend7d",
    "insights.trend",
  ]);

  if (!raw) return [];
  const out: TrendPoint[] = [];

  for (const p of raw.slice(0, 60)) {
    const record = asRecord(p);
    const day = record?.day != null ? String(record.day) : record?.date != null ? String(record.date) : "";
    if (!day) continue;

    const sessions = nOrNull(record?.sessions ?? record?.views ?? record?.traffic ?? null);
    const views404 = nOrNull(record?.views404 ?? record?.notFound ?? record?.err404 ?? record?.views_404 ?? null);
    const errors = nOrNull(record?.errors ?? record?.jsErrors ?? record?.apiErrors ?? null);
    const signals = nOrNull(record?.signals ?? record?.events ?? record?.totalSignals ?? null);

    out.push({
      day,
      sessions: sessions ?? undefined,
      views404: views404 ?? undefined,
      errors: errors ?? undefined,
      signals: signals ?? undefined,
    });
  }

  return out;
}

function svgBars(values: number[], w = 560, h = 140) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const gap = 3;
  const barW = n ? Math.max(2, Math.floor((w - gap * (n - 1)) / n)) : 0;

  let x = 0;
  const rects: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i] || 0;
    const bh = Math.round((v / max) * (h - 10));
    const y = h - bh;
    rects.push(`<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3" ry="3"></rect>`);
    x += barW + gap;
  }
  return rects.join("");
}

function svgLinePath(values: number[], w = 560, h = 140) {
  const max = Math.max(1, ...values);
  const n = values.length;
  if (n < 2) return "";

  const step = w / (n - 1);
  let d = "";
  for (let i = 0; i < n; i++) {
    const v = values[i] || 0;
    const y = h - Math.round((v / max) * (h - 14)) - 6;
    const x = Math.round(i * step);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  return d;
}

/* =========================
  Score trend (if present) + explainable breakdown
  ========================== */
type ScoreTrendPoint = { day: string; score: number };

function normalizeScoreTrend(summary: ProjectSummary | null | undefined): ScoreTrendPoint[] {
  const raw = firstArray(summary, [
    "guardianTrend",
    "metrics.guardianTrend",
    "guardian.trend",
    "guardian.trend7d",
    "snapshot.guardianTrend",
    "diagnostics.guardianTrend",
    "insights.guardianTrend",
  ]);

  if (!raw) return [];
  const out: ScoreTrendPoint[] = [];

  for (const p of raw.slice(0, 90)) {
    const record = asRecord(p);
    const day = record?.day != null ? String(record.day) : record?.date != null ? String(record.date) : "";
    const score = nOrNull(record?.score ?? record?.guardianScore ?? record?.value ?? null);
    if (!day || score == null) continue;
    out.push({ day, score: clamp(score, 0, 100) });
  }

  return out;
}

function scoreSegments(values: number[], w = 560, h = 160): { d: string; tone: Tone }[] {
  const nPts = values.length;
  if (nPts < 2) return [];
  const step = w / (nPts - 1);

  const yFor = (v: number) => {
    const vv = clamp(v, 0, 100);
    return h - Math.round((vv / 100) * (h - 18)) - 8;
  };

  const segs: { d: string; tone: Tone }[] = [];
  for (let i = 0; i < nPts - 1; i++) {
    const a = values[i] ?? 0;
    const b = values[i + 1] ?? 0;
    const mid = (a + b) / 2;
    const x1 = Math.round(i * step);
    const x2 = Math.round((i + 1) * step);
    const y1 = yFor(a);
    const y2 = yFor(b);
    segs.push({ d: `M ${x1} ${y1} L ${x2} ${y2}`, tone: toneForScore(mid) });
  }
  return segs;
}

type ScorePart = {
  key: "seo" | "stability" | "vitals" | "a11y";
  label: string;
  weightPct: number;
  score: number | null;
  tone: Tone;
  detail: string;
  fix: string;
};

function toScorePct(x: number | null): number | null {
  if (x == null) return null;
  return clamp(x, 0, 100);
}

function scoreFromThresholds(v: number | null, goodAtOrBelow: number, okAtOrBelow: number, badAtOrBelow: number) {
  if (v == null) return null;
  if (v <= goodAtOrBelow) return 100;
  if (v <= okAtOrBelow) return 75;
  if (v <= badAtOrBelow) return 55;
  return 25;
}

function scoreCoverage(pct: number | null) {
  if (pct == null) return null;
  const p = clamp(pct, 0, 100);
  return clamp(Math.round((p / 100) * 100), 0, 100);
}

function scorePenaltyLog(count: number | null, scale = 18) {
  if (count == null) return null;
  const c = Math.max(0, count);
  const penalty = Math.log10(c + 1) * scale;
  return clamp(100 - Math.round(penalty), 0, 100);
}

function calcScoreBreakdown(input: {
  titleCoveragePct: number | null;
  descriptionCoveragePct: number | null;
  canonicalCoveragePct: number | null;
  noindexPct: number | null;
  missingH1Pct: number | null;

  rate404Pct: number | null;
  views404: number | null;
  jsErrors: number | null;
  apiErrors: number | null;

  lcpP75Ms: number | null;
  inpP75Ms: number | null;
  clsP75: number | null;

  a11yIssues: number | null;
  contrastFails: number | null;
  focusWarns: number | null;
}): { parts: ScorePart[]; computedScore: number | null } {
  const sTitle = scoreCoverage(input.titleCoveragePct);
  const sDesc = scoreCoverage(input.descriptionCoveragePct);
  const sCanon = scoreCoverage(input.canonicalCoveragePct);
  const sNoindex = input.noindexPct == null ? null : clamp(100 - input.noindexPct, 0, 100);
  const sH1 = input.missingH1Pct == null ? null : clamp(100 - input.missingH1Pct, 0, 100);

  const seoPieces = [sTitle, sDesc, sCanon, sNoindex, sH1].filter((x) => x != null) as number[];
  const seoScore = seoPieces.length ? Math.round(seoPieces.reduce((a, b) => a + b, 0) / seoPieces.length) : null;

  const totalErr = (input.jsErrors ?? 0) + (input.apiErrors ?? 0);
  const s404 = scoreFromThresholds(input.rate404Pct, 1, 5, 12);
  const sErr = scorePenaltyLog(totalErr, 22);
  const stabPieces = [s404, sErr].filter((x) => x != null) as number[];
  const stabScore = stabPieces.length ? Math.round(stabPieces.reduce((a, b) => a + b, 0) / stabPieces.length) : null;

  const sLcp = scoreFromThresholds(input.lcpP75Ms, 2500, 4000, 8000);
  const sInp = scoreFromThresholds(input.inpP75Ms, 200, 500, 1000);
  const sCls =
    input.clsP75 == null ? null : input.clsP75 <= 0.1 ? 100 : input.clsP75 <= 0.25 ? 75 : input.clsP75 <= 0.5 ? 55 : 25;
  const vitPieces = [sLcp, sInp, sCls].filter((x) => x != null) as number[];
  const vitScore = vitPieces.length ? Math.round(vitPieces.reduce((a, b) => a + b, 0) / vitPieces.length) : null;

  const sA11y = scorePenaltyLog(input.a11yIssues, 18);
  const sContrast = scorePenaltyLog(input.contrastFails, 18);
  const sFocus = scorePenaltyLog(input.focusWarns, 16);
  const a11yPieces = [sA11y, sContrast, sFocus].filter((x) => x != null) as number[];
  const a11yScore = a11yPieces.length ? Math.round(a11yPieces.reduce((a, b) => a + b, 0) / a11yPieces.length) : null;

  const parts: ScorePart[] = [
    {
      key: "seo",
      label: "SEO",
      weightPct: 30,
      score: toScorePct(seoScore),
      tone: toneForScore(seoScore),
      detail: `Title ${fmtPct(input.titleCoveragePct)} · Desc ${fmtPct(input.descriptionCoveragePct)} · Canon ${fmtPct(input.canonicalCoveragePct)}`,
      fix: "Close metadata gaps on high-traffic pages first.",
    },
    {
      key: "stability",
      label: "Stability",
      weightPct: 30,
      score: toScorePct(stabScore),
      tone: toneForScore(stabScore),
      detail: `404 ${fmtPct(input.rate404Pct)} · Errors ${fmtInt(totalErr)}`,
      fix: "Fix broken links + top error fingerprints to lift posture fastest.",
    },
    {
      key: "vitals",
      label: "Vitals",
      weightPct: 25,
      score: toScorePct(vitScore),
      tone: toneForScore(vitScore),
      detail: `LCP ${fmtMs(input.lcpP75Ms)} · INP ${fmtMs(input.inpP75Ms)} · CLS ${fmtCls(input.clsP75)}`,
      fix: "Reduce main-thread work + stabilize layout to move P75 quickly.",
    },
    {
      key: "a11y",
      label: "Accessibility",
      weightPct: 15,
      score: toScorePct(a11yScore),
      tone: toneForScore(a11yScore),
      detail: `Issues ${fmtInt(input.a11yIssues)} · Contrast ${fmtInt(input.contrastFails)} · Focus ${fmtInt(input.focusWarns)}`,
      fix: "Fix labels/names first, then contrast + focus hygiene across UI.",
    },
  ];

  const have = parts.filter((p) => p.score != null);
  const computedScore =
    have.length >= 2
      ? Math.round(
          (have.reduce((acc, p) => acc + (p.weightPct / 100) * (p.score as number), 0) /
            (have.reduce((acc, p) => acc + p.weightPct, 0) / 100)) *
            1
        )
      : null;

  return { parts, computedScore };
}

type HotspotRow = { label: string; value: number; sub?: string | null; tone?: Tone };

function isHotspotRow(x: HotspotRow | null): x is HotspotRow {
  return x !== null;
}

function toHotspotRows(
  raw: unknown[] | null,
  mapper: (record: Record<string, unknown>) => HotspotRow | null
): HotspotRow[] {
  if (!raw) return [];
  return raw
    .map((item) => {
      const record = asRecord(item);
      if (!record) return null;
      return mapper(record);
    })
    .filter(isHotspotRow)
    .slice(0, 8);
}

function normalizeHotspots(summary: ProjectSummary | null | undefined): {
  topRoutes: HotspotRow[];
  topErrors: HotspotRow[];
  topA11y: HotspotRow[];
} {
  const topRoutesRaw = firstArray(summary, [
    "topRoutes",
    "routes.top",
    "diagnostics.topRoutes",
    "insights.topRoutes",
    "snapshot.topRoutes",
  ]);
  const topErrorsRaw = firstArray(summary, [
    "errors.groups",
    "errorGroups",
    "diagnostics.errors.groups",
    "insights.errors.groups",
    "insights.topErrors",
  ]);
  const topA11yRaw = firstArray(summary, [
    "a11y.topIssues",
    "accessibility.topIssues",
    "a11y.issues",
    "insights.a11y.topIssues",
  ]);

  const topRoutes = toHotspotRows(topRoutesRaw, (r) => {
    const label =
      r.routePath != null
        ? String(r.routePath)
        : r.path != null
        ? String(r.path)
        : r.route != null
        ? String(r.route)
        : "";
    const value = nOrNull(r.views ?? r.count ?? r.hits ?? null) ?? 0;
    if (!label) return null;
    return { label, value, sub: null };
  });

  const topErrors = toHotspotRows(topErrorsRaw, (g) => {
    const label =
      g.title != null
        ? String(g.title)
        : g.message != null
        ? String(g.message)
        : g.name != null
        ? String(g.name)
        : g.fingerprint != null
        ? String(g.fingerprint)
        : "";
    const value = nOrNull(g.count ?? g.hits ?? g.total ?? null) ?? 0;
    if (!label) return null;
    return {
      label: label.slice(0, 120),
      value,
      sub: g.category != null ? String(g.category) : null,
      tone: toneForCount(value),
    };
  });

  const topA11y = toHotspotRows(topA11yRaw, (it) => {
    const label = it.type != null ? String(it.type) : it.name != null ? String(it.name) : it.label != null ? String(it.label) : "";
    const value = nOrNull(it.count ?? it.hits ?? it.total ?? null) ?? 0;
    if (!label) return null;
    return { label: label.slice(0, 120), value, sub: null, tone: toneForCount(value) };
  });

  return { topRoutes, topErrors, topA11y };
}

type InsightItem = {
  title: string;
  tone: Tone;
  metricLabel: string;
  metricValue: string;
  why: string;
  next: string;
  href: string;
};

function buildInsights(input: {
  guardianScore: number | null;

  pagesObserved: number | null;
  titleCoveragePct: number | null;
  descriptionCoveragePct: number | null;
  canonicalCoveragePct: number | null;
  noindexPct: number | null;
  missingH1Pct: number | null;

  lcpP75Ms: number | null;
  inpP75Ms: number | null;
  clsP75: number | null;

  views404: number | null;
  rate404Pct: number | null;

  jsErrors: number | null;
  apiErrors: number | null;

  a11yIssues: number | null;
  contrastFails: number | null;
  focusWarns: number | null;
}): InsightItem[] {
  const out: InsightItem[] = [];

  const posture = scoreLabel(input.guardianScore);
  out.push({
    title: "Overall posture",
    tone: posture.tone,
    metricLabel: "",
    metricValue: "",
    why: "CavBot consolidates SEO, stability, vitals, and accessibility signals into one posture read.",
    next: "Use the findings below as your prioritized work queue.",
    href: "/console",
  });

  if (input.rate404Pct != null || input.views404 != null) {
    const tone = toneForRatePct(input.rate404Pct);
    out.push({
      title: "404 exposure",
      tone,
      metricLabel: "404 rate",
      metricValue: input.rate404Pct != null ? fmtPct(input.rate404Pct, 1) : "—",
      why: "404 traffic burns trust, weakens crawl efficiency, and increases friction during navigation.",
      next: "Fix broken internal links, add redirects where appropriate, and improve the 404 recovery path.",
      href: "/errors",
    });
  }

  if (input.jsErrors != null || input.apiErrors != null) {
    const total = (input.jsErrors ?? 0) + (input.apiErrors ?? 0);
    const tone = toneForCount(total);
    out.push({
      title: "Runtime errors",
      tone,
      metricLabel: "Errors (JS + API)",
      metricValue: total ? fmtInt(total) : total === 0 ? "0" : "—",
      why: "User-facing errors reduce conversion, inflate support volume, and signal stability risk.",
      next: "Open Errors to isolate fingerprints, verify fixes, and track crash-free recovery.",
      href: "/errors",
    });
  }

  if (input.lcpP75Ms != null) {
    const tone = toneForLcp(input.lcpP75Ms);
    out.push({
      title: "Largest Contentful Paint (P75)",
      tone,
      metricLabel: "LCP P75",
      metricValue: fmtMs(input.lcpP75Ms),
      why: "LCP reflects perceived loading speed. Slow LCP is strongly correlated with bounce risk.",
      next: "Reduce above-the-fold payload, optimize hero media, and remove render-blocking work.",
      href: "/console",
    });
  }

  if (input.inpP75Ms != null) {
    const tone = toneForInp(input.inpP75Ms);
    out.push({
      title: "Interaction to Next Paint (P75)",
      tone,
      metricLabel: "INP P75",
      metricValue: fmtMs(input.inpP75Ms),
      why: "INP measures responsiveness. Poor INP often points to main-thread congestion.",
      next: "Audit long tasks, reduce heavy JS, and defer non-critical work on interaction.",
      href: "/console",
    });
  }

  if (input.clsP75 != null) {
    const tone = toneForCls(input.clsP75);
    out.push({
      title: "Cumulative Layout Shift (P75)",
      tone,
      metricLabel: "CLS P75",
      metricValue: fmtCls(input.clsP75),
      why: "Layout shift breaks reading flow and causes mis-clicks—especially on mobile.",
      next: "Reserve space for media, avoid late-loading UI injection, and stabilize fonts.",
      href: "/console",
    });
  }

  if (input.pagesObserved != null) {
    const covTone = toneFromCoveragePct(input.titleCoveragePct);
    out.push({
      title: "SEO metadata coverage",
      tone: covTone,
      metricLabel: "Title coverage",
      metricValue: fmtPct(input.titleCoveragePct, 1),
      why: "Consistent titles/descriptions help search engines understand page intent and improve snippet quality.",
      next: "Open SEO Intelligence and close coverage gaps starting with high-traffic pages.",
      href: "/seo",
    });
  }

  if (input.noindexPct != null) {
    const tone = toneForRatePct(input.noindexPct);
    out.push({
      title: "Indexing restrictions",
      tone,
      metricLabel: "NoIndex",
      metricValue: fmtPct(input.noindexPct, 1),
      why: "NoIndex prevents pages from appearing in search results and can hide critical surfaces.",
      next: "Confirm intended pages only; remove accidental NoIndex and validate robots rules.",
      href: "/seo",
    });
  }

  if (input.missingH1Pct != null) {
    const tone = toneForRatePct(input.missingH1Pct);
    out.push({
      title: "Heading integrity",
      tone,
      metricLabel: "Missing H1",
      metricValue: fmtPct(input.missingH1Pct, 1),
      why: "H1 helps users and crawlers understand page hierarchy and intent at a glance.",
      next: "Add a single descriptive H1 and ensure it matches the page’s primary purpose.",
      href: "/seo",
    });
  }

  if (input.a11yIssues != null) {
    const tone = toneForCount(input.a11yIssues);
    out.push({
      title: "Accessibility issues",
      tone,
      metricLabel: "Issues",
      metricValue: input.a11yIssues === 0 ? "0" : fmtInt(input.a11yIssues),
      why: "Accessibility issues reduce usability, increase legal risk, and degrade conversion for keyboard/screen-reader users.",
      next: "Fix missing labels/names first, then address structure, focus, and contrast.",
      href: "/console",
    });
  }

  if (input.contrastFails != null) {
    const tone = toneForCount(input.contrastFails);
    out.push({
      title: "Contrast risk",
      tone,
      metricLabel: "Failures",
      metricValue: input.contrastFails === 0 ? "0" : fmtInt(input.contrastFails),
      why: "Insufficient contrast reduces readability and accessibility, especially in sunlight and low-quality displays.",
      next: "Raise text contrast on key UI surfaces and verify across themes/states.",
      href: "/console",
    });
  }

  if (input.focusWarns != null) {
    const tone = toneForCount(input.focusWarns);
    out.push({
      title: "Focus hygiene",
      tone,
      metricLabel: "Warnings",
      metricValue: input.focusWarns === 0 ? "0" : fmtInt(input.focusWarns),
      why: "Poor focus visibility blocks keyboard navigation and prevents confident interaction.",
      next: "Ensure clear focus rings and no focus-traps on modals and menus.",
      href: "/console",
    });
  }

  return out.slice(0, 10);
}

/* =========================
  Mission Control (fills the gap under the first finding)
  ========================== */
type MissionOwner = "SEO" | "Errors" | "Console" | "Routes" | "A11y";

type MissionItem = {
  id: string;
  title: string;
  tone: Tone;
  impact: "High" | "Medium" | "Low";
  owner: MissionOwner;
  metricLabel: string;
  metricValue: string;
  why: string;
  improves: string;
  href: string;
  _rank: number;
  _mag: number;
  _lift: number;
};

type MissionForecast = {
  headline: string;
  summary: string;
  chips: string[];
  tone: Tone;
};

type MissionSignals = {
  routes: Array<{ path: string; views: number }>;
  errors: Array<{ key: string; label: string; hits: number; sessions: number | null; routePath: string | null; status: number | null }>;
  a11y: Array<{ key: string; label: string; hits: number }>;
};

function stableHash(input: string) {
  let h = 2166136261;
  const s = String(input || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickStable<T>(seed: string, variants: readonly T[]): T {
  if (!variants.length) throw new Error("variants required");
  return variants[stableHash(seed) % variants.length];
}

function clipRoutePath(path: string, maxLen = 52) {
  const v = String(path || "").trim() || "/";
  if (v.length <= maxLen) return v;
  return `${v.slice(0, Math.max(8, maxLen - 1))}…`;
}

function impactFromLift(lift: number, tone: Tone): "High" | "Medium" | "Low" {
  if (tone === "bad" || lift >= 880) return "High";
  if (tone === "ok" || lift >= 420) return "Medium";
  return "Low";
}
function rankForTone(t: Tone) {
  return t === "bad" ? 3 : t === "ok" ? 2 : 1;
}

function effortPenalty(owner: MissionOwner) {
  if (owner === "Errors") return 78;
  if (owner === "Routes") return 88;
  if (owner === "SEO") return 96;
  if (owner === "A11y") return 108;
  return 122;
}

function liftScore(tone: Tone, magnitude: number, owner: MissionOwner, confidence = 1) {
  const rankWeight = rankForTone(tone) * 320;
  const magWeight = Math.round(Math.log10(Math.max(1, magnitude) + 1) * 240);
  const confidenceWeight = Math.round(clamp(confidence, 0.3, 1) * 90);
  return rankWeight + magWeight + confidenceWeight - effortPenalty(owner);
}

function normalizeMissionSignals(summary: ProjectSummary | null | undefined): MissionSignals {
  const routesRaw = firstArray(summary, [
    "topRoutes",
    "routes.top",
    "diagnostics.topRoutes",
    "insights.topRoutes",
    "snapshot.topRoutes",
  ]);
  const errorsRaw = firstArray(summary, [
    "errors.groups",
    "errorGroups",
    "diagnostics.errors.groups",
    "insights.errors.groups",
    "insights.topErrors",
  ]);
  const a11yRaw = firstArray(summary, [
    "a11y.topIssues",
    "accessibility.topIssues",
    "a11y.issues",
    "insights.a11y.topIssues",
  ]);

  const routes = (routesRaw || [])
    .map((row) => {
      const record = asRecord(row);
      if (!record) return null;
      const path =
        record.routePath != null
          ? String(record.routePath)
          : record.path != null
          ? String(record.path)
          : record.route != null
          ? String(record.route)
          : "";
      if (!path) return null;
      const views = nOrNull(record.views ?? record.count ?? record.hits ?? null) ?? 0;
      return { path, views };
    })
    .filter((row): row is { path: string; views: number } => !!row)
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path));

  const errors = (errorsRaw || [])
    .map((row) => {
      const record = asRecord(row);
      if (!record) return null;
      const label =
        record.title != null
          ? String(record.title)
          : record.message != null
          ? String(record.message)
          : record.name != null
          ? String(record.name)
          : record.fingerprint != null
          ? String(record.fingerprint)
          : "";
      if (!label) return null;
      const hits = nOrNull(record.count ?? record.hits ?? record.total ?? null) ?? 0;
      const sessions = nOrNull(record.sessions ?? record.affectedSessions ?? null);
      const routePath = record.routePath != null ? String(record.routePath) : record.path != null ? String(record.path) : null;
      const status = nOrNull(record.status ?? null);
      const key = String(record.fingerprint ?? label).toLowerCase().slice(0, 180);
      return { key, label: label.slice(0, 180), hits, sessions, routePath, status };
    })
    .filter((row): row is { key: string; label: string; hits: number; sessions: number | null; routePath: string | null; status: number | null } => !!row)
    .sort((a, b) => b.hits - a.hits || (b.sessions ?? 0) - (a.sessions ?? 0) || a.key.localeCompare(b.key));

  const a11y = (a11yRaw || [])
    .map((row) => {
      const record = asRecord(row);
      if (!record) return null;
      const label = record.type != null ? String(record.type) : record.name != null ? String(record.name) : record.label != null ? String(record.label) : "";
      if (!label) return null;
      const hits = nOrNull(record.count ?? record.hits ?? record.total ?? null) ?? 0;
      return { key: label.toLowerCase().slice(0, 180), label: label.slice(0, 180), hits };
    })
    .filter((row): row is { key: string; label: string; hits: number } => !!row)
    .sort((a, b) => b.hits - a.hits || a.key.localeCompare(b.key));

  return { routes, errors, a11y };
}

function missionForecast(input: {
  guardianScore: number | null;
  pagesObserved: number | null;
  titleCoveragePct: number | null;
  rate404Pct: number | null;
  views404: number | null;
  jsErrors: number | null;
  apiErrors: number | null;
  lcpP75Ms: number | null;
  inpP75Ms: number | null;
  clsP75: number | null;
  a11yIssues: number | null;
  contrastFails: number | null;
  focusWarns: number | null;
  queueSize: number;
}): MissionForecast {
  const totalErrors = Math.max(0, (input.jsErrors ?? 0) + (input.apiErrors ?? 0));
  const recover404 = Math.round(Math.max(0, input.views404 ?? 0) * clamp((input.rate404Pct ?? 0) / 100, 0, 0.9));
  const errorCut = Math.round(totalErrors * clamp(0.34 + Math.log10(totalErrors + 1) * 0.18, 0.2, 0.78));
  const seoGapPages =
    input.pagesObserved != null && input.titleCoveragePct != null
      ? Math.round(Math.max(0, ((100 - clamp(input.titleCoveragePct, 0, 100)) / 100) * input.pagesObserved))
      : 0;
  const a11yTotal = Math.max(0, (input.a11yIssues ?? 0) + (input.contrastFails ?? 0) + (input.focusWarns ?? 0));
  const a11yCut = Math.round(a11yTotal * 0.58);
  const lcpMs = Math.max(0, (input.lcpP75Ms ?? 0) - 2500);
  const inpMs = Math.max(0, (input.inpP75Ms ?? 0) - 200);
  const clsShift = Math.max(0, (input.clsP75 ?? 0) - 0.1);
  const vitalsLift = Math.round(lcpMs * 0.42 + inpMs * 0.35 + clsShift * 1000 * 0.6);
  const scoreLift = clamp(Math.round(recover404 * 0.035 + errorCut * 0.05 + seoGapPages * 0.72 + a11yCut * 0.28 + vitalsLift / 130), 0, 36);
  const projected = input.guardianScore == null ? null : clamp(input.guardianScore + scoreLift, 0, 100);
  const tone = projected == null ? (scoreLift >= 8 ? "ok" : "good") : toneForScore(projected);

  const headline =
    scoreLift > 0
      ? `If this queue ships cleanly, CavBot projects roughly +${scoreLift} Guardian points.`
      : "Mission Control is in maintenance mode; posture gains are mostly preventative.";
  const summary =
    input.queueSize > 0
      ? `Expected lift: recover ~${fmtInt(recover404)} broken-route sessions, remove ~${fmtInt(errorCut)} recurring errors, and tighten high-friction pages before regressions stack.`
      : "No ranked queue yet. As live telemetry expands, CavBot will auto-promote deterministic fixes here.";

  const chips = [
    `Recovery +${fmtInt(recover404)} sessions`,
    `Errors −${fmtInt(errorCut)}`,
    `SEO pages +${fmtInt(seoGapPages)}`,
    `A11y blockers −${fmtInt(a11yCut)}`,
  ].filter((chip) => !chip.endsWith("—"));

  return {
    headline,
    summary,
    chips: chips.slice(0, 3),
    tone,
  };
}

function buildMissionQueue(input: {
  pagesObserved: number | null;
  titleCoveragePct: number | null;
  descriptionCoveragePct: number | null;
  canonicalCoveragePct: number | null;
  noindexPct: number | null;

  rate404Pct: number | null;
  views404: number | null;

  jsErrors: number | null;
  apiErrors: number | null;

  lcpP75Ms: number | null;
  inpP75Ms: number | null;
  clsP75: number | null;

  a11yIssues: number | null;
  contrastFails: number | null;
  focusWarns: number | null;

  signals: MissionSignals;
}): MissionItem[] {
  const items: MissionItem[] = [];
  const seen = new Set<string>();
  const totalErrors = Math.max(0, (input.jsErrors ?? 0) + (input.apiErrors ?? 0));
  const totalRouteViews = Math.max(1, input.signals.routes.reduce((acc, row) => acc + Math.max(0, row.views), 0));
  const totalErrorHits = Math.max(1, input.signals.errors.reduce((acc, row) => acc + Math.max(0, row.hits), 0));
  const totalA11yHits = Math.max(1, input.signals.a11y.reduce((acc, row) => acc + Math.max(0, row.hits), 0));

  const push = (row: Omit<MissionItem, "impact" | "_lift"> & { effortOwner?: MissionOwner; confidence?: number }) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    const lift = liftScore(row.tone, row._mag, row.effortOwner || row.owner, row.confidence ?? 1);
    items.push({
      ...row,
      impact: impactFromLift(lift, row.tone),
      _lift: lift,
    });
  };

  if (input.rate404Pct != null || input.views404 != null) {
    const tone = toneForRatePct(input.rate404Pct);
    const recoverable = Math.round(Math.max(0, input.views404 ?? 0) * clamp((input.rate404Pct ?? 0) / 100, 0, 0.9));
    const why = pickStable(`404|${input.rate404Pct}|${input.views404}`, [
      "CavBot flagged live dead-end traffic. Patch internal links and redirect the worst misses first.",
      "404 drift is stealing sessions. Fix the top broken paths before they become normalized churn.",
      "Dead routes are still in circulation. Seal the broken path chain and hand users to live surfaces.",
    ] as const);
    const mag = (input.rate404Pct ?? 0) * 18 + (input.views404 ?? 0) * 0.24;
    push({
      id: "core_404_exposure",
      title: "Eliminate 404 exposure",
      tone,
      owner: "Errors",
      metricLabel: "404 rate",
      metricValue: input.rate404Pct != null ? fmtPct(input.rate404Pct, 1) : "—",
      why,
      improves: `Expected outcome: recover about ${fmtInt(recoverable)} sessions in this window and improve crawl continuity.`,
      href: "/errors",
      _rank: rankForTone(tone),
      _mag: mag,
      effortOwner: "Errors",
    });
  }

  if (input.jsErrors != null || input.apiErrors != null) {
    const tone = toneForCount(totalErrors);
    const errorClear = Math.round(totalErrors * clamp(0.4 + Math.log10(totalErrors + 1) * 0.14, 0.22, 0.8));
    const why = pickStable(`runtime|${totalErrors}|${input.jsErrors}|${input.apiErrors}`, [
      "Top fingerprints are recurring. Kill repeat offenders so the same failures stop respawning each release.",
      "Runtime noise is inflating reliability drag. Close the highest-volume clusters and harden retries.",
      "CavBot sees repeat error signatures. Fix once at the root so sessions stop paying the same tax.",
    ] as const);
    push({
      id: "core_runtime_errors",
      title: "Crush runtime errors",
      tone,
      owner: "Errors",
      metricLabel: "Errors",
      metricValue: totalErrors === 0 ? "0" : fmtInt(totalErrors),
      why,
      improves: `Expected outcome: cut roughly ${fmtInt(errorClear)} repeated failures and lift crash-free stability.`,
      href: "/errors",
      _rank: rankForTone(tone),
      _mag: Math.max(1, totalErrors),
      effortOwner: "Errors",
    });
  }

  if (input.lcpP75Ms != null) {
    const tone = toneForLcp(input.lcpP75Ms);
    const msLift = Math.round(Math.max(0, input.lcpP75Ms - 2500) * 0.45);
    push({
      id: "core_vitals_lcp",
      title: "Trim LCP on critical routes",
      tone,
      owner: "Console",
      metricLabel: "LCP P75",
      metricValue: fmtMs(input.lcpP75Ms),
      why: pickStable(`lcp|${input.lcpP75Ms}`, [
        "Hero payload is still heavy. Reduce above-the-fold weight where traffic is densest.",
        "LCP is carrying latency debt. Optimize media and render path on the first viewport.",
        "CavBot sees slow first paint. Tighten critical rendering before users bounce.",
      ] as const),
      improves: `Expected outcome: reclaim about ${fmtInt(msLift)} ms on perceived load if top-route payload is reduced.`,
      href: "/console",
      _rank: rankForTone(tone),
      _mag: Math.max(1, input.lcpP75Ms),
      effortOwner: "Console",
    });
  }

  if (input.inpP75Ms != null) {
    const tone = toneForInp(input.inpP75Ms);
    const msLift = Math.round(Math.max(0, input.inpP75Ms - 200) * 0.38);
    push({
      id: "core_vitals_inp",
      title: "Lower interaction latency (INP)",
      tone,
      owner: "Console",
      metricLabel: "INP P75",
      metricValue: fmtMs(input.inpP75Ms),
      why: pickStable(`inp|${input.inpP75Ms}`, [
        "Main-thread congestion is delaying taps and clicks. Split long tasks before they pile up.",
        "Input handling is running hot. Defer non-critical work during interaction bursts.",
        "CavBot detected response lag. Tightening event handlers here gives immediate UX lift.",
      ] as const),
      improves: `Expected outcome: shave roughly ${fmtInt(msLift)} ms from interaction delay on active sessions.`,
      href: "/console",
      _rank: rankForTone(tone),
      _mag: Math.max(1, input.inpP75Ms),
      effortOwner: "Console",
    });
  }

  if (input.clsP75 != null) {
    const tone = toneForCls(input.clsP75);
    const shiftLift = Math.round(Math.max(0, input.clsP75 - 0.1) * 1000 * 0.52);
    push({
      id: "core_vitals_cls",
      title: "Stabilize layout movement (CLS)",
      tone,
      owner: "Console",
      metricLabel: "CLS P75",
      metricValue: fmtCls(input.clsP75),
      why: pickStable(`cls|${input.clsP75}`, [
        "Layout shifts are stealing click intent. Reserve dynamic zones before content lands.",
        "CavBot sees unstable rails on load. Lock dimensions to prevent late movement.",
        "Visual stability is drifting. Anchor media and injected UI blocks to stop misclick churn.",
      ] as const),
      improves: `Expected outcome: remove roughly ${fmtInt(shiftLift)} basis points of layout shift across mobile-heavy sessions.`,
      href: "/console",
      _rank: rankForTone(tone),
      _mag: Math.max(1, (input.clsP75 ?? 0) * 1000),
      effortOwner: "Console",
    });
  }

  if (input.titleCoveragePct != null || input.descriptionCoveragePct != null || input.canonicalCoveragePct != null || input.noindexPct != null) {
    const tone = toneFromCoveragePct(input.titleCoveragePct);
    const pagesAtRisk =
      input.pagesObserved != null && input.titleCoveragePct != null
        ? Math.round(Math.max(0, ((100 - clamp(input.titleCoveragePct, 0, 100)) / 100) * input.pagesObserved))
        : 0;
    const mag = Math.max(1, 100 - (input.titleCoveragePct ?? 0));
    push({
      id: "core_seo_metadata",
      title: "Close SEO metadata gaps",
      tone,
      owner: "SEO",
      metricLabel: "Title cov.",
      metricValue: fmtPct(input.titleCoveragePct, 1),
      why: pickStable(`seo_meta|${input.titleCoveragePct}|${input.descriptionCoveragePct}|${input.canonicalCoveragePct}`, [
        "Metadata drift is diluting crawl clarity. Repair high-traffic templates before long-tail pages.",
        "Title/description coverage is leaking index quality. Fix template roots, then route exceptions.",
        "CavBot spotted metadata blind spots. Tighten title + description coverage where demand is highest.",
      ] as const),
      improves: `Expected outcome: bring about ${fmtInt(pagesAtRisk)} pages back into clean index posture.`,
      href: "/seo",
      _rank: rankForTone(tone),
      _mag: mag,
      effortOwner: "SEO",
    });
  }

  if (input.a11yIssues != null || input.contrastFails != null || input.focusWarns != null) {
    const total = (input.a11yIssues ?? 0) + (input.contrastFails ?? 0) + (input.focusWarns ?? 0);
    const tone = toneForCount(total);
    const fixes = Math.round(total * 0.58);
    push({
      id: "core_a11y_blockers",
      title: "Fix accessibility blockers",
      tone,
      owner: "A11y",
      metricLabel: "A11y",
      metricValue: total === 0 ? "0" : fmtInt(total),
      why: pickStable(`a11y|${total}|${input.contrastFails}|${input.focusWarns}`, [
        "CavBot flagged usability blockers for keyboard and assistive tech paths. Close labels first.",
        "A11y debt is visible in interaction rails. Fix names/roles, then contrast and focus loops.",
        "Accessibility issues are throttling confidence. Start with critical affordances users touch every session.",
      ] as const),
      improves: `Expected outcome: clear about ${fmtInt(fixes)} blockers and improve conversion reliability on assistive journeys.`,
      href: "/console",
      _rank: rankForTone(tone),
      _mag: total,
      effortOwner: "A11y",
    });
  }

  for (const row of input.signals.routes) {
    const routeViews = Math.max(0, row.views);
    const weight = routeViews / totalRouteViews;
    const route404 = Math.round((input.views404 ?? 0) * weight);
    const routeErr = Math.round(totalErrors * weight);
    const pressure = routeViews * 0.75 + route404 * 2 + routeErr * 1.6;
    const tone: Tone = pressure >= 55 ? "bad" : pressure >= 16 ? "ok" : "good";
    const path = clipRoutePath(row.path);
    push({
      id: `route_${path.toLowerCase()}`,
      title: `Harden route ${path}`,
      tone,
      owner: "Routes",
      metricLabel: "Route views",
      metricValue: fmtInt(routeViews),
      why: pickStable(`route|${row.path}|${routeViews}|${route404}|${routeErr}`, [
        "This path is carrying real traffic weight. Small fixes here move posture faster than broad sweeps.",
        "CavBot marks this route as high leverage. Tightening this lane amplifies every downstream metric.",
        "High-traffic surface detected. Route-level cleanup here punches above its effort class.",
      ] as const),
      improves:
        route404 >= routeErr
          ? `Expected outcome: remove about ${fmtInt(route404)} broken-route hits from this path cluster.`
          : `Expected outcome: suppress about ${fmtInt(routeErr)} runtime failures linked to this route band.`,
      href: "/routes",
      _rank: rankForTone(tone),
      _mag: Math.max(1, pressure),
      effortOwner: "Routes",
      confidence: 0.82,
    });
  }

  for (const group of input.signals.errors) {
    if (group.hits <= 0) continue;
    const tone = toneForCount(group.hits);
    const share = group.hits / totalErrorHits;
    const repeats = Math.round(group.hits * 0.7);
    const sessionLift = group.sessions != null ? Math.round((group.sessions || 0) * 0.5) : null;
    const routeTag = group.routePath ? ` · ${clipRoutePath(group.routePath, 28)}` : "";
    push({
      id: `error_${group.key}`,
      title: `Neutralize fingerprint: ${group.label.slice(0, 58)}${group.label.length > 58 ? "…" : ""}`,
      tone,
      owner: "Errors",
      metricLabel: "Fingerprint hits",
      metricValue: fmtInt(group.hits),
      why: pickStable(`error_group|${group.key}|${group.hits}|${group.sessions}|${group.status}`, [
        "This signature keeps recurring. One root-cause fix here removes repeated operational drag.",
        "CavBot ranked this fingerprint as repeat-heavy. Clearing it prevents regression loops.",
        "High-frequency error cluster detected. Fixing this once reduces duplicate incident volume.",
      ] as const),
      improves:
        sessionLift != null
          ? `Expected outcome: remove ~${fmtInt(repeats)} repeats and protect ~${fmtInt(sessionLift)} sessions${routeTag}.`
          : `Expected outcome: remove ~${fmtInt(repeats)} repeats across observed error load (${fmtPct(share * 100, 1)} share).`,
      href: "/errors",
      _rank: rankForTone(tone),
      _mag: Math.max(1, group.hits * 1.6 + (group.sessions ?? 0) * 2.1),
      effortOwner: "Errors",
      confidence: 0.9,
    });
  }

  for (const issue of input.signals.a11y) {
    if (issue.hits <= 0) continue;
    const tone = toneForCount(issue.hits);
    const share = issue.hits / totalA11yHits;
    const cut = Math.round(issue.hits * 0.62);
    push({
      id: `a11y_${issue.key}`,
      title: `Resolve a11y issue: ${issue.label.slice(0, 62)}${issue.label.length > 62 ? "…" : ""}`,
      tone,
      owner: "A11y",
      metricLabel: "Issue hits",
      metricValue: fmtInt(issue.hits),
      why: pickStable(`a11y_hotspot|${issue.key}|${issue.hits}`, [
        "This issue type is repeating across pages. Template-level repair here removes broad accessibility debt.",
        "CavBot sees this blocker across multiple surfaces. Fix the shared component once and reuse the win.",
        "This a11y hotspot is compounding. Clearing it now prevents repeated audit failures.",
      ] as const),
      improves: `Expected outcome: clear about ${fmtInt(cut)} repeats (${fmtPct(share * 100, 1)} of observed a11y load).`,
      href: "/console",
      _rank: rankForTone(tone),
      _mag: Math.max(1, issue.hits * 1.4),
      effortOwner: "A11y",
      confidence: 0.84,
    });
  }

  if (!items.length) {
    const observedSignals = [
      input.titleCoveragePct,
      input.descriptionCoveragePct,
      input.canonicalCoveragePct,
      input.noindexPct,
      input.rate404Pct,
      input.views404,
      input.jsErrors,
      input.apiErrors,
      input.lcpP75Ms,
      input.inpP75Ms,
      input.clsP75,
      input.a11yIssues,
      input.contrastFails,
      input.focusWarns,
    ].filter((v) => v != null).length;

    push({
      id: "telemetry_warmup",
      title: "Telemetry coverage is warming up",
      tone: observedSignals >= 6 ? "ok" : "bad",
      owner: "Console",
      metricLabel: "Signals observed",
      metricValue: `${fmtInt(observedSignals)}/14`,
      why: "CavBot only ranks what it can observe. Add live traffic + audits for full deterministic queueing.",
      improves: "Expected outcome: once coverage fills, Mission Control will auto-rank route-level and fingerprint-level fixes.",
      href: "/console",
      _rank: observedSignals >= 6 ? 2 : 3,
      _mag: Math.max(1, 14 - observedSignals),
      effortOwner: "Console",
      confidence: 1,
    });
  }

  return items.sort((a, b) => b._lift - a._lift || b._rank - a._rank || b._mag - a._mag || a.id.localeCompare(b.id));
}

function toneWorst(a: Tone, b: Tone): Tone {
  if (a === "bad" || b === "bad") return "bad";
  if (a === "ok" || b === "ok") return "ok";
  return "good";
}

function MissionControl({ items, forecast }: { items: MissionItem[]; forecast: MissionForecast }) {
  const tone = items.reduce((acc, it) => toneWorst(acc, it.tone), "good" as Tone);
  const rowTone = (t: Tone) => (t === "bad" ? "bad" : t === "ok" ? "ok" : "good");

  return (
    <article className={`ins-mission tone-${tone}`} aria-label="Mission control">
      <header className="ins-mission-top">
        <div className="ins-mission-left">
          <h3 className="ins-mission-title">Mission Control</h3>
          <p className="ins-mission-sub">Fix these first. Highest lift with the lowest effort.</p>
        </div>
        <p className="ins-mission-count" aria-label={`Queue ${items.length}`}>
          Queue {items.length}
        </p>
      </header>
      <ol className={`ins-mq${items.length > 6 ? " is-scroll" : ""}`} aria-label="Top priority queue">
        {items.map((it, i) => (
          <li key={it.id} className={`ins-mq-item tone-${rowTone(it.tone)}`}>
            <a className="ins-mq-row" href={it.href} aria-label={`${it.title} — Open`}>
              <div className="ins-mq-main">
                <span className="ins-mq-index mono">{String(i + 1).padStart(2, "0")}</span>
                <div className="ins-mq-left">
                  <h4 className="ins-mq-title">{it.title}</h4>
                  <p className="ins-mq-why">{it.why}</p>
                  <p className="ins-mq-improve">{it.improves}</p>
                </div>
              </div>
              <dl className="ins-mq-meta mono">
                <div>
                  <dt>Priority</dt>
                  <dd>{it.impact}</dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>{it.owner}</dd>
                </div>
                <div>
                  <dt>{it.metricLabel}</dt>
                  <dd>{it.metricValue}</dd>
                </div>
              </dl>
            </a>
          </li>
        ))}
      </ol>
      <div className={`ins-mission-forecast tone-${forecast.tone}`} aria-label="Projected improvement if queue ships">
        <p className="ins-mission-forecast-head">{forecast.headline}</p>
        <p className="ins-mission-forecast-sub">{forecast.summary}</p>
        {forecast.chips.length ? (
          <div className="ins-mission-forecast-chips" aria-label="Projected outcomes">
            {forecast.chips.map((chip) => (
              <span key={chip} className="ins-mission-chip mono">
                {chip}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default async function InsightsPage({ searchParams }: PageProps) {
  noStore();
  const sp = await searchParams;
  const requestHeaders = await headers();
  const req = new Request("https://cavbot.local/insights", {
    headers: new Headers(requestHeaders),
  });

  const gate = await gateModuleAccess(req, "insights");

  if (!gate.ok) {
    return (
      <AppShell title="Workspace" subtitle="Workspace command center">
        <LockedModule
          moduleName="Guardian Intelligence"
          description="A consolidated posture read across SEO, stability, vitals, and accessibility—prioritized into actionable fixes."
          requiredPlanLabel="Premium+"
        />
      </AppShell>
    );
  }

  const range = (typeof sp?.range === "string" ? sp.range : "24h") as RangeKey;

  let ws: WorkspaceView | null = null;
  try {
    ws = await readWorkspace();
  } catch {
    ws = null;
  }

  const targets = normalizeTargets(ws);
  const sites = targets.map((t) => ({ id: t.id, label: resolveSiteLabel(t), url: t.origin }));

  const siteParam = typeof sp?.site === "string" ? sp.site : "";

  const wsActiveOrigin =
    canonicalOrigin(ws?.activeSiteOrigin || ws?.selection?.activeSiteOrigin || ws?.activeSite?.origin || ws?.workspace?.activeSiteOrigin || "") || "";

  const siteById = sites.find((s) => s.id === siteParam);
  const siteByOrigin = siteParam.startsWith("http") ? sites.find((s) => s.url === canonicalOrigin(siteParam)) : null;
  const siteByWorkspace = !siteParam && wsActiveOrigin ? sites.find((s) => s.url === wsActiveOrigin) : null;

  const activeSite = siteById || siteByOrigin || siteByWorkspace || sites[0] || { id: "none", label: "No site selected", url: "" };

  const projectId = String(ws?.projectId || ws?.project?.id || ws?.account?.projectId || "1");

  let summary: ProjectSummary | null = null;

  let guardianScore: number | null = null;

  let pagesObserved: number | null = null;
  let titleCoveragePct: number | null = null;
  let descriptionCoveragePct: number | null = null;
  let canonicalCoveragePct: number | null = null;
  let noindexPct: number | null = null;
  let missingH1Pct: number | null = null;

  let lcpP75Ms: number | null = null;
  let inpP75Ms: number | null = null;
  let clsP75: number | null = null;

  let views404: number | null = null;
  let rate404Pct: number | null = null;

  let jsErrors: number | null = null;
  let apiErrors: number | null = null;

  let a11yIssues: number | null = null;
  let contrastFails: number | null = null;
  let focusWarns: number | null = null;

  let trend: TrendPoint[] = [];
  let hotspots = { topRoutes: [] as HotspotRow[], topErrors: [] as HotspotRow[], topA11y: [] as HotspotRow[] };

  let scoreTrendRaw: ScoreTrendPoint[] = [];

  try {
    summary = await getProjectSummary(projectId, {
      range: range === "30d" ? "30d" : "7d",
      siteOrigin: activeSite.url || undefined,
    });

    guardianScore = pickNumber(summary, [
      "guardianScore",
      "metrics.guardianScore",
      "guardian.score",
      "guardian.summary.score",
      "snapshot.guardianScore",
      "diagnostics.guardianScore",
    ]);

    pagesObserved = pickNumber(summary, [
      "seo.rollup.pagesObserved",
      "seo.summary.pagesObserved",
      "seo.pagesObserved",
      "seoPosture.pagesObserved",
      "diagnostics.seo.pagesObserved",
    ]);
    titleCoveragePct = pickNumber(summary, [
      "seo.rollup.titleCoveragePct",
      "seo.rollup.titleCoverage",
      "seo.titleCoveragePct",
      "seoPosture.titleCoveragePct",
      "diagnostics.seo.titleCoveragePct",
    ]);
    descriptionCoveragePct = pickNumber(summary, [
      "seo.rollup.descriptionCoveragePct",
      "seo.rollup.metaDescriptionCoveragePct",
      "seo.descriptionCoveragePct",
      "diagnostics.seo.descriptionCoveragePct",
    ]);
    canonicalCoveragePct = pickNumber(summary, ["seo.rollup.canonicalCoveragePct", "seo.canonicalCoveragePct", "diagnostics.seo.canonicalCoveragePct"]);
    noindexPct = pickNumber(summary, ["seo.rollup.noindexPct", "seo.noindexPct", "diagnostics.seo.noindexPct"]);
    missingH1Pct = pickNumber(summary, ["seo.rollup.missingH1Pct", "seo.missingH1Pct", "diagnostics.seo.missingH1Pct"]);

    lcpP75Ms = pickNumber(summary, ["webVitals.rollup.lcpP75Ms", "vitals.rollup.lcpP75Ms", "performance.vitals.lcpP75Ms", "webVitals.lcpP75Ms"]);
    inpP75Ms = pickNumber(summary, ["webVitals.rollup.inpP75Ms", "vitals.rollup.inpP75Ms", "performance.vitals.inpP75Ms", "webVitals.inpP75Ms"]);
    clsP75 = pickNumber(summary, ["webVitals.rollup.clsP75", "vitals.rollup.clsP75", "performance.vitals.clsP75", "webVitals.clsP75"]);

    views404 = pickNumber(summary, ["views404_24h", "metrics.views404_24h", "totals.views404", "diagnostics.totals.views404", "trend24h.views404"]);
    rate404Pct = pickNumber(summary, ["rate404Pct", "metrics.rate404Pct", "diagnostics.rate404Pct", "snapshot.rate404Pct"]);

    jsErrors = pickNumber(summary, ["errors.totals.js", "diagnostics.errors.totals.js", "totals.jsErrors", "metrics.jsErrors"]);
    apiErrors = pickNumber(summary, ["errors.totals.api", "diagnostics.errors.totals.api", "totals.apiErrors", "metrics.apiErrors"]);

    a11yIssues = pickNumber(summary, ["a11y.issues", "a11y.totalIssues", "accessibility.issues", "diagnostics.a11y.issues"]);
    contrastFails = pickNumber(summary, ["a11y.contrastFailures", "accessibility.contrastFailures", "diagnostics.a11y.contrastFailures"]);
    focusWarns = pickNumber(summary, ["a11y.focusWarnings", "accessibility.focusWarnings", "diagnostics.a11y.focusWarnings"]);

    trend = normalizeTrend(summary);
    hotspots = normalizeHotspots(summary);

    scoreTrendRaw = normalizeScoreTrend(summary);
  } catch {
    summary = null;
  }

  function hrefWith(next: Partial<{ range: RangeKey; site: string }>) {
    const p = new URLSearchParams();
    p.set("module", "insights");
    p.set("projectId", projectId);
    p.set("range", next.range || range);
    const siteId = next.site || activeSite.id;
    if (siteId && siteId !== "none") p.set("siteId", siteId);
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  const breakdown = calcScoreBreakdown({
    titleCoveragePct,
    descriptionCoveragePct,
    canonicalCoveragePct,
    noindexPct,
    missingH1Pct,
    rate404Pct,
    views404,
    jsErrors,
    apiErrors,
    lcpP75Ms,
    inpP75Ms,
    clsP75,
    a11yIssues,
    contrastFails,
    focusWarns,
  });

  const guardianScoreDisplay = guardianScore ?? breakdown.computedScore ?? null;
  const posture = scoreLabel(guardianScoreDisplay);

  const insights = buildInsights({
    guardianScore: guardianScoreDisplay,

    pagesObserved,
    titleCoveragePct,
    descriptionCoveragePct,
    canonicalCoveragePct,
    noindexPct,
    missingH1Pct,

    lcpP75Ms,
    inpP75Ms,
    clsP75,

    views404,
    rate404Pct,

    jsErrors,
    apiErrors,

    a11yIssues,
    contrastFails,
    focusWarns,
  });

  const missionSignals = normalizeMissionSignals(summary);

  const missionQueue = buildMissionQueue({
    pagesObserved,
    titleCoveragePct,
    descriptionCoveragePct,
    canonicalCoveragePct,
    noindexPct,
    rate404Pct,
    views404,
    jsErrors,
    apiErrors,
    lcpP75Ms,
    inpP75Ms,
    clsP75,
    a11yIssues,
    contrastFails,
    focusWarns,
    signals: missionSignals,
  });

  const missionProjection = missionForecast({
    guardianScore: guardianScoreDisplay,
    pagesObserved,
    titleCoveragePct,
    rate404Pct,
    views404,
    jsErrors,
    apiErrors,
    lcpP75Ms,
    inpP75Ms,
    clsP75,
    a11yIssues,
    contrastFails,
    focusWarns,
    queueSize: missionQueue.length,
  });

  const trendBars = trend.length ? trend.map((p) => n(p.sessions ?? p.signals ?? 0, 0)) : [];
  const trendLine = trend.length ? trend.map((p) => n(p.views404 ?? p.errors ?? 0, 0)) : [];

  const rangeLen = range === "24h" ? 24 : range === "7d" ? 7 : range === "14d" ? 14 : 30;

  const scoreDays = scoreTrendRaw.length ? scoreTrendRaw.map((p) => p.day) : trend.length ? trend.map((p) => p.day) : [];

  const scoreSeries = scoreTrendRaw.length
    ? scoreTrendRaw.map((p) => clamp(p.score, 0, 100))
    : guardianScoreDisplay != null
    ? (scoreDays.length ? Array(scoreDays.length) : Array(rangeLen)).fill(clamp(guardianScoreDisplay, 0, 100))
    : [];

  const scoreSegs = scoreSeries.length ? scoreSegments(scoreSeries, 560, 160) : [];

  const LIVE_TZ = "America/Los_Angeles";

  const heroSignals = (() => {
    const v404 = views404 ?? null;
    const err = (jsErrors ?? null) != null || (apiErrors ?? null) != null ? (jsErrors ?? 0) + (apiErrors ?? 0) : null;
    if (v404 == null && err == null) return null;
    return (v404 ?? 0) + (err ?? 0);
  })();

  const cavaiSnapshotData =
    summary?.snapshot ?? summary?.diagnostics ?? summary ?? null;
  const cavaiSnapshotJson = (() => {
    if (!cavaiSnapshotData) return "null";
    try {
      return JSON.stringify(cavaiSnapshotData);
    } catch {
      return "null";
    }
  })();
  const cavaiSnapshotLiteral =
    cavaiSnapshotJson === "null" ? "null" : cavaiSnapshotJson.replace(/</g, "\\u003c");
  const cavaiContextOrigin = activeSite.url || "";
  const cavaiContextPages = pagesObserved ?? 1;
  const cavaiContextProjectId = projectId;
  const cavaiContextSiteId = activeSite.id || "";

  const heroSignalsTone = toneForCount(heroSignals);

  const vitalsTone = (() => {
    const a = toneForLcp(lcpP75Ms);
    const b = toneForInp(inpP75Ms);
    const c = toneForCls(clsP75);
    if (a === "bad" || b === "bad" || c === "bad") return "bad";
    if (a === "ok" || b === "ok" || c === "ok") return "ok";
    return "good";
  })();

  const a11yTone = toneForCount(a11yIssues);

  const firstInsight = insights[0] || null;
  const restInsights = insights.slice(1);

  const renderInsightPrimary = (it: InsightItem, key: number) => {
    const hasMetric = Boolean(it.metricLabel.trim() || it.metricValue.trim());
    return (
      <article key={key} className={`ins-finding ins-finding-primary tone-${it.tone}`}>
        <header className="ins-finding-top">
          <h3 className="ins-finding-title">{it.title}</h3>
          {hasMetric ? (
            <div className="ins-finding-metric" aria-label={`${it.metricLabel}: ${it.metricValue}`}>
              <span className="ins-finding-metric-label">{it.metricLabel}</span>
              <span className="ins-finding-metric-value">{it.metricValue}</span>
            </div>
          ) : null}
        </header>
        <dl className="ins-finding-details">
          <div>
            <dt>Why it matters</dt>
            <dd>{it.why}</dd>
          </div>
          <div>
            <dt>Next step</dt>
            <dd>{it.next}</dd>
          </div>
        </dl>
      </article>
    );
  };

  const renderInsightCompact = (it: InsightItem, key: number) => {
    const hasMetric = Boolean(it.metricLabel.trim() || it.metricValue.trim());
    return (
      <a key={key} className={`ins-finding ins-finding-tap tone-${it.tone}`} href={it.href} aria-label={`${it.title} — Open`}>
        <div className="ins-finding-top">
          <h3 className="ins-finding-title">{it.title}</h3>
          {hasMetric ? (
            <div className="ins-finding-metric">
              <span className="ins-finding-metric-label">{it.metricLabel}</span>
              <span className="ins-finding-metric-value">{it.metricValue}</span>
            </div>
          ) : null}
        </div>
      <dl className="ins-finding-details ins-finding-details-compact">
        <div>
          <dt>Why it matters</dt>
          <dd>{it.why}</dd>
        </div>
        <div>
          <dt>Next step</dt>
          <dd>{it.next}</dd>
        </div>
      </dl>
      <div className="ins-tap-hint">Open dashboard</div>
      </a>
    );
  };

  const scoreNote =
    scoreTrendRaw.length
      ? "Observed daily posture history."
      : guardianScoreDisplay != null
      ? "Daily posture history not available yet — showing baseline."
      : "No score available yet.";
  return (
    <AppShell title="Workspace" subtitle="Workspace command center">
      <div className="ins-page err-page">
        <div className="cb-console">
          {/* HEADER */}
          <header className="ins-head">
            <div className="ins-head-left">
              <div className="ins-titleblock">
                <h1 className="ins-h1">CavBot Insights</h1>
                <p className="ins-sub">A consolidated read of what CavBot observed, prioritized into actionable fixes.</p>
              </div>
            </div>

            <div className="ins-head-right" aria-label="Controls">
              <label className="seo-range" aria-label="Timeline">
                <span className="seo-range-label">Timeline</span>
                <select
                  className="seo-range-select"
                  defaultValue={range}
                  data-range-select
                  data-default-site={activeSite.id}
                >
                  <option value="24h">24H</option>
                  <option value="7d">7D</option>
                  <option value="14d">14D</option>
                  <option value="30d">30D</option>
                </select>
              </label>

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
                  src="/icons/app/tool-svgrepo-com.svg"
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
          <main className="ins-main ins-shell">
            {/* HERO */}
            <section className="ins-grid ins-shell-section" aria-label="Insights rollups">
              <article className={`cb-card tone-${posture.tone}`}>
                <div className="cb-card-top">
                  <div className="cb-card-label">Insight Score</div>
                  <div className="cb-card-metric">{guardianScoreDisplay == null ? "—" : fmtInt(guardianScoreDisplay)}</div>
                </div>
                <div className="cb-card-sub">A unified posture read from CavBot’s collected signals.</div>
              </article>

              <article className={`cb-card tone-${heroSignalsTone}`}>
                <div className="cb-card-top">
                  <div className="cb-card-label">Signals Observed</div>
                  <div className="cb-card-metric">{heroSignals == null ? "—" : fmtInt(heroSignals)}</div>
                </div>
                <div className="cb-card-sub">Combined signal volume for the selected target and range.</div>
              </article>

              <article className={`cb-card tone-${vitalsTone}`}>
                <div className="cb-card-top">
                  <div className="cb-card-label">Vitals Read</div>
                  <div className="cb-card-metric">{lcpP75Ms == null && inpP75Ms == null && clsP75 == null ? "—" : "P75"}</div>
                </div>
                <div className="cb-card-sub">Performance posture using available P75 vitals.</div>
              </article>

              <article className={`cb-card tone-${a11yTone}`}>
                <div className="cb-card-top">
                  <div className="cb-card-label">A11y Issues</div>
                  <div className="cb-card-metric">{a11yIssues == null ? "—" : fmtInt(a11yIssues)}</div>
                </div>
                <div className="cb-card-sub">Accessibility audit issue count for the selected target and range.</div>
              </article>
            </section>

            {/* FINDINGS */}
            <section className="cb-card cb-card-pad ins-shell-section" aria-label="Priority findings">
              <div className="cb-card-head ins-headrow ins-findings-head">
                <div>
                  <h2 className="cb-h2">Priority Findings</h2>
                  <p className="cb-sub">High-signal, actionable insights derived from what CavBot observed.</p>
                </div>
                <p className="ins-findings-meta">Showing {fmtInt(insights.length)} priorities</p>
              </div>

              {insights.length ? (
                <div className="ins-findings-shell">
                  <div className="ins-findings-main">
                    {/* LEFT COLUMN STACK: first finding + Mission Control */}
                    {firstInsight ? (
                      <div className="ins-leftstack">
                        {renderInsightPrimary(firstInsight, 0)}
                        <MissionControl items={missionQueue} forecast={missionProjection} />
                      </div>
                    ) : null}

                    {/* RIGHT COLUMN: Score explanation + score trend */}
                    <article className="ins-scorepanel" aria-label="Score explanation">
                      <div className="ins-scorepanel-top">
                        <div>
                          <h3 className="ins-scorepanel-title">Score Explained</h3>
                          <p className="ins-scorepanel-sub">{scoreNote}</p>
                        </div>
                      </div>

                      <div className="ins-scorechart" role="img" aria-label="Score trend chart">
                        {scoreSeries.length ? (
                          <svg className="ins-scorechart-svg" viewBox="0 0 560 160" preserveAspectRatio="none">
                            <line
                              className="ins-scorethr"
                              x1="0"
                              y1={160 - Math.round((92 / 100) * (160 - 18)) - 8}
                              x2="560"
                              y2={160 - Math.round((92 / 100) * (160 - 18)) - 8}
                            />
                            <line
                              className="ins-scorethr"
                              x1="0"
                              y1={160 - Math.round((80 / 100) * (160 - 18)) - 8}
                              x2="560"
                              y2={160 - Math.round((80 / 100) * (160 - 18)) - 8}
                            />

                            {scoreSegs.map((seg, i) => (
                              <path key={i} className={`ins-scoreline tone-${seg.tone}`} d={seg.d} />
                            ))}

                            <circle
                              className={`ins-scoredot tone-${toneForScore(scoreSeries[0] ?? null)}`}
                              cx="0"
                              cy={160 - Math.round(((scoreSeries[0] ?? 0) / 100) * (160 - 18)) - 8}
                              r="3.2"
                            />
                            <circle
                              className={`ins-scoredot tone-${toneForScore(scoreSeries[scoreSeries.length - 1] ?? null)}`}
                              cx="560"
                              cy={160 - Math.round(((scoreSeries[scoreSeries.length - 1] ?? 0) / 100) * (160 - 18)) - 8}
                              r="3.2"
                            />
                          </svg>
                        ) : (
                          <div className="ins-empty">
                            <div className="ins-empty-title">No score series available yet.</div>
                            <div className="ins-empty-sub">As CavBot records daily posture rollups, this chart will render observed history.</div>
                          </div>
                        )}

                        <div className="ins-scorelegend" aria-label="Legend">
                          <span className="ins-leg">
                            <span className="ins-dot ins-dot-bad" /> At Risk / Critical
                          </span>
                          <span className="ins-leg">
                            <span className="ins-dot ins-dot-ok" /> Stable
                          </span>
                          <span className="ins-leg">
                            <span className="ins-dot ins-dot-good" /> Elite
                          </span>
                        </div>
                      </div>

                      <div className="ins-scoreparts" aria-label="Score breakdown">
                        {breakdown.parts.map((p) => (
                          <div key={p.key} className={`ins-part tone-${p.tone}`}>
                            <div className="ins-part-top">
                              <div className="ins-part-left">
                                <div className="ins-part-label">{p.label}</div>
                                <div className="ins-part-sub">{p.detail}</div>
                              </div>
                              <div className="ins-part-right">
                                <div className="ins-part-w">{p.weightPct}%</div>
                                <div className="ins-part-s">{p.score == null ? "—" : fmtInt(p.score)}</div>
                              </div>
                            </div>
                            <div className="ins-part-bar" aria-hidden="true">
                              <span className="ins-part-fill" style={{ width: `${clamp(p.score ?? 0, 0, 100)}%` }} />
                            </div>
                            <div className="ins-part-fix">{p.fix}</div>
                          </div>
                        ))}
                      </div>

                      <div className="ins-scoretail" aria-label="CavAI action center">
                        <div className="ins-scoremeta">
                          <div className="ins-scoremeta-item">
                            <span className="ins-scoremeta-label mono">Output</span>
                            <strong className={`ins-scoreout tone-${posture.tone}`}>{guardianScoreDisplay == null ? "—" : `${fmtInt(guardianScoreDisplay)} / 100`}</strong>
                          </div>
                          <div className="ins-scoremeta-item">
                            <span className="ins-scoremeta-label mono">Window</span>
                            <strong>{scoreDays.length ? `${scoreDays[0]} → ${scoreDays[scoreDays.length - 1]}` : range.toUpperCase()}</strong>
                          </div>
                        </div>
                        <div className="ins-scoreintel" aria-live="polite" data-cavai-intel-root>
                          <p data-cavai-intel-trend>Trend: Waiting for CavAI data…</p>
                          <p data-cavai-intel-delta>Delta: Not enough history yet.</p>
                          <p data-cavai-intel-confidence>Confidence: Loading.</p>
                          <p data-cavai-intel-next>Next best action: Gathering intel.</p>
                          <span data-cavai-intel-fatigue hidden />
                        </div>
                        <div className="ins-cavai-actions" data-cavai-priority-actions>
                          <button
                            className="ins-link"
                            type="button"
                            data-cavai-create-note
                            disabled
                          >
                            Create Note
                          </button>
                          <button
                            className="ins-link"
                            type="button"
                            data-cavai-open-targets
                            title="No file target available yet."
                            disabled
                          >
                            Open in CavCode
                          </button>
                          <span className="ins-cavai-actions-status" data-cavai-actions-status>
                            Preparing deterministic priority actions...
                          </span>
                          <span className="ins-cavai-actions-toast" data-cavai-actions-toast hidden />
                        </div>
                      </div>
                      <div className="ins-cavai-chooser" data-cavai-file-chooser hidden>
                        <div className="ins-cavai-chooser-backdrop" data-cavai-file-chooser-close />
                        <div className="ins-cavai-chooser-dialog" role="dialog" aria-modal="true" aria-labelledby="cb-cavai-file-chooser-title">
                          <div className="ins-cavai-chooser-title" id="cb-cavai-file-chooser-title">
                            Multiple matches found — choose file.
                          </div>
                          <div className="ins-cavai-chooser-list" data-cavai-file-chooser-list />
                          <div className="ins-cavai-chooser-actions">
                            <button className="ins-link" type="button" data-cavai-file-chooser-cancel>
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  </div>

                  {restInsights.length ? (
                    <div className="ins-followups" aria-label="Additional findings">
                      {restInsights.map((it, idx) => renderInsightCompact(it, idx + 1))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="ins-empty">
                  <div className="ins-empty-title">No insights available yet.</div>
                  <div className="ins-empty-sub">Once CavBot receives live traffic and audit signals, this section will populate automatically.</div>
                </div>
              )}
            </section>

            {/* PERFORMANCE + SEO + ACCESSIBILITY SNAPSHOT */}
            <section className="ins-split ins-shell-section ins-lower-section" aria-label="Signal snapshots">
              <article className="cb-card cb-card-pad ins-lower-card">
                <div className="cb-card-head">
                  <div>
                    <h2 className="cb-h2">Vitals Snapshot</h2>
                    <p className="cb-sub">P75 vitals for the selected target and range.</p>
                  </div>
                </div>
                <div className="ins-mini-grid">
                  <div className={`ins-mini tone-${toneForLcp(lcpP75Ms)}`}>
                    <div className="ins-mini-k">LCP (P75)</div>
                    <div className="ins-mini-v">{fmtMs(lcpP75Ms)}</div>
                    <div className="ins-mini-sub">Largest Contentful Paint</div>
                  </div>

                  <div className={`ins-mini tone-${toneForInp(inpP75Ms)}`}>
                    <div className="ins-mini-k">INP (P75)</div>
                    <div className="ins-mini-v">{fmtMs(inpP75Ms)}</div>
                    <div className="ins-mini-sub">Interaction to Next Paint</div>
                  </div>

                  <div className={`ins-mini tone-${toneForCls(clsP75)}`}>
                    <div className="ins-mini-k">CLS (P75)</div>
                    <div className="ins-mini-v">{fmtCls(clsP75)}</div>
                    <div className="ins-mini-sub">Cumulative Layout Shift</div>
                  </div>
                </div>
              </article>

              <article className="cb-card cb-card-pad ins-lower-card">
                <div className="cb-card-head">
                  <div>
                    <h2 className="cb-h2">SEO Snapshot</h2>
                    <p className="cb-sub">Metadata coverage and indexability posture from observed pages.</p>
                  </div>
                </div>
                <div className="ins-mini-grid">
                  <div className={`ins-mini tone-${toneFromCoveragePct(titleCoveragePct)}`}>
                    <div className="ins-mini-k">Title Coverage</div>
                    <div className="ins-mini-v">{fmtPct(titleCoveragePct)}</div>
                    <div className="ins-mini-sub">Pages with a non-empty &lt;title&gt;</div>
                  </div>

                  <div className={`ins-mini tone-${toneFromCoveragePct(descriptionCoveragePct)}`}>
                    <div className="ins-mini-k">Desc. Coverage</div>
                    <div className="ins-mini-v">{fmtPct(descriptionCoveragePct)}</div>
                    <div className="ins-mini-sub">Pages with meta description</div>
                  </div>

                  <div className={`ins-mini tone-${toneForRatePct(noindexPct)}`}>
                    <div className="ins-mini-k">NoIndex</div>
                    <div className="ins-mini-v">{fmtPct(noindexPct)}</div>
                    <div className="ins-mini-sub">Indexing restrictions observed</div>
                  </div>
                </div>
              </article>
            </section>

            {/* TRENDS */}
            <section className="cb-card cb-card-pad ins-shell-section ins-lower-section ins-lower-trend" aria-label="Trends">
              <div className="cb-card-head ins-headrow ins-findings-head">
                <div>
                  <h2 className="cb-h2">Signal Trend</h2>
                  <p className="cb-sub">Traffic bars with a signal overlay (404 / error volume).</p>
                </div>
                <p className="ins-findings-meta">Days observed {fmtInt(trendBars.length)}</p>
              </div>
              {trendBars.length ? (
                <div className="ins-trend">
                  <svg className="ins-trend-svg" viewBox="0 0 560 140" preserveAspectRatio="none" aria-label="Trend chart">
                    <g className="ins-trend-bars" dangerouslySetInnerHTML={{ __html: svgBars(trendBars, 560, 140) }} />
                    {trendLine.length ? <path className="ins-trend-line" d={svgLinePath(trendLine, 560, 140)} /> : null}
                  </svg>

                  <div className="ins-trend-legend" aria-label="Legend">
                    <span className="ins-leg">
                      <span className="ins-dot" /> Sessions / signals (bars)
                    </span>
                    <span className="ins-leg">
                      <span className="ins-dot ins-dot-2" /> 404 / errors (line)
                    </span>
                  </div>
                </div>
              ) : (
                <div className="ins-empty">
                  <div className="ins-empty-title">No trend series available yet.</div>
                  <div className="ins-empty-sub">Once CavBot receives daily rollups, this chart will render real observed history.</div>
                </div>
              )}
            </section>

            {/* HOTSPOTS */}
            <section className="ins-hot ins-shell-section ins-lower-section" aria-label="Hotspots">
              <article className="cb-card cb-card-pad ins-lower-card">
                <div className="cb-card-head">
                  <div>
                    <h2 className="cb-h2">Hot Routes</h2>
                    <p className="cb-sub">Most seen routes. Use this to prioritize fixes.</p>
                  </div>
                </div>
                {hotspots.topRoutes.length ? (
                  <div className="ins-list" role="list">
                    {hotspots.topRoutes.map((r, i) => (
                      <div className="ins-row" role="listitem" key={i}>
                        <div className="ins-row-left">
                          <div className="ins-row-title mono">{r.label}</div>
                          <div className="ins-row-sub">Route</div>
                        </div>
                        <div className="ins-row-right">
                          <div className="ins-row-val">{fmtInt(r.value)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ins-empty">
                    <div className="ins-empty-title">No route list available yet.</div>
                    <div className="ins-empty-sub">When route rollups are present, CavBot will show the most visited paths here.</div>
                  </div>
                )}
              </article>

              <article className="cb-card cb-card-pad ins-lower-card">
                <div className="cb-card-head">
                  <div>
                    <h2 className="cb-h2">Top Error Groups</h2>
                    <p className="cb-sub">Recurring error fingerprints.</p>
                  </div>
                </div>
                {hotspots.topErrors.length ? (
                  <div className="ins-list" role="list">
                    {hotspots.topErrors.map((g, i) => (
                      <div className={`ins-row tone-${g.tone || "ok"}`} role="listitem" key={i}>
                        <div className="ins-row-left">
                          <div className="ins-row-title">{g.label}</div>
                          <div className="ins-row-sub">{g.sub || "Error group"}</div>
                        </div>
                        <div className="ins-row-right">
                          <div className="ins-row-val">{fmtInt(g.value)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ins-empty">
                    <div className="ins-empty-title">No error groups available yet.</div>
                    <div className="ins-empty-sub">As errors are ingested, CavBot will surface recurring fingerprints here.</div>
                  </div>
                )}
              </article>

              <article className="cb-card cb-card-pad ins-lower-card">
                <div className="cb-card-head">
                  <div>
                    <h2 className="cb-h2">A11y Hotspots</h2>
                    <p className="cb-sub">Most frequent accessibility issue types.</p>
                  </div>
                </div>
                {hotspots.topA11y.length ? (
                  <div className="ins-list" role="list">
                    {hotspots.topA11y.map((a, i) => (
                      <div className={`ins-row tone-${a.tone || "ok"}`} role="listitem" key={i}>
                        <div className="ins-row-left">
                          <div className="ins-row-title">{a.label}</div>
                          <div className="ins-row-sub">Issue type</div>
                        </div>
                        <div className="ins-row-right">
                          <div className="ins-row-val">{fmtInt(a.value)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ins-empty">
                    <div className="ins-empty-title">No accessibility breakdown yet.</div>
                    <div className="ins-empty-sub">When audit breakdowns are present, CavBot will list the highest-frequency issues here.</div>
                  </div>
                )}
              </article>
            </section>
          </main>

          {/* Tools modal (still available, but de-toyed) */}
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
                  <a className="cb-btn cb-btn-ghost" data-tools-report href={`/console/report${hrefWith({})}`} target="_blank" rel="noreferrer">
                    Download report
                  </a>
                  <button className="cb-btn" type="button" data-tools-apply>
                    Apply
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* LIVE time ticker */}
          <Script id="cb-insights-live-time" strategy="afterInteractive">
            {`
(function(){
  try{
    if(window.__cbInsightsLiveTimeInt) clearInterval(window.__cbInsightsLiveTimeInt);
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
  window.__cbInsightsLiveTimeInt = setInterval(tick, 10000);
})();`}
          </Script>

          {/* Tools wiring (guarded) */}
          <Script id="cb-insights-tools-wire" strategy="afterInteractive">
            {`
(function(){
  if(document.documentElement.dataset.cbInsightsToolsWired === "1") return;
  document.documentElement.dataset.cbInsightsToolsWired = "1";

  var modal = document.querySelector("[data-tools-modal]");
  var openBtn = document.querySelector("[data-tools-open]");
  var closeEls = document.querySelectorAll("[data-tools-close]");
  var siteSel = document.querySelector("[data-tools-site]");
  var applyBtn = document.querySelector("[data-tools-apply]");
  var reportLink = document.querySelector("[data-tools-report]");

  function lockBody(on){
    try{ document.body.classList.toggle("cb-modal-open", !!on); }catch(e){}
  }

  function syncReportLink(){
    if(!reportLink) return;
    try{
      var p = new URLSearchParams(window.location.search || "");
      var range = p.get("range") || "24h";
      var site = (siteSel && siteSel.value) ? siteSel.value : (p.get("site") || "none");
      var projectId = ${JSON.stringify(projectId)};

      var next = new URLSearchParams();
      next.set("module", "insights");
      if(projectId) next.set("projectId", projectId);
      next.set("range", range);
      if(site && site !== "none") next.set("siteId", site);

      reportLink.setAttribute("href", "/console/report?" + next.toString());
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
    try{ if(openBtn) openBtn.focus(); }catch(e){}
  }

  if(openBtn) openBtn.addEventListener("click", open);
  closeEls.forEach(function(el){ el.addEventListener("click", close); });
  document.addEventListener("keydown", function(e){ if(e.key === "Escape") close(); });

  function apply(){
    try{
      var p = new URLSearchParams(window.location.search || "");
      var range = p.get("range") || "24h";
      var site = siteSel && siteSel.value ? siteSel.value : (p.get("site") || "none");

      var next = new URLSearchParams();
      next.set("range", range);
      next.set("site", site);

      window.location.search = "?" + next.toString();
    }catch(e){}
  }
  if(applyBtn) applyBtn.addEventListener("click", apply);

  if(siteSel){
    siteSel.addEventListener("change", function(){ syncReportLink(); });
  }

  var rangeSel = document.querySelector("[data-range-select]");
  if(rangeSel && rangeSel.tagName === "SELECT"){
    rangeSel.addEventListener("change", function(){
      try{
        var p = new URLSearchParams(window.location.search || "");
        var nextRange = rangeSel.value || (p.get("range") || "24h");
        var nextSite = p.get("site") || (rangeSel.getAttribute("data-default-site") || "none");
        p.set("range", nextRange);
        p.set("site", nextSite);
        window.location.search = "?" + p.toString();
      }catch(e){}
    });
  }

  syncReportLink();
})();`}
          </Script>
          <Script id="cb-insights-cavai-intel" strategy="afterInteractive">
            {`
(function(){
  if(window.__cbInsightsCavaiIntelInit) return;
  window.__cbInsightsCavaiIntelInit = true;
  var summary = ${cavaiSnapshotLiteral};
  if(!summary) return;
  var snapshot = (summary && (summary.snapshot || summary.diagnostics || summary)) || null;
  if(!snapshot) return;

  var requestContext = {
    origin: ${JSON.stringify(cavaiContextOrigin)},
    path: (window.location && window.location.pathname) ? window.location.pathname : "",
    pagesScanned: ${JSON.stringify(cavaiContextPages)},
    projectId: ${JSON.stringify(cavaiContextProjectId)},
    siteId: ${JSON.stringify(cavaiContextSiteId)}
  };

  var root = document.querySelector("[data-cavai-intel-root]");
  var actionRoot = document.querySelector("[data-cavai-priority-actions]");
  var createNoteBtn = actionRoot ? actionRoot.querySelector("[data-cavai-create-note]") : null;
  var openTargetsBtn = actionRoot ? actionRoot.querySelector("[data-cavai-open-targets]") : null;
  var actionStatus = actionRoot ? actionRoot.querySelector("[data-cavai-actions-status]") : null;
  var actionToast = actionRoot ? actionRoot.querySelector("[data-cavai-actions-toast]") : null;
  var chooserRoot = document.querySelector("[data-cavai-file-chooser]");
  var chooserList = chooserRoot ? chooserRoot.querySelector("[data-cavai-file-chooser-list]") : null;
  var chooserCancel = chooserRoot ? chooserRoot.querySelector("[data-cavai-file-chooser-cancel]") : null;
  var chooserCloseEls = chooserRoot ? chooserRoot.querySelectorAll("[data-cavai-file-chooser-close]") : [];
  var toastTimer = null;
  var deterministicPack = null;
  var activePriority = null;
  var pendingAmbiguousResolution = null;

  function emitPriorityEvent(name, extra){
    try{
      var analytics = window.cavbotAnalytics || null;
      var payload = {
        projectId: requestContext.projectId || null,
        siteId: requestContext.siteId || null,
        origin: requestContext.origin || null,
        runId: deterministicPack && deterministicPack.runId ? String(deterministicPack.runId) : null,
        priorityCode: activePriority && activePriority.code ? String(activePriority.code) : null,
        request_id: deterministicPack && deterministicPack.requestId ? String(deterministicPack.requestId) : null
      };
      if(extra && typeof extra === "object"){
        for(var key in extra){
          if(Object.prototype.hasOwnProperty.call(extra, key)){
            payload[key] = extra[key];
          }
        }
      }
      if(analytics && typeof analytics.track === "function"){
        analytics.track(name, payload, { component: "insights_priority_actions" });
      }else if(analytics && typeof analytics.trackConsole === "function"){
        analytics.trackConsole(name, payload);
      }
    }catch(_analyticsErr){}
  }

  function setActionStatus(message){
    if(actionStatus && typeof message === "string" && message){
      actionStatus.textContent = message;
    }
  }

  function showActionToast(message, tone){
    if(!actionToast || !message) return;
    actionToast.hidden = false;
    actionToast.textContent = String(message);
    actionToast.setAttribute("data-tone", tone === "bad" ? "bad" : tone === "good" ? "good" : "watch");
    if(toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function(){
      if(!actionToast) return;
      actionToast.hidden = true;
      actionToast.textContent = "";
      actionToast.removeAttribute("data-tone");
    }, 2600);
  }

  function setCreateNoteEnabled(enabled){
    if(createNoteBtn) createNoteBtn.disabled = !enabled;
  }

  function setOpenTargetEnabled(enabled, stateText){
    if(openTargetsBtn){
      openTargetsBtn.disabled = !enabled;
      if(typeof stateText === "string" && stateText){
        openTargetsBtn.setAttribute("title", stateText);
      }else{
        openTargetsBtn.removeAttribute("title");
      }
    }
  }

  function setPriorityActions(hasPack, message, hasOpenTargets){
    setCreateNoteEnabled(!!hasPack);
    if(hasPack && hasOpenTargets){
      setOpenTargetEnabled(true, "Opens the best matching file target.");
    }else{
      setOpenTargetEnabled(false, "No file target available yet.");
    }
    setActionStatus(message);
  }

  function resolveIntelligenceClient(){
    return window.cavbotIntelligence || (window.cavai && window.cavai.intelligence) || null;
  }

  function pickDeterministicPack(result){
    if(!result || typeof result !== "object") return null;
    if(
      result.packVersion &&
      result.runId &&
      result.priorities &&
      Array.isArray(result.priorities)
    ){
      return result;
    }
    if(result.ok === true && result.pack && typeof result.pack === "object") return result.pack;
    if(result.data && result.data.ok === true && result.data.pack && typeof result.data.pack === "object") {
      return result.data.pack;
    }
    return null;
  }

  function chooseTopPriority(pack){
    var rows = pack && Array.isArray(pack.priorities) ? pack.priorities.slice() : [];
    if(!rows.length) return null;
    rows.sort(function(a, b){
      var aScore = Number(a && a.priorityScore);
      var bScore = Number(b && b.priorityScore);
      if(bScore !== aScore) return bScore - aScore;
      var aCode = String((a && a.code) || "");
      var bCode = String((b && b.code) || "");
      if(aCode < bCode) return -1;
      if(aCode > bCode) return 1;
      return 0;
    });
    return rows[0] || null;
  }

  function kindRank(kind){
    if(kind === "cavcloudFileId") return 0;
    if(kind === "cavcloudPath") return 1;
    if(kind === "file") return 2;
    return 3;
  }

  function normalizeTarget(row){
    if(!row || typeof row !== "object") return null;
    var rawKind = String(row.kind || row.type || "").trim();
    var rawValue = String(row.value || row.target || "").trim();
    if(!rawKind || !rawValue) return null;
    if(rawKind !== "cavcloudFileId" && rawKind !== "cavcloudPath" && rawKind !== "file" && rawKind !== "url"){
      return null;
    }
    return {
      kind: rawKind,
      value: rawValue,
      label: String(row.label || "").trim(),
      folderId: String(row.folderId || "").trim(),
      workspaceId: String(row.workspaceId || "").trim(),
      sha256: String(row.sha256 || "").trim(),
      updatedAt: String(row.updatedAt || "").trim()
    };
  }

  function collectOpenTargets(priority){
    var normalized = [];
    var seen = {};
    var intel = resolveIntelligenceClient();
    if(intel && typeof intel.openTargetsForPriority === "function"){
      try{
        var direct = intel.openTargetsForPriority(priority) || [];
        for(var i = 0; i < direct.length; i++){
          var normalizedTarget = normalizeTarget(direct[i]);
          if(!normalizedTarget) continue;
          var key = normalizedTarget.kind + "|" + normalizedTarget.value + "|" + normalizedTarget.folderId + "|" + normalizedTarget.workspaceId + "|" + normalizedTarget.sha256;
          if(seen[key]) continue;
          seen[key] = true;
          normalized.push(normalizedTarget);
        }
      }catch(_e){}
    }

    if(!normalized.length && priority && Array.isArray(priority.nextActions)){
      for(var a = 0; a < priority.nextActions.length; a++){
        var action = priority.nextActions[a];
        if(!action || !Array.isArray(action.openTargets)) continue;
        for(var t = 0; t < action.openTargets.length; t++){
          var fallbackTarget = normalizeTarget(action.openTargets[t]);
          if(!fallbackTarget) continue;
          var fallbackKey = fallbackTarget.kind + "|" + fallbackTarget.value + "|" + fallbackTarget.folderId + "|" + fallbackTarget.workspaceId + "|" + fallbackTarget.sha256;
          if(seen[fallbackKey]) continue;
          seen[fallbackKey] = true;
          normalized.push(fallbackTarget);
        }
      }
    }

    normalized.sort(function(a, b){
      var rankDiff = kindRank(a.kind) - kindRank(b.kind);
      if(rankDiff !== 0) return rankDiff;
      var keyA = ((a.label || "") + "|" + (a.value || "")).toLowerCase();
      var keyB = ((b.label || "") + "|" + (b.value || "")).toLowerCase();
      if(keyA < keyB) return -1;
      if(keyA > keyB) return 1;
      return 0;
    });

    return normalized;
  }

  function updatePriorityActions(pack){
    deterministicPack = pack;
    activePriority = chooseTopPriority(pack);
    if(!activePriority){
      setPriorityActions(false, "No deterministic priorities available yet.", false);
      return;
    }
    var targets = collectOpenTargets(activePriority);
    setPriorityActions(true, "Priority: " + (activePriority.title || activePriority.code || "Top issue"), targets.length > 0);
  }

  function capitalize(value){
    return typeof value === "string" && value.length
      ? value.charAt(0).toUpperCase() + value.slice(1)
      : "";
  }

  function buildResolveContext(){
    var current = new URLSearchParams(window.location.search || "");
    var workspaceId = String(current.get("workspaceId") || current.get("workspace") || current.get("ws") || "").trim();
    var folderId = String(current.get("folderId") || "").trim();
    return {
      generatedAt: deterministicPack && deterministicPack.generatedAt ? String(deterministicPack.generatedAt) : "",
      workspaceId: workspaceId || "",
      folderId: folderId || "",
      projectId: requestContext.projectId || "",
      siteId: requestContext.siteId || "",
      origin: requestContext.origin || ""
    };
  }

  function closeChooser(){
    pendingAmbiguousResolution = null;
    if(chooserList) chooserList.innerHTML = "";
    if(chooserRoot) chooserRoot.hidden = true;
  }

  function openChooser(candidates, onPick){
    if(!chooserRoot || !chooserList || !Array.isArray(candidates) || !candidates.length){
      return false;
    }
    pendingAmbiguousResolution = onPick;
    chooserList.innerHTML = "";
    for(var i = 0; i < candidates.length; i++){
      var row = candidates[i];
      if(!row || !row.path) continue;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ins-cavai-chooser-item";
      btn.setAttribute("data-index", String(i));
      var path = String(row.path || "");
      var updatedAt = String(row.updatedAtISO || "");
      var title = document.createElement("strong");
      title.textContent = path;
      btn.appendChild(title);
      if(updatedAt){
        var meta = document.createElement("span");
        meta.textContent = "Updated " + updatedAt.replace("T", " ").replace("Z", " UTC").slice(0, 19);
        btn.appendChild(meta);
      }
      btn.addEventListener("click", function(ev){
        var targetEl = ev.currentTarget;
        var idx = Number(targetEl && targetEl.getAttribute ? targetEl.getAttribute("data-index") : "-1");
        if(!Number.isFinite(idx) || idx < 0 || idx >= candidates.length) return;
        if(typeof pendingAmbiguousResolution === "function"){
          pendingAmbiguousResolution(candidates[idx]);
        }
      });
      chooserList.appendChild(btn);
    }
    chooserRoot.hidden = false;
    return true;
  }

  function applyPack(pack){
    if(!root || !pack) return;
    var trendEl = root.querySelector("[data-cavai-intel-trend]");
    var deltaEl = root.querySelector("[data-cavai-intel-delta]");
    var confidenceEl = root.querySelector("[data-cavai-intel-confidence]");
    var nextEl = root.querySelector("[data-cavai-intel-next]");
    var fatigueEl = root.querySelector("[data-cavai-intel-fatigue]");
    var legacyIntel = (pack && typeof pack === "object" && pack.intel && typeof pack.intel === "object") ? pack.intel : null;
    var overlay = (pack && typeof pack === "object" && pack.overlay && typeof pack.overlay === "object") ? pack.overlay : null;
    var trend = (overlay && overlay.trend) || (legacyIntel && legacyIntel.trend) || { state: "stagnating", reason: "" };
    if(trendEl){
      var line = "Trend: " + capitalize(trend.state);
      if(trend.reason) line += " — " + trend.reason;
      trendEl.textContent = line;
    }
    if(deltaEl){
      var deltaSummary = (overlay && overlay.diff && overlay.diff.summary)
        ? overlay.diff.summary
        : (legacyIntel && legacyIntel.delta && legacyIntel.delta.deltaSummaryText)
          ? legacyIntel.delta.deltaSummaryText
          : "No delta available yet.";
      deltaEl.textContent = "Delta: " + deltaSummary;
    }
    if(confidenceEl){
      var level = (pack.confidence && pack.confidence.level) || (legacyIntel && legacyIntel.confidence) || "medium";
      var text = "Confidence: " + capitalize(level);
      var confidenceReason = (pack.confidence && pack.confidence.reason) || (legacyIntel && legacyIntel.confidenceReason) || "";
      if(confidenceReason) text += " — " + confidenceReason;
      confidenceEl.textContent = text;
    }
    if(nextEl){
      var nextAction = pack.nextActions && pack.nextActions[0] && pack.nextActions[0].title
        ? pack.nextActions[0].title
        : "";
      nextEl.textContent = nextAction ? "Next best action: " + nextAction : "Next best action: No action generated yet.";
    }
    if(fatigueEl){
      var fatigue = (overlay && overlay.fatigue) || (legacyIntel && legacyIntel.fatigue) || {};
      var fatigueLevel = String(
        fatigue.level ||
        fatigue.fatigueTone ||
        "none"
      ).toLowerCase();
      var fatigueMessage = String(
        fatigue.message ||
        fatigue.fatigueMessage ||
        ""
      );
      if(fatigueLevel !== "none" && fatigueMessage){
        fatigueEl.textContent = fatigueMessage;
        fatigueEl.hidden = false;
      } else {
        fatigueEl.hidden = true;
      }
    }
  }

  function onCreatePriorityNote(){
    if(!deterministicPack || !activePriority){
      setPriorityActions(false, "Run diagnostics first to create a note.", false);
      return;
    }
    var intel = resolveIntelligenceClient();
    if(!intel || typeof intel.priorityToCavPadNote !== "function"){
      setPriorityActions(false, "CavBot intelligence client is not ready yet.", false);
      return;
    }
    var template = null;
    try{
      template = intel.priorityToCavPadNote(deterministicPack, String(activePriority.code || ""));
    }catch(_e){
      template = null;
    }
    if(!template){
      setPriorityActions(true, "No deterministic note template available for this priority.", collectOpenTargets(activePriority).length > 0);
      return;
    }
    var runPart = deterministicPack && deterministicPack.runId ? String(deterministicPack.runId) : "run";
    var codePart = activePriority && activePriority.code ? String(activePriority.code) : "priority";
    var requestId = "note_" + runPart + "_" + codePart + "_" + Date.now().toString(36);
    window.dispatchEvent(new CustomEvent("cb:cavpad:create-note-from-priority", {
      detail: {
        requestId: requestId,
        title: template.title,
        evidenceLinks: Array.isArray(template.evidenceLinks) ? template.evidenceLinks : [],
        checklist: Array.isArray(template.checklist) ? template.checklist : [],
        verification: Array.isArray(template.verification) ? template.verification : [],
        confidenceSummary: String(template.confidenceSummary || ""),
        riskSummary: String(template.riskSummary || "")
      }
    }));
    emitPriorityEvent("priority_note_created");
    setPriorityActions(true, "CavBot sent this priority to CavPad.", collectOpenTargets(activePriority).length > 0);
    showActionToast("CavBot sent this priority to CavPad.", "good");
  }

  async function onOpenFixTargets(){
    if(!activePriority){
      setPriorityActions(false, "Run diagnostics first to open in CavCode.", false);
      return;
    }
    emitPriorityEvent("priority_open_target_clicked");

    var targets = collectOpenTargets(activePriority);
    if(!targets.length){
      setPriorityActions(true, "No file target available yet.", false);
      emitPriorityEvent("open_target_not_found");
      return;
    }

    var intel = resolveIntelligenceClient();
    if(!intel || typeof intel.resolveOpenTarget !== "function"){
      setPriorityActions(true, "CavBot intelligence client is not ready yet.", true);
      return;
    }

    var resolved = null;
    try{
      resolved = await intel.resolveOpenTarget({
        targets: targets,
        context: buildResolveContext()
      });
    }catch(_resolveErr){
      resolved = null;
    }

    if(!resolved || resolved.ok !== true){
      if(resolved && resolved.reason === "ambiguous" && Array.isArray(resolved.candidates) && resolved.candidates.length){
        var chooserOpened = openChooser(resolved.candidates, function(chosen){
          if(!chosen || !chosen.path) return;
          closeChooser();
          emitPriorityEvent("open_target_ambiguous_choice", {
            candidate_file_id: String(chosen.fileId || ""),
            candidate_path: String(chosen.path || "")
          });
          emitPriorityEvent("open_target_resolved", { resolution: "cavcloud" });
          var href = "";
          try{
            if(intel && typeof intel.buildCavCodeHref === "function"){
              href = intel.buildCavCodeHref(String(chosen.path || ""), window.location.search || "");
            }
          }catch(_hrefErr){}
          if(!href){
            var next = new URLSearchParams(window.location.search || "");
            next.set("cloud", "1");
            next.set("file", String(chosen.path || ""));
            href = "/cavcode?" + next.toString();
          }
          window.location.href = href;
        });
        if(chooserOpened){
          setPriorityActions(true, "Multiple matches found — choose file.", true);
          showActionToast("Multiple matches found — choose file.", "watch");
          return;
        }
      }

      var fallbackMessage = resolved && typeof resolved.message === "string" && resolved.message
        ? resolved.message
        : "No matching file found in CavCloud or CavCode.";
      var disableOpen = resolved && resolved.reason === "no_targets";
      setPriorityActions(true, fallbackMessage, !disableOpen);
      showActionToast(fallbackMessage, "watch");
      emitPriorityEvent("open_target_not_found");
      return;
    }

    if(resolved.resolution === "url" && resolved.url){
      try{
        window.open(String(resolved.url), "_blank", "noopener,noreferrer");
        emitPriorityEvent("open_target_resolved", { resolution: "url" });
        setPriorityActions(true, "Opened URL target.", true);
      }catch(_urlErr){
        setPriorityActions(true, "No matching file found in CavCloud or CavCode.", true);
        showActionToast("No matching file found in CavCloud or CavCode.", "watch");
        emitPriorityEvent("open_target_not_found");
      }
      return;
    }

    if((resolved.resolution === "cavcloud" || resolved.resolution === "cavcode") && resolved.filePath){
      var href = "";
      try{
        if(intel && typeof intel.buildCavCodeHref === "function"){
          href = intel.buildCavCodeHref(String(resolved.filePath || ""), window.location.search || "");
        }
      }catch(_buildErr){}
      if(!href){
        var current = new URLSearchParams(window.location.search || "");
        current.set("cloud", "1");
        current.set("file", String(resolved.filePath || ""));
        href = "/cavcode?" + current.toString();
      }
      emitPriorityEvent("open_target_resolved", { resolution: resolved.resolution });
      window.location.href = href;
      return;
    }

    setPriorityActions(true, "No matching file found in CavCloud or CavCode.", true);
    showActionToast("No matching file found in CavCloud or CavCode.", "watch");
    emitPriorityEvent("open_target_not_found");
  }

  if(createNoteBtn) createNoteBtn.addEventListener("click", onCreatePriorityNote);
  if(openTargetsBtn) openTargetsBtn.addEventListener("click", function(){ void onOpenFixTargets(); });
  if(chooserCancel) chooserCancel.addEventListener("click", closeChooser);
  if(chooserCloseEls && chooserCloseEls.length){
    chooserCloseEls.forEach(function(el){
      el.addEventListener("click", closeChooser);
    });
  }
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape") closeChooser();
  });

  setPriorityActions(false, "Preparing deterministic priority actions...", false);

  function requestPersistedPack(){
    if(!requestContext.origin) return Promise.resolve(null);
    var endpoint = "/api/cavai/packs?origin=" + encodeURIComponent(String(requestContext.origin || "")) + "&limit=6";
    return fetch(endpoint, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    }).then(function(res){
      return res.json().catch(function(){ return null; }).then(function(json){
        if(!res.ok || !json || json.ok !== true || !json.pack || typeof json.pack !== "object"){
          return null;
        }
        return json.pack;
      });
    }).catch(function(){
      return null;
    });
  }

  function requestDeterministicPack(cav){
    if(!cav || typeof cav.requestDiagnostics !== "function") {
      setPriorityActions(false, "Insufficient data: run diagnostics for this origin.", false);
      return;
    }
    cav.requestDiagnostics({
      snapshot: snapshot,
      context: {
        origin: requestContext.origin,
        path: requestContext.path,
        pagesScanned: requestContext.pagesScanned
      }
    }).then(function(result){
      var pack = pickDeterministicPack(result);
      if(!pack){
        setPriorityActions(false, "CavBot priorities are not ready for this snapshot.", false);
        return;
      }
      updatePriorityActions(pack);
    }).catch(function(){
      setPriorityActions(false, "Deterministic diagnostics request failed.", false);
    });
  }

  var attempts = 0;
  function tryRunLegacy(){
    var cav = window.cavAI;
    if(cav && typeof cav.getSuggestionPack === "function"){
      try{
        var pack = cav.getSuggestionPack(snapshot, requestContext);
        applyPack(pack);
      }catch(_err){}
      requestDeterministicPack(cav);
      return;
    }
    if(attempts < 15){
      attempts += 1;
      window.setTimeout(tryRunLegacy, 150);
      return;
    }
    setPriorityActions(false, "Insufficient data: run diagnostics for this origin.", false);
  }
  requestPersistedPack().then(function(pack){
    if(pack){
      applyPack(pack);
      updatePriorityActions(pack);
      return;
    }
    tryRunLegacy();
  });
})();`}
          </Script>
        </div>
      </div>
    </AppShell>
  );
}
