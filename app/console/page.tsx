// app/console/page.tsx
// CavBot Console — Glass Guardian (no external libs)
// Uses AppShell for header + sidebar. Console styles are scoped (no shell overrides).

import "./console.css";
import Link from "next/link";
import { cookies } from "next/headers";
import AppShell from "@/components/AppShell";
import CavAiRouteRecommendations from "@/components/CavAiRouteRecommendations";
import DashboardToolsControls from "@/components/DashboardToolsControls";
import { COUNTRY_TERRITORY_ISO } from "@/geo/countries";
import { REGION_GROUPED } from "@/geo/regions";
import { getSession } from "@/lib/apiAuth";
import { findUserById, getAuthPool } from "@/lib/authDb";
import type { ProjectSummary } from "@/lib/cavbotTypes";
import { prisma } from "@/lib/prisma";
import {
  analyticsConsoleErrorCode,
  resolveAnalyticsConsoleContext,
} from "@/lib/analyticsConsole.server";

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

type GeoRow = ProjectSummary["geo"] extends { countries?: (infer U)[] }
  ? U
  : {
      country?: string;
      countryName?: string;
      region?: string;
      city?: string;
      sessions?: number;
      pageViews?: number;
      uniqueVisitors?: number;
    };

type GeoDotRank = "top1" | "top2" | "top3" | "other";
type GeoDot = {
  id: string;
  label: string;
  region: string;
  rank: GeoDotRank;
  x: number;
  y: number;
  coreR: number;
  ringR: number;
  value: number;
  share: number;
};

type GeoAnchor = { x: number; y: number; spreadX: number; spreadY: number };

const GEO_MAP_WIDTH = 1000;
const GEO_MAP_HEIGHT = 520;

const DEFAULT_GEO_ANCHOR: GeoAnchor = {
  x: 0.5,
  y: 0.5,
  spreadX: 0.06,
  spreadY: 0.05,
};

const GEO_REGION_ANCHORS: Record<string, GeoAnchor> = {
  "North America": { x: 0.205, y: 0.335, spreadX: 0.085, spreadY: 0.08 },
  "Central America": { x: 0.248, y: 0.49, spreadX: 0.04, spreadY: 0.05 },
  Caribbean: { x: 0.298, y: 0.45, spreadX: 0.04, spreadY: 0.045 },
  "South America": { x: 0.325, y: 0.705, spreadX: 0.07, spreadY: 0.09 },
  Europe: { x: 0.52, y: 0.29, spreadX: 0.06, spreadY: 0.055 },
  "Middle East": { x: 0.59, y: 0.41, spreadX: 0.055, spreadY: 0.055 },
  Africa: { x: 0.525, y: 0.61, spreadX: 0.075, spreadY: 0.105 },
  "South Asia": { x: 0.675, y: 0.49, spreadX: 0.055, spreadY: 0.06 },
  "East Asia": { x: 0.785, y: 0.355, spreadX: 0.07, spreadY: 0.075 },
  "Southeast Asia": { x: 0.755, y: 0.545, spreadX: 0.065, spreadY: 0.065 },
  "Central Asia": { x: 0.645, y: 0.355, spreadX: 0.06, spreadY: 0.06 },
  Oceania: { x: 0.845, y: 0.755, spreadX: 0.08, spreadY: 0.07 },
  "Antarctica / Remote": { x: 0.5, y: 0.92, spreadX: 0.25, spreadY: 0.02 },
};

function normalizeCountryKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COUNTRY_NAME_TO_CODE = (() => {
  const map = new Map<string, string>();
  for (const row of COUNTRY_TERRITORY_ISO) {
    const key = normalizeCountryKey(row.name);
    if (key && !map.has(key)) map.set(key, row.code.toUpperCase());
  }

  const aliases: Record<string, string> = {
    usa: "US",
    "u s a": "US",
    "united states of america": "US",
    uk: "GB",
    "u k": "GB",
    england: "GB",
    scotland: "GB",
    "great britain": "GB",
    "russian federation": "RU",
    "south korea": "KR",
    "north korea": "KP",
    "czech republic": "CZ",
    "ivory coast": "CI",
    uae: "AE",
    "viet nam": "VN",
    "lao people s democratic republic": "LA",
    "syrian arab republic": "SY",
    "moldova republic of": "MD",
    "tanzania united republic of": "TZ",
    "venezuela bolivarian republic of": "VE",
    "bolivia plurinational state of": "BO",
    "democratic republic of the congo": "CD",
    "dr congo": "CD",
    "congo brazzaville": "CG",
    "republic of the congo": "CG",
    "palestinian territories": "PS",
    "occupied palestinian territory": "PS",
    "hong kong sar": "HK",
    "macao sar": "MO",
  };

  for (const [name, code] of Object.entries(aliases)) {
    map.set(normalizeCountryKey(name), code);
  }
  return map;
})();

const ISO3_TO_ISO2: Record<string, string> = {
  USA: "US",
  GBR: "GB",
  FRA: "FR",
  DEU: "DE",
  ESP: "ES",
  ITA: "IT",
  CAN: "CA",
  AUS: "AU",
  NZL: "NZ",
  JPN: "JP",
  KOR: "KR",
  PRK: "KP",
  CHN: "CN",
  IND: "IN",
  BRA: "BR",
  ARG: "AR",
  MEX: "MX",
  ZAF: "ZA",
  RUS: "RU",
  TUR: "TR",
  IDN: "ID",
  PHL: "PH",
  MYS: "MY",
  SGP: "SG",
  THA: "TH",
  VNM: "VN",
  NLD: "NL",
  BEL: "BE",
  CHE: "CH",
  SWE: "SE",
  NOR: "NO",
  FIN: "FI",
  DNK: "DK",
  POL: "PL",
  UKR: "UA",
  IRL: "IE",
  PRT: "PT",
  ISR: "IL",
  SAU: "SA",
  ARE: "AE",
  QAT: "QA",
};

const REGION_BY_COUNTRY_CODE = (() => {
  const map = new Map<string, string>();
  for (const [region, codes] of Object.entries(REGION_GROUPED) as Array<[string, readonly string[]]>) {
    for (const code of codes) {
      map.set(code.toUpperCase(), region);
    }
  }
  return map;
})();

function hashUnit(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function resolveCountryCode(row: GeoRow | null | undefined) {
  if (!row) return "";
  const countryRaw = String(row.country || "").trim();
  if (/^[a-z]{2}$/i.test(countryRaw)) return countryRaw.toUpperCase();
  if (/^[a-z]{3}$/i.test(countryRaw)) return ISO3_TO_ISO2[countryRaw.toUpperCase()] || "";

  const countryByName = COUNTRY_NAME_TO_CODE.get(normalizeCountryKey(countryRaw));
  if (countryByName) return countryByName;

  const countryNameRaw = String(row.countryName || "").trim();
  const codeByCountryName = COUNTRY_NAME_TO_CODE.get(normalizeCountryKey(countryNameRaw));
  if (codeByCountryName) return codeByCountryName;

  return "";
}

function inferMacroRegion(row: GeoRow | null | undefined, countryCode: string) {
  if (countryCode) {
    const byCode = REGION_BY_COUNTRY_CODE.get(countryCode);
    if (byCode) return byCode;
  }

  const haystack = normalizeCountryKey(
    [row?.countryName, row?.country, row?.region, row?.city].filter(Boolean).join(" ")
  );
  if (!haystack) return "Unknown";

  if (/(america|canada|mexico|united states|usa)/.test(haystack)) return "North America";
  if (/(caribbean|bahamas|jamaica|haiti|cuba|dominican)/.test(haystack)) return "Caribbean";
  if (/(brazil|argentina|chile|colombia|peru|uruguay|venezuela|south america)/.test(haystack)) return "South America";
  if (/(europe|germany|france|spain|italy|uk|united kingdom|england|poland|sweden)/.test(haystack)) return "Europe";
  if (/(africa|nigeria|kenya|egypt|morocco|south africa|ghana)/.test(haystack)) return "Africa";
  if (/(middle east|saudi|uae|qatar|oman|israel|jordan|lebanon|iraq|iran)/.test(haystack)) return "Middle East";
  if (/(india|pakistan|bangladesh|sri lanka|nepal|bhutan|maldives)/.test(haystack)) return "South Asia";
  if (/(china|japan|korea|taiwan|mongolia|east asia)/.test(haystack)) return "East Asia";
  if (/(thailand|vietnam|indonesia|malaysia|philippines|singapore|laos|cambodia|myanmar)/.test(haystack))
    return "Southeast Asia";
  if (/(kazakhstan|uzbekistan|kyrgyzstan|tajikistan|turkmenistan|central asia)/.test(haystack))
    return "Central Asia";
  if (/(australia|new zealand|oceania|fiji|papua|solomon|samoa|tonga)/.test(haystack)) return "Oceania";
  if (/(antarctica|remote)/.test(haystack)) return "Antarctica / Remote";
  return "Unknown";
}

function readGeoLatLng(row: GeoRow | null | undefined): { lat: number; lng: number } | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const lat = nOrNull(record.latitude ?? record.lat ?? null);
  const lng = nOrNull(record.longitude ?? record.lng ?? record.lon ?? null);
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function mercatorProject(lat: number, lng: number): { x: number; y: number } {
  const safeLat = clamp(lat, -85, 85);
  const x = (lng + 180) / 360;
  const latRad = (safeLat * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / Math.PI) / 2;
  return { x, y: clamp(y, 0.02, 0.98) };
}

function buildGeoDots(rows: GeoRow[], totalGeoSessions: number): GeoDot[] {
  if (!Array.isArray(rows) || rows.length === 0 || totalGeoSessions <= 0) return [];

  const maxDots = 120;
  const dots: GeoDot[] = [];
  const sliced = rows.slice(0, maxDots);
  for (let i = 0; i < sliced.length; i++) {
    const row = sliced[i];
    const value = geoValue(row);
    if (value <= 0) continue;

    const label = geoLabel(row);
    const share = percentOf(totalGeoSessions, value);
    const rank: GeoDotRank = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "other";

    const code = resolveCountryCode(row);
    const macroRegion = inferMacroRegion(row, code);
    const anchor = GEO_REGION_ANCHORS[macroRegion] || DEFAULT_GEO_ANCHOR;

    const dotSeed = `${code || label}|${i}|${value}`;
    const jx = hashUnit(`${dotSeed}|x`) * 2 - 1;
    const jy = hashUnit(`${dotSeed}|y`) * 2 - 1;
    const rowCoords = readGeoLatLng(row);

    const projected = rowCoords ? mercatorProject(rowCoords.lat, rowCoords.lng) : null;
    const xNorm = projected
      ? clamp(projected.x + jx * 0.008, 0.03, 0.97)
      : clamp(anchor.x + jx * anchor.spreadX, 0.03, 0.97);
    const yNorm = projected
      ? clamp(projected.y + jy * 0.008, 0.07, 0.94)
      : clamp(anchor.y + jy * anchor.spreadY, 0.07, 0.94);

    const rankBase = rank === "top1" ? 8 : rank === "top2" ? 7 : rank === "top3" ? 6 : 4.5;
    const shareBoost = clamp(Math.sqrt(Math.max(0, share)) * 0.45, 0, 3.2);
    const coreR = clamp(rankBase + shareBoost, 4.2, 11.5);
    const ringR = coreR + 2.6;

    dots.push({
      id: `${code || label}-${i}`,
      label,
      region: macroRegion,
      rank,
      x: xNorm * GEO_MAP_WIDTH,
      y: yNorm * GEO_MAP_HEIGHT,
      coreR,
      ringR,
      value,
      share,
    });
  }
  return dots;
}

function geoDotTooltipWidth(label: string) {
  const base = 116 + String(label || "").trim().length * 4.6;
  return Math.round(clamp(base, 132, 248));
}

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

function toneFromThreshold(value: number | null, goodMax: number, watchMax: number): Tone {
  if (value == null) return "watch";
  if (value <= goodMax) return "good";
  if (value <= watchMax) return "watch";
  return "bad";
}

function fillLowerIsBetter(value: number | null, badAt: number) {
  if (value == null) return 0;
  const pct = 100 - (value / Math.max(0.000001, badAt)) * 100;
  return clamp(pct, 8, 100);
}

function buildSeries(trend: TrendPoint[]) {
  const labels = trend.map((t) => t.day.slice(5).replace("-", "\u2011")); // MM-DD (non-breaking hyphen)
  const sessions = trend.map((t) => n(t.sessions));
  const views404 = trend.map((t) => n(t.views404));
  return { labels, sessions, views404 };
}

function geoValue(row: GeoRow | null | undefined) {
  if (!row) return 0;
  return n(row.sessions ?? row.pageViews ?? row.uniqueVisitors ?? 0, 0);
}

function geoLabel(row: GeoRow | null | undefined) {
  if (!row) return "Unknown";
  return row.countryName || row.country || row.region || row.city || "Unknown";
}

function percentOf(total: number, value: number) {
  if (total <= 0) return 0;
  return (value / total) * 100;
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
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("env vars are missing") ||
    msg.includes("Missing env vars") ||
    msg.includes("CAVBOT_API_BASE_URL") ||
    msg.includes("CAVBOT_PROJECT_KEY")
  );
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
type TrendInput = { day?: string; sessions?: unknown; views404?: unknown };
type RouteInput = { routePath?: unknown; views?: unknown };
type A11yInput = { type?: unknown; count?: unknown };

function normalizeConsoleMetrics(raw: unknown): ConsoleMetrics {
  const safeTrend = (arr: unknown): TrendPoint[] => {
    const a = Array.isArray(arr) ? arr : [];
    return (a as TrendInput[])
      .map((t) => ({
        day: typeof t?.day === "string" ? t.day : "",
        sessions: n(t?.sessions, 0),
        views404: n(t?.views404, 0),
      }))
      .filter((t) => Boolean(t.day));
  };

  const safeRoutes = (arr: unknown): TopRoute[] => {
    const a = Array.isArray(arr) ? arr : [];
    return (a as RouteInput[])
      .map((r) => ({
        routePath: typeof r?.routePath === "string" ? r.routePath : String(r?.routePath ?? ""),
        views: n(r?.views, 0),
      }))
      .filter((r) => Boolean(r.routePath));
  };

  const safeA11yTypes = (arr: unknown) => {
    const a = Array.isArray(arr) ? arr : [];
    return (a as A11yInput[])
      .map((x) => ({
        type: typeof x?.type === "string" ? x.type : String(x?.type ?? "Unknown"),
        count: n(x?.count, 0),
      }))
      .filter((x) => Boolean(x.type));
  };

  const metrics = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  return {
    pageViews24h: n(metrics.pageViews24h),
    sessions30d: n(metrics.sessions30d),
    sessions40430d: n(metrics.sessions40430d),
    badgeInteractions30d: n(metrics.badgeInteractions30d),
    views40430d: n(metrics.views40430d),
    gameInteractions30d: n(metrics.gameInteractions30d),
    catches30d: n(metrics.catches30d),
    misses30d: n(metrics.misses30d),
    uniqueVisitors30d: n(metrics.uniqueVisitors30d),
    sessionsUnderGuard30d: n(metrics.sessionsUnderGuard30d),
    routesMonitored: n(metrics.routesMonitored),

    avgLcpMs: nOrNull(metrics.avgLcpMs),
    avgTtfbMs: nOrNull(metrics.avgTtfbMs),
    globalCls: nOrNull(metrics.globalCls),
    slowPagesCount: n(metrics.slowPagesCount),
    unstableLayoutPages: n(metrics.unstableLayoutPages),
    recoveryRate404: nOrNull(metrics.recoveryRate404),

    jsErrors30d: n(metrics.jsErrors30d),
    apiErrors30d: n(metrics.apiErrors30d),
    ctaClicks30d: n(metrics.ctaClicks30d),
    formSubmits30d: n(metrics.formSubmits30d),
    engagementPings30d: n(metrics.engagementPings30d),
    scroll90Sessions30d: n(metrics.scroll90Sessions30d),

    a11yAudits30d: n(metrics.a11yAudits30d),
    a11yIssues30d: n(metrics.a11yIssues30d),
    contrastFailures30d: n(metrics.contrastFailures30d),
    keyboardNavSessions30d: n(metrics.keyboardNavSessions30d),
    focusInvisible30d: n(metrics.focusInvisible30d),
    topA11yIssueTypes: safeA11yTypes(metrics.topA11yIssueTypes),

    guardianScore: n(metrics.guardianScore),

    piiRiskPercent: nOrNull(metrics.piiRiskPercent),
    aggregationCoveragePercent: nOrNull(metrics.aggregationCoveragePercent),
    retentionHorizonPercent: nOrNull(metrics.retentionHorizonPercent),

    trend7d: safeTrend(metrics.trend7d),
    trend30d: safeTrend(metrics.trend30d),

    topRoutes: safeRoutes(metrics.topRoutes),
  };
}

function hasMeasuredConsoleActivity(metrics: ConsoleMetrics | null) {
  if (!metrics) return false;
  const numericSignals = [
    metrics.pageViews24h,
    metrics.sessions30d,
    metrics.sessions40430d,
    metrics.badgeInteractions30d,
    metrics.views40430d,
    metrics.gameInteractions30d,
    metrics.uniqueVisitors30d,
    metrics.sessionsUnderGuard30d,
    metrics.routesMonitored,
    metrics.jsErrors30d,
    metrics.apiErrors30d,
    metrics.ctaClicks30d,
    metrics.formSubmits30d,
    metrics.engagementPings30d,
    metrics.a11yAudits30d,
    metrics.a11yIssues30d,
  ];
  if (numericSignals.some((value) => n(value) > 0)) return true;
  if ((metrics.topRoutes || []).length > 0) return true;
  if ((metrics.trend7d || []).some((point) => n(point.sessions) > 0 || n(point.views404) > 0)) return true;
  if ((metrics.trend30d || []).some((point) => n(point.sessions) > 0 || n(point.views404) > 0)) return true;
  return false;
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function firstInitialFromUsername(input: string): string {
  const source = String(input || "").trim().replace(/^@+/, "");
  if (!source) return "";
  const asciiMatch = source.match(/[A-Za-z0-9]/);
  const token = asciiMatch?.[0] || source[0] || "";
  return token.toUpperCase();
}

function profileToneToAccentColor(tone: string): string {
  const value = String(tone || "").trim().toLowerCase();
  if (value === "violet") return "#8b5cff";
  if (value === "blue") return "#4da3ff";
  if (value === "white") return "#f7fbff";
  if (value === "navy") return "#9fb6ff";
  if (value === "transparent") return "#f7fbff";
  return "#b9c85a";
}

type DashboardHeading = {
  appShellTitle: string;
  ownerLabel: string;
  accentColor: string;
};

async function resolveDashboardHeading(): Promise<DashboardHeading> {
  const fallbackOwner = "U's";
  const fallback: DashboardHeading = {
    appShellTitle: `${fallbackOwner} Dashboard`,
    ownerLabel: fallbackOwner,
    accentColor: profileToneToAccentColor("lime"),
  };
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.toString().trim();
    if (!cookie) return fallback;

    // getSession() only needs incoming cookies; use a fixed internal URL.
    const req = new Request("https://app.cavbot.internal/_console_dashboard_title", {
      headers: { cookie },
    });

    const sess = await getSession(req);
    if (!sess || sess.systemRole !== "user") return fallback;

    const userId = String(sess.sub || "").trim();
    if (!userId || userId === "system") return fallback;

    const [profile, authUser] = await Promise.all([
      prisma.user
        .findUnique({
          where: { id: userId },
          select: { displayName: true, fullName: true, username: true, avatarTone: true },
        })
        .catch(() => null),
      findUserById(getAuthPool(), userId).catch(() => null),
    ]);

    const accentColor = profileToneToAccentColor(String(profile?.avatarTone || authUser?.avatarTone || ""));
    const preferredName = String(profile?.fullName || profile?.displayName || authUser?.displayName || "").trim();
    if (preferredName) {
      const ownerLabel = `${preferredName}'s`;
      return {
        appShellTitle: `${ownerLabel} Dashboard`,
        ownerLabel,
        accentColor,
      };
    }

    const username = String(profile?.username || authUser?.username || "").trim().replace(/^@+/, "");
    if (username) {
      const initial = firstInitialFromUsername(username) || "U";
      const ownerLabel = `${initial}'s`;
      return {
        appShellTitle: `${ownerLabel} Dashboard`,
        ownerLabel,
        accentColor,
      };
    }

    return { ...fallback, accentColor };
  } catch {
    return fallback;
  }
}

export default async function ConsolePage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const analyticsContext = await resolveAnalyticsConsoleContext({
    searchParams: sp,
    defaultRange: "7d",
    pathname: "/dashboard",
  });

  const rangeKey = analyticsContext.range;
  const range = rangeKey;
  const projectId = analyticsContext.projectId;
  const activeSite = analyticsContext.activeSite;
  const dashboardToolSites = analyticsContext.sites.map((s) => ({ id: s.id, label: s.label, origin: s.url }));

  const hrefWith = (next: { range?: string; site?: string }) => {
    const p = new URLSearchParams();
    p.set("module", "console");
    if (projectId) p.set("projectId", projectId);
    const r = next.range ?? range;
    const s = next.site ?? activeSite.id;
    if (r) p.set("range", r);
    if (s && s !== "none") p.set("siteId", s);
    if (activeSite.url) p.set("origin", activeSite.url);
    const str = p.toString();
    return str ? `?${str}` : "";
  };

  const data: ProjectSummary | null = analyticsContext.summary;
  const loadError: unknown = analyticsContext.summaryError;

  const metrics: ConsoleMetrics | null = data?.metrics ? normalizeConsoleMetrics(data.metrics) : null;

  const projectLabel = analyticsContext.projectLabel || (projectId ? `Project ${projectId}` : "Project");

  const envMissing = Boolean(loadError && isEnvMissingError(loadError));
  const hasMetrics = Boolean(!loadError && metrics && hasMeasuredConsoleActivity(metrics));

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

  const geo = data?.geo ?? null;
  const geoCountries = geo && Array.isArray(geo.countries) ? geo.countries : [];
  const totalGeoSessions = geoCountries.reduce((sum, row) => sum + geoValue(row), 0);
  const sortedGeoCountries = geoCountries
    .slice()
    .sort((a, b) => geoValue(b) - geoValue(a));
  const geoDots = buildGeoDots(sortedGeoCountries, totalGeoSessions);
  const topGeoRows = sortedGeoCountries.slice(0, 3);
  const geoList = sortedGeoCountries.slice(0, 5);
  const primaryGeo = topGeoRows[0] ?? null;
  const hasGeoRows = topGeoRows.length > 0;
  const geoHeadline = hasGeoRows
    ? `Top traffic from ${geoLabel(primaryGeo)}`
    : "";
  const geoSubline = hasGeoRows
    ? `${fmtInt(totalGeoSessions)} sessions recorded`
    : "Awaiting the next scan to populate this map.";
  const primaryGeoShare = hasGeoRows
    ? percentOf(totalGeoSessions, geoValue(primaryGeo))
    : 0;

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
  const keyboardNav = metrics ? n(metrics.keyboardNavSessions30d) : 0;

  const denom = Math.max(1, audits);
  const issueRate = audits > 0 ? issuesCount / denom : 0;
  const contrastRate = audits > 0 ? contrastFails / denom : 0;
  const focusRate = audits > 0 ? focusInvisible / denom : 0;
  const keyboardNavRate =
    metrics && n(metrics.sessions30d) > 0 ? keyboardNav / Math.max(1, n(metrics.sessions30d)) : 0;

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
  const keyboardTone: Tone = keyboardNavRate >= 0.12 ? "good" : keyboardNavRate >= 0.05 ? "watch" : "bad";

  const auditsFill = fillFromCount(audits, 60);
  const issuesFill = fillFromRate(issueRate, 0.2);
  const contrastFill = fillFromRate(contrastRate, 0.25);
  const focusFill = fillFromRate(focusRate, 0.12);
  const keyboardFill = clamp(keyboardNavRate * 100, 0, 100);

  const lcpTone = toneFromThreshold(metrics?.avgLcpMs ?? null, 2500, 4000);
  const ttfbTone = toneFromThreshold(metrics?.avgTtfbMs ?? null, 800, 1800);
  const clsTone = toneFromThreshold(metrics?.globalCls ?? null, 0.1, 0.25);
  const slowPagesTone = toneFromThreshold(metrics ? n(metrics.slowPagesCount) : null, 3, 10);
  const unstableLayoutTone = toneFromThreshold(metrics ? n(metrics.unstableLayoutPages) : null, 0, 3);

  const lcpFill = fillLowerIsBetter(metrics?.avgLcpMs ?? null, 6000);
  const ttfbFill = fillLowerIsBetter(metrics?.avgTtfbMs ?? null, 2500);
  const clsFill = fillLowerIsBetter(metrics?.globalCls ?? null, 0.35);
  const slowPagesFill = fillLowerIsBetter(metrics ? n(metrics.slowPagesCount) : null, 15);
  const unstableLayoutFill = fillLowerIsBetter(metrics ? n(metrics.unstableLayoutPages) : null, 8);
  const dashboardHeading = await resolveDashboardHeading();

  return (
    <AppShell title={dashboardHeading.appShellTitle}>
      <div className="cb-console">
        <section className="cb-pagehead-row" aria-label="Dashboard page heading and controls">
          <div className="cb-pagehead">
            <h1 className="cb-pagehead-title">
              <Link
                href="/settings?tab=account#sx-theme-switcher"
                data-cb-route-intent="/settings?tab=account#sx-theme-switcher"
                data-cb-perf-source="console-title-theme-link"
                className="cb-pagehead-name-link"
                aria-label="Open theme color switcher"
              >
                <span className="cb-pagehead-name" style={{ color: dashboardHeading.accentColor }}>
                  {dashboardHeading.ownerLabel}
                </span>
              </Link>
              <span className="cb-pagehead-dashboard">Dashboard</span>
            </h1>
          </div>

          <div className="cb-pagehead-controls" aria-label="Dashboard tools">
            <DashboardToolsControls
              containerClassName="console-controls"
              rangeLabelClassName="console-range"
              rangeLabelTextClassName="console-range-label"
              rangeSelectClassName="console-range-select"
              buttonClassName="cb-tool-pill"
              range={rangeKey}
              sites={dashboardToolSites}
              selectedSiteId={activeSite.id}
              reportHref={`/dashboard/report${hrefWith({})}`}
            />
          </div>
        </section>

        {envMissing ? (
          <section className="cb-card cb-card-danger" aria-label="Missing environment variables">
            <div className="cb-card-head">
              <h1 className="cb-h1">Console is wired — analytics config is missing</h1>
              <p className="cb-sub">
                The server could not reach the analytics API for this project. Verify the production API base and project key registration.
              </p>
            </div>

            <div className="cb-kv">
              <div className="cb-kv-row">
                <span className="cb-k">Expected</span>
                <span className="cb-v">Registered analytics endpoint</span>
              </div>
              <div className="cb-kv-row">
                <span className="cb-k">Project</span>
                <span className="cb-v">{projectLabel}</span>
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

                  <div className="cb-hero-meta" role="group" aria-label="Guardian summary details">
                    <div className={`cb-hero-hintline tone-${scoreTone}`}>{badge.hint}</div>

                    <dl className="cb-hero-facts">
                      <div className="cb-hero-fact">
                        <dt>Status</dt>
                        <dd>
                          <span className={`cb-status-badge tone-${scoreTone}`}>{badge.label}</span>
                        </dd>
                      </div>

                      <div className="cb-hero-fact">
                        <dt>Target</dt>
                        <dd title={activeSite.label}>{activeSite.label}</dd>
                      </div>

                      <div className="cb-hero-fact">
                        <dt>Project</dt>
                        <dd>{projectLabel}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="cb-hero-body">
                  <ul className="cb-hero-metrics" aria-label="Primary metrics">
                    <li className="cb-metric">
                      <div className="cb-metric-k">Sessions</div>
                      <div className="cb-metric-v">{fmtInt(metrics!.sessions30d)}</div>
                      <div className="cb-metric-s">Under Guard: {fmtInt(metrics!.sessionsUnderGuard30d)}</div>
                    </li>

                    <li className="cb-metric">
                      <div className="cb-metric-k">Unique Visitors</div>
                      <div className="cb-metric-v">{fmtInt(metrics!.uniqueVisitors30d)}</div>
                      <div className="cb-metric-s">Routes monitored: {fmtInt(metrics!.routesMonitored)}</div>
                    </li>

                    <li className="cb-metric">
                      <div className="cb-metric-k">JS Errors</div>
                      <div className="cb-metric-v">{fmtInt(metrics!.jsErrors30d)}</div>
                      <div className="cb-metric-s">API Errors: {fmtInt(metrics!.apiErrors30d)}</div>
                    </li>

                    <li className="cb-metric">
                      <div className="cb-metric-k">404 Views</div>
                      <div className="cb-metric-v">{fmtInt(metrics!.views40430d)}</div>
                      <div className="cb-metric-s">Recovery rate: {fmtPct(metrics!.recoveryRate404)}</div>
                    </li>
                  </ul>

                  <div className="cb-divider cb-divider-hero" />

                  <ul className="cb-insights" aria-label="Guardian insights">
                    <li className="cb-insight">
                      <div className="cb-insight-k">Under Guard</div>
                      <div className="cb-insight-v">
                        {fmtPct((n(metrics!.sessionsUnderGuard30d) / Math.max(1, n(metrics!.sessions30d))) * 100, 0)}
                      </div>
                      <div className="cb-insight-s">Covered sessions</div>
                    </li>

                    <li className="cb-insight">
                      <div className="cb-insight-k">Error Load</div>
                      <div className="cb-insight-v">{fmtInt(n(metrics!.jsErrors30d) + n(metrics!.apiErrors30d))}</div>
                      <div className="cb-insight-s">JS + API errors</div>
                    </li>

                    <li className="cb-insight">
                      <div className="cb-insight-k">404 Recovery</div>
                      <div className="cb-insight-v">{fmtPct(metrics!.recoveryRate404, 0)}</div>
                      <div className="cb-insight-s">Recovery rate</div>
                    </li>

                    <li className="cb-insight">
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
                      <div className="cb-insight-s">
                        {n(metrics!.unstableLayoutPages) > 0
                          ? `${fmtInt(metrics!.unstableLayoutPages)} unstable routes`
                          : n(metrics!.slowPagesCount) > 0
                          ? `${fmtInt(metrics!.slowPagesCount)} slow routes`
                          : n(metrics!.piiRiskPercent ?? 0) >= 20
                          ? `PII risk ${fmtPct(metrics!.piiRiskPercent, 0)}`
                          : "No active risk flags"}
                      </div>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="cb-card">
                <div className="cb-card-head">
                  <h2 className="cb-h2">Vitals</h2>
                  <p className="cb-sub">Route-aware averages</p>
                </div>

                <br />

                <ul className="cb-vitals cb-vitals-main" aria-label="Web vitals">
                  <li className="cb-vital" data-tone={lcpTone}>
                    <div className="cb-vital-top">
                      <span className="cb-vital-name">LCP</span>
                      <span className="cb-vital-badge" aria-label={toneLabel(lcpTone)} title={toneLabel(lcpTone)}>
                        <span className={`cb-vital-dot tone-${lcpTone}`} aria-hidden="true" />
                        <span className="cb-vital-badge-label">{toneLabel(lcpTone)}</span>
                      </span>
                      <span className="cb-vital-value">{fmtMs(metrics!.avgLcpMs)}</span>
                    </div>
                    <div className="cb-vital-rail" aria-hidden="true">
                      <span className="cb-vital-fill" style={{ width: `${lcpFill}%` }} />
                    </div>
                    <div className="cb-vital-sub">Target: &lt; 2500 ms</div>
                  </li>

                  <li className="cb-vital" data-tone={ttfbTone}>
                    <div className="cb-vital-top">
                      <span className="cb-vital-name">TTFB</span>
                      <span className="cb-vital-badge" aria-label={toneLabel(ttfbTone)} title={toneLabel(ttfbTone)}>
                        <span className={`cb-vital-dot tone-${ttfbTone}`} aria-hidden="true" />
                        <span className="cb-vital-badge-label">{toneLabel(ttfbTone)}</span>
                      </span>
                      <span className="cb-vital-value">{fmtMs(metrics!.avgTtfbMs)}</span>
                    </div>
                    <div className="cb-vital-rail" aria-hidden="true">
                      <span className="cb-vital-fill" style={{ width: `${ttfbFill}%` }} />
                    </div>
                    <div className="cb-vital-sub">Target: &lt; 800 ms</div>
                  </li>

                  <li className="cb-vital" data-tone={clsTone}>
                    <div className="cb-vital-top">
                      <span className="cb-vital-name">CLS</span>
                      <span className="cb-vital-badge" aria-label={toneLabel(clsTone)} title={toneLabel(clsTone)}>
                        <span className={`cb-vital-dot tone-${clsTone}`} aria-hidden="true" />
                        <span className="cb-vital-badge-label">{toneLabel(clsTone)}</span>
                      </span>
                      <span className="cb-vital-value">{fmtCls(metrics!.globalCls)}</span>
                    </div>
                    <div className="cb-vital-rail" aria-hidden="true">
                      <span className="cb-vital-fill" style={{ width: `${clsFill}%` }} />
                    </div>
                    <div className="cb-vital-sub">Target: &lt; 0.10</div>
                  </li>

                  <li className="cb-vital" data-tone={slowPagesTone}>
                    <div className="cb-vital-top">
                      <span className="cb-vital-name">Slow pages</span>
                      <span className="cb-vital-badge" aria-label={toneLabel(slowPagesTone)} title={toneLabel(slowPagesTone)}>
                        <span className={`cb-vital-dot tone-${slowPagesTone}`} aria-hidden="true" />
                        <span className="cb-vital-badge-label">{toneLabel(slowPagesTone)}</span>
                      </span>
                      <span className="cb-vital-value">{fmtInt(metrics!.slowPagesCount)}</span>
                    </div>
                    <div className="cb-vital-rail" aria-hidden="true">
                      <span className="cb-vital-fill" style={{ width: `${slowPagesFill}%` }} />
                    </div>
                    <div className="cb-vital-sub">Target: 0–3</div>
                  </li>

                  <li className="cb-vital" data-tone={unstableLayoutTone}>
                    <div className="cb-vital-top">
                      <span className="cb-vital-name">Unstable layout</span>
                      <span
                        className="cb-vital-badge"
                        aria-label={toneLabel(unstableLayoutTone)}
                        title={toneLabel(unstableLayoutTone)}
                      >
                        <span className={`cb-vital-dot tone-${unstableLayoutTone}`} aria-hidden="true" />
                        <span className="cb-vital-badge-label">{toneLabel(unstableLayoutTone)}</span>
                      </span>
                      <span className="cb-vital-value">{fmtInt(metrics!.unstableLayoutPages)}</span>
                    </div>
                    <div className="cb-vital-rail" aria-hidden="true">
                      <span className="cb-vital-fill" style={{ width: `${unstableLayoutFill}%` }} />
                    </div>
                    <div className="cb-vital-sub">Target: 0</div>
                  </li>
                </ul>

                <div className="cb-vital-legend" aria-label="Vitals state legend">
                  <span className="cb-vital-legend-item">
                    <span className="cb-vital-dot tone-good" aria-hidden="true" />
                    Good
                  </span>
                  <span className="cb-vital-legend-item">
                    <span className="cb-vital-dot tone-watch" aria-hidden="true" />
                    Watch
                  </span>
                  <span className="cb-vital-legend-item">
                    <span className="cb-vital-dot tone-bad" aria-hidden="true" />
                    Bad
                  </span>
                </div>
              </div>
            </section>

            <br />
            <br />

            {/* CHART + INTEL */}
            <section className="cb-grid cb-grid-2" aria-label="Trends and Intelligence">
              <div className="cb-stack" aria-label="Trend stack">
                <div className="cb-card cb-card-chart cb-grid2-trend">
                <div className="cb-card-head cb-card-head-row">
                  <div>
                    <h2 className="cb-h2">Sessions Trend</h2>
                    <p className="cb-sub">Modern bar + overlay (sessions / 404)</p>
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
                          rx="0"
                          ry="0"
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
                            <rect
                              key={i}
                              x={x - 2.2}
                              y={y - 2.2}
                              width="4.4"
                              height="4.4"
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

                  <ul className="cb-mini-row" aria-label="Trend labels">
                    {series.labels.map((l, idx) => (
                      <li key={idx} className="cb-mini-day">
                        <span className="cb-mini-l">{l}</span>
                        <span className="cb-mini-v">{fmtInt(series.sessions[idx] || 0)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* SEO Snapshot */}
                <div className="cb-card cb-snapshot-card cb-grid2-seo" aria-label="SEO Snapshot">
                  <div className="cb-card-head">
                    <h2 className="cb-h2">SEO Snapshot</h2>
                    <p className="cb-sub">Index posture + crawl readiness</p>
                  </div>

                  <br />

                  <div className="cb-snapshot-body cb-snapshot-body-seo">
                    <ul className="cb-vitals cb-vitals-relaxed" aria-label="SEO posture metrics">
                      <li className="cb-vital" data-tone={indexTone}>
                        <div className="cb-vital-top">
                          <span className="cb-vital-name">Index health</span>
                          <span className="cb-vital-badge" aria-label={toneLabel(indexTone)} title={toneLabel(indexTone)}>
                            <span className={`cb-vital-dot tone-${indexTone}`} aria-hidden="true" />
                            <span className="cb-vital-badge-label">{toneLabel(indexTone)}</span>
                          </span>
                          <span className="cb-vital-value">{fmtPct(indexHealthPct, 0)}</span>
                        </div>
                        <div className="cb-vital-rail" aria-hidden="true">
                          <span className="cb-vital-fill" style={{ width: `${indexFill}%` }} />
                        </div>
                        <div className="cb-vital-sub">Derived from Guardian Score + coverage</div>
                      </li>

                      <li className="cb-vital" data-tone={crawlTone}>
                        <div className="cb-vital-top">
                          <span className="cb-vital-name">Crawl coverage</span>
                          <span className="cb-vital-badge" aria-label={toneLabel(crawlTone)} title={toneLabel(crawlTone)}>
                            <span className={`cb-vital-dot tone-${crawlTone}`} aria-hidden="true" />
                            <span className="cb-vital-badge-label">{toneLabel(crawlTone)}</span>
                          </span>
                          <span className="cb-vital-value">{fmtPct(crawlCoveragePct, 0)}</span>
                        </div>
                        <div className="cb-vital-rail" aria-hidden="true">
                          <span className="cb-vital-fill" style={{ width: `${crawlFill}%` }} />
                        </div>
                        <div className="cb-vital-sub">Routes observed + aggregating cleanly</div>
                      </li>

                      <li className="cb-vital" data-tone={rate404Tone}>
                        <div className="cb-vital-top">
                          <span className="cb-vital-name">404 rate</span>
                          <span className="cb-vital-badge" aria-label={toneLabel(rate404Tone)} title={toneLabel(rate404Tone)}>
                            <span className={`cb-vital-dot tone-${rate404Tone}`} aria-hidden="true" />
                            <span className="cb-vital-badge-label">{toneLabel(rate404Tone)}</span>
                          </span>
                          <span className="cb-vital-value">{fmtPct(rate404Pct, 1)}</span>
                        </div>
                        <div className="cb-vital-rail" aria-hidden="true">
                          <span className="cb-vital-fill" style={{ width: `${rate404Fill}%` }} />
                        </div>
                        <div className="cb-vital-sub">Views404 ÷ Sessions</div>
                      </li>

                      <li className="cb-vital" data-tone={frictionTone}>
                        <div className="cb-vital-top">
                          <span className="cb-vital-name">Crawl friction</span>
                          <span className="cb-vital-badge" aria-label={toneLabel(frictionTone)} title={toneLabel(frictionTone)}>
                            <span className={`cb-vital-dot tone-${frictionTone}`} aria-hidden="true" />
                            <span className="cb-vital-badge-label">{toneLabel(frictionTone)}</span>
                          </span>
                          <span className="cb-vital-value">{fmtInt(crawlFriction)}</span>
                        </div>
                        <div className="cb-vital-rail" aria-hidden="true">
                          <span className="cb-vital-fill" style={{ width: `${frictionFill}%` }} />
                        </div>
                        <div className="cb-vital-sub">Slow pages + unstable layout routes</div>
                      </li>

                      <li className="cb-vital" data-tone={discoveryTone}>
                        <div className="cb-vital-top">
                          <span className="cb-vital-name">Discovery coverage</span>
                          <span className="cb-vital-badge" aria-label={toneLabel(discoveryTone)} title={toneLabel(discoveryTone)}>
                            <span className={`cb-vital-dot tone-${discoveryTone}`} aria-hidden="true" />
                            <span className="cb-vital-badge-label">{toneLabel(discoveryTone)}</span>
                          </span>
                          <span className="cb-vital-value">{fmtPct(discoveryPct, 0)}</span>
                        </div>

                        <div className="cb-vital-rail" aria-hidden="true">
                          <span className="cb-vital-fill" style={{ width: `${discoveryFill}%` }} />
                        </div>

                        <div className="cb-vital-sub">Routes discoverable via crawl + internal linking</div>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="cb-stack cb-stack-dual" aria-label="Intelligence and accessibility snapshots">
                <div className="cb-card cb-grid2-intelligence">
                  <div className="cb-card-head">
                    <h2 className="cb-h2">Intelligence</h2>
                    <p className="cb-sub">Behavior + safety posture</p>
                  </div>

                  <br />

                  <ul className="cb-kpi-grid" aria-label="Secondary metrics">
                    <li className="cb-kpi">
                      <div className="cb-kpi-k">CTA Clicks</div>
                      <div className="cb-kpi-v">{fmtInt(metrics!.ctaClicks30d)}</div>
                    </li>

                    <li className="cb-kpi">
                      <div className="cb-kpi-k">Form Submits</div>
                      <div className="cb-kpi-v">{fmtInt(metrics!.formSubmits30d)}</div>
                    </li>

                    <li className="cb-kpi">
                      <div className="cb-kpi-k">Engagement Pings</div>
                      <div className="cb-kpi-v">{fmtInt(metrics!.engagementPings30d)}</div>
                    </li>

                    <li className="cb-kpi">
                      <div className="cb-kpi-k">Scroll 90%</div>
                      <div className="cb-kpi-v">{fmtInt(metrics!.scroll90Sessions30d)}</div>
                    </li>

                    <li className="cb-kpi">
                      <div className="cb-kpi-k">PII Risk</div>
                      <div className="cb-kpi-v">{fmtPct(metrics!.piiRiskPercent, 0)}</div>
                    </li>

                    <li className="cb-kpi">
                      <div className="cb-kpi-k">Coverage</div>
                      <div className="cb-kpi-v">{fmtPct(metrics!.aggregationCoveragePercent, 0)}</div>
                    </li>

                    <li className="cb-kpi">
                      <div className="cb-kpi-k">Retention</div>
                      <div className="cb-kpi-v">{fmtPct(metrics!.retentionHorizonPercent, 0)}</div>
                    </li>

                    <li className="cb-kpi">
                      <div className="cb-kpi-k">Badge Interactions</div>
                      <div className="cb-kpi-v">{fmtInt(metrics!.badgeInteractions30d)}</div>
                    </li>
                  </ul>
                </div>

                <div className="cb-card cb-snapshot-card cb-grid2-a11y" aria-label="A11y Snapshot">
                  <div className="cb-card-head">
                    <h3 className="cb-h3">A11y Snapshot</h3>
                    <p className="cb-sub">Audits + issues (safe, fingerprinted)</p>
                  </div>

                  <br />

                  <div className="cb-snapshot-body">
                    <ul className="cb-a11y" aria-label="Accessibility snapshot">
                      <li className="cb-a11y-item" data-tone={auditsTone}>
                        <div className="cb-a11y-top">
                          <span className="cb-a11y-name">Audits</span>
                          <span className="cb-a11y-badge" aria-label={toneLabel(auditsTone)} title={toneLabel(auditsTone)}>
                            <span className={`cb-vital-dot tone-${auditsTone}`} aria-hidden="true" />
                            <span className="cb-vital-badge-label">{toneLabel(auditsTone)}</span>
                          </span>
                          <span className="cb-a11y-value">{fmtInt(audits)}</span>
                        </div>
                        <div className="cb-a11y-rail" aria-hidden="true">
                          <span className="cb-a11y-fill" style={{ width: `${auditsFill}%` }} />
                        </div>
                        <div className="cb-a11y-sub">Scans recorded</div>
                      </li>

                      <li className="cb-a11y-item" data-tone={issuesTone}>
                        <div className="cb-a11y-top">
                          <span className="cb-a11y-name">Issues</span>
                          <span className="cb-a11y-badge" aria-label={toneLabel(issuesTone)} title={toneLabel(issuesTone)}>
                            <span className={`cb-vital-dot tone-${issuesTone}`} aria-hidden="true" />
                            <span className="cb-vital-badge-label">{toneLabel(issuesTone)}</span>
                          </span>
                          <span className="cb-a11y-value">{fmtInt(issuesCount)}</span>
                        </div>
                        <div className="cb-a11y-rail" aria-hidden="true">
                          <span className="cb-a11y-fill" style={{ width: `${issuesFill}%` }} />
                        </div>
                        <div className="cb-a11y-sub">Issue rate: {fmtPct(issueRate * 100, 0)} of audits</div>
                      </li>

                      <li className="cb-a11y-item" data-tone={contrastTone}>
                        <div className="cb-a11y-top">
                          <span className="cb-a11y-name">Contrast fails</span>
                          <span className="cb-a11y-badge" aria-label={toneLabel(contrastTone)} title={toneLabel(contrastTone)}>
                            <span className={`cb-vital-dot tone-${contrastTone}`} aria-hidden="true" />
                            <span className="cb-vital-badge-label">{toneLabel(contrastTone)}</span>
                          </span>
                          <span className="cb-a11y-value">{fmtInt(contrastFails)}</span>
                        </div>
                        <div className="cb-a11y-rail" aria-hidden="true">
                          <span className="cb-a11y-fill" style={{ width: `${contrastFill}%` }} />
                        </div>
                        <div className="cb-a11y-sub">Contrast rate: {fmtPct(contrastRate * 100, 0)} of audits</div>
                      </li>

                      <li className="cb-a11y-item" data-tone={focusTone}>
                        <div className="cb-a11y-top">
                          <span className="cb-a11y-name">Focus invisible</span>
                          <span className="cb-a11y-badge" aria-label={toneLabel(focusTone)} title={toneLabel(focusTone)}>
                            <span className={`cb-vital-dot tone-${focusTone}`} aria-hidden="true" />
                            <span className="cb-vital-badge-label">{toneLabel(focusTone)}</span>
                          </span>
                          <span className="cb-a11y-value">{fmtInt(focusInvisible)}</span>
                        </div>
                        <div className="cb-a11y-rail" aria-hidden="true">
                          <span className="cb-a11y-fill" style={{ width: `${focusFill}%` }} />
                        </div>
                        <div className="cb-a11y-sub">Focus rate: {fmtPct(focusRate * 100, 0)} of audits</div>
                      </li>

                      <li className="cb-a11y-item" data-tone={keyboardTone}>
                        <div className="cb-a11y-top">
                          <span className="cb-a11y-name">Keyboard nav</span>
                          <span className="cb-a11y-badge" aria-label={toneLabel(keyboardTone)} title={toneLabel(keyboardTone)}>
                            <span className={`cb-vital-dot tone-${keyboardTone}`} aria-hidden="true" />
                            <span className="cb-vital-badge-label">{toneLabel(keyboardTone)}</span>
                          </span>
                          <span className="cb-a11y-value">{fmtInt(keyboardNav)}</span>
                        </div>
                        <div className="cb-a11y-rail" aria-hidden="true">
                          <span className="cb-a11y-fill" style={{ width: `${keyboardFill}%` }} />
                        </div>
                        <div className="cb-a11y-sub">Keyboard share: {fmtPct(keyboardNavRate * 100, 0)} of sessions</div>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>

            <br />
            <br />

            {/* TOP ROUTES */}
            <section className="cb-card" aria-label="Top routes">
              <div className="cb-card-head">
                <h2 className="cb-h2">Top Routes</h2>
                <p className="cb-sub">Most viewed paths</p>
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

            <div className="cb-rightstack">
              <section className="cb-card cb-geo-card" aria-label="Geo intelligence">
                <div className="cb-card-head cb-card-head-row">
                  <div>
                    <h2 className="cb-h2">Geo intelligence</h2>
                    <p className="cb-sub">Region heatmap + session share</p>
                  </div>
                  <div className="cb-geo-headright">
                    {geoHeadline ? <span className="cb-geo-op">{geoHeadline}</span> : null}
                    <span className="cb-geo-op">{geoSubline}</span>
                  </div>
                </div>

                <div
                  className="cb-geo-map"
                  role="img"
                  aria-label="Map of visitor regions and country distribution"
                >
                  <span className="cb-geo-land" aria-hidden="true" />
                  <svg
                    className="cb-geo-overlay-svg"
                    viewBox={`0 0 ${GEO_MAP_WIDTH} ${GEO_MAP_HEIGHT}`}
                    role="presentation"
                    aria-hidden="true"
                  >
                    <g className="cb-geo-dot-layer">
                      {geoDots.map((dot) => {
                        const tipW = geoDotTooltipWidth(dot.label);
                        const tipH = 36;
                        const tipLift = -(dot.ringR + 12);
                        return (
                          <g
                            key={dot.id}
                            className={`cb-geo-dot cb-geo-dot-${dot.rank}`}
                            transform={`translate(${dot.x.toFixed(2)} ${dot.y.toFixed(2)})`}
                            role="img"
                            aria-label={`${dot.label}: ${fmtInt(dot.value)} sessions, ${fmtPct(dot.share, 1)} share`}
                            tabIndex={0}
                          >
                            <title>{`${dot.label} · ${fmtInt(dot.value)} sessions · ${fmtPct(dot.share, 1)} share`}</title>
                            <circle className="cb-geo-dot-halo" r={(dot.ringR + 3.2).toFixed(2)} />
                            <circle className="cb-geo-dot-ring" r={dot.ringR.toFixed(2)} />
                            <circle className="cb-geo-dot-core" r={dot.coreR.toFixed(2)} />
                            <circle
                              className="cb-geo-dot-gleam"
                              cx={(dot.coreR * -0.24).toFixed(2)}
                              cy={(dot.coreR * -0.28).toFixed(2)}
                              r={Math.max(1.2, dot.coreR * 0.36).toFixed(2)}
                            />

                            <g className="cb-geo-tooltip" transform={`translate(0 ${tipLift.toFixed(2)})`} aria-hidden="true">
                              <rect className="cb-geo-tooltip-bg" x={-tipW / 2} y={-tipH} width={tipW} height={tipH} rx="7" />
                              <text className="cb-geo-tooltip-title" x="0" y={-tipH + 13}>
                                {dot.label}
                              </text>
                              <text className="cb-geo-tooltip-sub" x="0" y={-tipH + 26}>
                                {`${fmtInt(dot.value)} sessions · ${fmtPct(dot.share, 1)} share`}
                              </text>
                            </g>
                          </g>
                        );
                      })}
                    </g>
                  </svg>
                  <div className="cb-geo-overlay">
                    {geoHeadline ? <div className="cb-geo-op">{geoHeadline}</div> : null}
                    <div className="cb-geo-op">
                      {hasGeoRows
                        ? `${fmtPct(primaryGeoShare, 1)} of tracked sessions`
                        : "No session share yet"}
                    </div>
                  </div>
                </div>

                <ul className="cb-geo-legend">
                  <li className="cb-geo-leg">
                    <span className="cb-geo-swatch sw1" aria-hidden="true" />
                    Top 1
                  </li>
                  <li className="cb-geo-leg">
                    <span className="cb-geo-swatch sw2" aria-hidden="true" />
                    Top 2
                  </li>
                  <li className="cb-geo-leg">
                    <span className="cb-geo-swatch sw3" aria-hidden="true" />
                    Top 3
                  </li>
                  <li className="cb-geo-leg">
                    <span className="cb-geo-swatch sw0" aria-hidden="true" />
                    Other regions
                  </li>
                </ul>

                <ul className="cb-geo-stats">
                  {topGeoRows.length ? (
                    topGeoRows.map((row, idx) => {
                      const rank = idx === 0 ? "top1" : idx === 1 ? "top2" : "top3";
                      const value = geoValue(row);
                      const share = percentOf(totalGeoSessions, value);
                      return (
                        <li key={`${geoLabel(row)}-${idx}`} className="cb-geo-row" data-rank={rank}>
                          <div className="cb-geo-left">
                            <span className="cb-geo-name">{geoLabel(row)}</span>
                            <span className="cb-geo-sub">{fmtPct(share, 1)} share</span>
                          </div>
                          <div className="cb-geo-rail">
                            <span
                              className="cb-geo-fill"
                              style={{ width: `${Math.max(12, Math.min(96, share))}%` }}
                            />
                          </div>
                        </li>
                      );
                    })
                  ) : (
                    <li className="cb-geo-zero">
                      <div className="cb-geo-zero-k">Geo data is pending</div>
                      <div className="cb-geo-zero-v">
                        Run a scan or wait for the next sync to populate regional coverage.
                      </div>
                      <br />
                      <br />
                      <div className="cb-geo-zero-meta">Sessions tracked will appear here.</div>
                    </li>
                  )}
                </ul>
              </section>

              <section className="cb-card cb-geo-section" aria-label="Geo breakdown">
                <div className="cb-card-head cb-card-head-row">
                  <div>
                    <h2 className="cb-h2">Geo breakdown</h2>
                    <p className="cb-sub">Countries + session signals</p>
                  </div>
                  <div className="cb-geo-headright">
                    <span className="cb-geo-op">
                      {geoCountries.length} region{geoCountries.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                <div className="cb-geo-panel">
                  <div className="cb-geo-zero">
                    <div className="cb-geo-zero-k">Sessions tracked</div>
                    <div className="cb-geo-zero-v">{fmtInt(totalGeoSessions)}</div>
                    <div className="cb-geo-zero-meta">
                      {hasGeoRows
                        ? `${geoCountries.length} countries monitored`
                        : "Geo signals activate after a scan"}
                    </div>
                  </div>

                  <div className="cb-geo-countries">
                    <div className="cb-geo-countries-head">Top countries</div>
                    {geoList.length ? (
                      <ul className="cb-geo-countrylist">
                        {geoList.map((row, idx) => (
                          <li key={`${geoLabel(row)}-${idx}`} className="cb-geo-country">
                            <span className="cb-geo-country-name">{geoLabel(row)}</span>
                            <span className="cb-geo-country-val">{fmtInt(geoValue(row))}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="cb-geo-empty">
                        <div className="cb-geo-empty-k">Geo signals initializing</div>
                        <div className="cb-geo-empty-v">
                          The console will show top origins once CavBot records visitor geography.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>

            <br />
            <br />

            <CavAiRouteRecommendations
              panelId="console"
              snapshot={data}
              origin={activeSite.url || ""}
              pagesScanned={metrics?.routesMonitored ?? metrics?.sessions30d ?? 1}
              title="CavBot Cross-Pillar Priorities"
              subtitle="Deterministic priorities across reliability, performance, accessibility, UX, and engagement."
              pillars={["reliability", "performance", "accessibility", "ux", "engagement", "seo"]}
              prioritySummary={{
                tone: cavbotFeedback.tone,
                meta: cavbotFeedback.meta,
                headline: cavbotFeedback.headline,
                body: cavbotFeedback.body,
                steps: cavbotFeedback.steps,
                hideCta: true,
              }}
            />
          </>
        ) : loadError ? (
          <section className="cb-card cb-card-danger" aria-label="Console load failed">
            <div className="cb-card-head">
              <h1 className="cb-h1">Console failed to load</h1>
              <p className="cb-sub">Unable to load metrics for the selected project, site, and range.</p>
            </div>
            <pre className="cb-pre">{analyticsConsoleErrorCode(loadError)}</pre>
          </section>
        ) : (
          <section className="cb-card" aria-label="No analytics data yet">
            <div className="cb-card-head">
              <h1 className="cb-h1">No data yet</h1>
              <p className="cb-sub">
                CavBot is waiting for real events from {activeSite.url || "the selected site"}. Install or verify the Analytics v5 snippet,
                then load a page on the site to create the first page view.
              </p>
            </div>
            <div className="cb-kv">
              <div className="cb-kv-row">
                <span className="cb-k">Project</span>
                <span className="cb-v">{projectLabel}</span>
              </div>
              <div className="cb-kv-row">
                <span className="cb-k">Target</span>
                <span className="cb-v">{activeSite.url || "No site selected"}</span>
              </div>
              <div className="cb-kv-row">
                <span className="cb-k">Range</span>
                <span className="cb-v">{rangeKey}</span>
              </div>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
