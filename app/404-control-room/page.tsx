// app/404-control-room/page.tsx
import "./404-control-room.css";

import Script from "next/script";
import { unstable_noStore as noStore } from "next/cache";

import AppShell from "@/components/AppShell";
import CavAiRouteRecommendations from "@/components/CavAiRouteRecommendations";
import DashboardToolsControls from "@/components/DashboardToolsControls";
import { readWorkspace } from "@/lib/workspaceStore.server";
import { getProjectSummary } from "@/lib/cavbotApi.server";
import { prisma } from "@/lib/prisma";
import { findArcadeGame } from "@/lib/arcade/catalog";
import { ARCADE_KIND_404 } from "@/lib/arcade/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = { 
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type RangeKey = "24h" | "7d" | "14d" | "30d";

type UnknownRecord = Record<string, unknown>;
type MaybeUnknownRecord = UnknownRecord | null;

type LooseWorkspace = {
  projectId?: number | string | null;
  project?: { id?: number | string | null };
  account?: { projectId?: number | string | null };
  activeSiteOrigin?: string | null;
  selection?: { activeSiteOrigin?: string | null };
  activeSite?: { origin?: string | null };
  workspace?: { activeSiteOrigin?: string | null };
} & UnknownRecord;

const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null;
const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);
const pickArray = (...values: unknown[]): UnknownRecord[] => {
  for (const value of values) {
    if (Array.isArray(value) && value.length) {
      return value.filter(isRecord) as UnknownRecord[];
    }
  }
  return [];
};
const asString = (value: unknown): string | null => {
  if (value == null) return null;
  return String(value);
};

/* =========================
  Shared helpers (match SEO/Errors)
  ========================= */
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

function normalizeTargets(raw: MaybeUnknownRecord): ClientTarget[] {
  const roots: UnknownRecord[] = [];
  const pushRecord = (value: unknown) => {
    if (isRecord(value)) roots.push(value);
  };

  pushRecord(raw);
  pushRecord(raw?.["workspace"]);
  pushRecord(raw?.["commandDeck"]);
  pushRecord(raw?.["deck"]);
  pushRecord(raw?.["data"]);
  pushRecord(raw?.["state"]);
  pushRecord(raw?.["project"]);
  pushRecord(raw?.["account"]);
  pushRecord(raw?.["payload"]);

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
        } else if (isRecord(item)) {
          const rawOrigin =
            typeof item["origin"] === "string"
              ? item["origin"]
              : typeof item["url"] === "string"
              ? item["url"]
              : typeof item["siteOrigin"] === "string"
              ? item["siteOrigin"]
              : typeof item["href"] === "string"
              ? item["href"]
              : typeof item["baseUrl"] === "string"
              ? item["baseUrl"]
              : typeof item["website"] === "string"
              ? item["website"]
              : typeof item["primaryOrigin"] === "string"
              ? item["primaryOrigin"]
              : "";

          origin = canonicalOrigin(rawOrigin);
          id = toSlug(String(item["slug"] || item["id"] || origin || "site"));
          label =
            typeof item["label"] === "string"
              ? item["label"]
              : typeof item["name"] === "string"
              ? item["name"]
              : typeof item["displayName"] === "string"
              ? item["displayName"]
              : typeof item["title"] === "string"
              ? item["title"]
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
  Control Room payload normalization
  - NO fake values
  - ok to be 0 / empty if pipeline not sending these yet
  ========================= */
type TrendPoint = { day?: string | null; views404?: number | null };
type RouteRow = { routePath?: string | null; views404?: number | null; source?: string | null };

type GameRow = {
  gameId?: string | null;
  name?: string | null;
  sessions?: number | null;
  plays?: number | null;
  avgScore?: number | null;
  highScore?: number | null;
  completionPct?: number | null;
};

type LeaderRow = { label?: string | null; score?: number | null; gameId?: string | null; achievedAtISO?: string | null };

type ControlRoomPayload = {
  updatedAtISO?: string | null;

  views404Total?: number | null;
  unique404Routes?: number | null;
  views404RatePct?: number | null;

  trend?: TrendPoint[];

  topRoutes?: RouteRow[];
  typedRoutes?: RouteRow[];
  referrers?: { referrer?: string | null; count?: number | null }[];

  games?: GameRow[];
  leaderboard?: LeaderRow[];
};

type ArcadeIdentity = {
  gameSlug: string;
  gameVersion: string | null;
  displayName: string | null;
};

function normalizeGameKey(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function readArcadeDisplayName(meta: unknown, message: string | null) {
  const m = asRecord(meta);
  const fromMeta =
    asString(m?.["gameDisplayName"]) ??
    asString(m?.["surfaceName"]) ??
    asString(m?.["gameName"]) ??
    asString(m?.["displayName"]) ??
    asString(m?.["name"]) ??
    null;
  if (fromMeta && String(fromMeta).trim()) return String(fromMeta).trim();
  if (!message) return null;
  const idx = message.lastIndexOf("·");
  if (idx < 0) return null;
  const parsed = message.slice(idx + 1).trim();
  return parsed || null;
}

async function resolveArcadeIdentity(input: { projectId: string; siteOrigin: string }) {
  const projectIdNum = Number(input.projectId);
  const origin = canonicalOrigin(input.siteOrigin);
  if (!Number.isFinite(projectIdNum) || projectIdNum <= 0 || !origin) return null;

  try {
    const site = await prisma.site.findFirst({
      where: { projectId: projectIdNum, origin, isActive: true },
      select: { id: true },
    });
    if (!site?.id) return null;

    const [config, latestEvent] = await Promise.all([
      prisma.siteArcadeConfig.findUnique({
        where: { siteId: site.id },
        select: { enabled: true, gameSlug: true, gameVersion: true },
      }),
      prisma.siteEvent.findFirst({
        where: { siteId: site.id, type: "INTEGRATION_CONNECTED" },
        orderBy: { createdAt: "desc" },
        select: { meta: true, message: true },
      }),
    ]);

    const fromEventMeta = asRecord(latestEvent?.meta);
    const gameSlug =
      String(fromEventMeta?.["gameSlug"] || "").trim() ||
      String(config?.gameSlug || "").trim();
    const gameVersion =
      String(fromEventMeta?.["gameVersion"] || "").trim() ||
      String(config?.gameVersion || "").trim() ||
      null;
    const eventDisplayName = readArcadeDisplayName(latestEvent?.meta, asString(latestEvent?.message));
    const catalogDisplayName =
      gameSlug && config?.enabled
        ? findArcadeGame(ARCADE_KIND_404, gameSlug, gameVersion || undefined)?.displayName || null
        : null;
    const displayName = eventDisplayName || catalogDisplayName || null;

    if (!gameSlug && !displayName) return null;
    return { gameSlug, gameVersion, displayName } as ArcadeIdentity;
  } catch {
    return null;
  }
}

function applyArcadeIdentity(payload: ControlRoomPayload, identity: ArcadeIdentity | null): ControlRoomPayload {
  if (!identity) return payload;

  const slugKey = normalizeGameKey(identity.gameSlug);
  const hasDisplayName = Boolean(identity.displayName && String(identity.displayName).trim());
  const gamesInput = payload.games || [];
  const singleGameMode = gamesInput.length <= 1;

  const games = gamesInput.map((row) => {
    const rowKey = normalizeGameKey(row.gameId);
    const matchesById = Boolean(slugKey && rowKey && (rowKey === slugKey || rowKey.includes(slugKey) || slugKey.includes(rowKey)));
    const canHydrate = matchesById || (!rowKey && singleGameMode);
    if (!canHydrate) return row;

    return {
      ...row,
      gameId: row.gameId || identity.gameSlug || null,
      name: hasDisplayName ? identity.displayName : row.name || null,
    };
  });

  const leaderboard = (payload.leaderboard || []).map((row) => {
    if (row.gameId) return row;
    if (!slugKey) return row;
    if (!singleGameMode) return row;
    return { ...row, gameId: identity.gameSlug };
  });

  return { ...payload, games, leaderboard };
}

function normalizeControlRoomFromSummary(summary: unknown): ControlRoomPayload {
  const summaryRecord = asRecord(summary) || {};
  const diagnosticsRecord = asRecord(summaryRecord["diagnostics"]);
  const insightsRecord = asRecord(summaryRecord["insights"]);
  const modulesRecord = asRecord(summaryRecord["modules"]);

  const cr =
    asRecord(summaryRecord["controlRoom"]) ||
    asRecord(summaryRecord["controlRoomGames"]) ||
    asRecord(summaryRecord["arcade"]) ||
    asRecord(summaryRecord["games"]) ||
    asRecord(insightsRecord?.["controlRoom"]) ||
    asRecord(modulesRecord?.["controlRoom"]) ||
    null;

  const err =
    asRecord(summaryRecord["errors"]) ||
    asRecord(summaryRecord["errorIntelligence"]) ||
    asRecord(diagnosticsRecord?.["errors"]) ||
    null;

  const updatedAtISO =
    asString(cr?.["updatedAtISO"]) ||
    asString(cr?.["updatedAt"]) ||
    asString(err?.["updatedAtISO"]) ||
    asString(err?.["updatedAt"]) ||
    asString(summaryRecord["updatedAtISO"]) ||
    asString(asRecord(summaryRecord["meta"])?.["updatedAtISO"]) ||
    null;

  const views404Total =
    nOrNull(
      cr?.["views404Total"] ??
        cr?.["views404"] ??
        asRecord(cr?.["totals"])?.["views404"] ??
        asRecord(err?.["totals"])?.["views404"] ??
        err?.["views404"] ??
        asRecord(err?.["rollup"])?.["views404"]
    ) ?? null;

  const unique404Routes =
    nOrNull(
      cr?.["unique404Routes"] ??
        cr?.["uniqueRoutes404"] ??
        cr?.["routes404Unique"] ??
        err?.["unique404Routes"] ??
        err?.["uniqueRoutes404"] ??
        asRecord(err?.["rollup"])?.["unique404Routes"]
    ) ?? null;

  const views404RatePct = nOrNull(
    cr?.["views404RatePct"] ?? cr?.["rate404Pct"] ?? err?.["rate404Pct"] ?? null
  );

  const trendRaw = pickArray(
    cr?.["trend"],
    cr?.["trend404"],
    err?.["trend"],
    err?.["trend404"],
    summaryRecord["trend7d"],
    summaryRecord["trend30d"],
    asRecord(summaryRecord["metrics"])?.["trend"]
  );

  const trend = trendRaw
    .map((p) => ({
      day:
        asString(p["day"]) ??
        asString(p["date"]) ??
        asString(p["t"]) ??
        null,
      views404: nOrNull(
        p["views404"] ??
          p["views_404"] ??
          p["v404"] ??
          p["notFound"] ??
          p["not_found"] ??
          null
      ),
    }))
    .filter((p) => Boolean(p.day))
    .slice(0, 64);

  const topRoutesRaw = pickArray(
    cr?.["top404Routes"],
    cr?.["routes404Top"],
    cr?.["topRoutes404"],
    err?.["top404Routes"],
    err?.["routes404"],
    err?.["topRoutes404"]
  );

  const topRoutes = topRoutesRaw
    .map((r) => ({
      routePath:
        asString(r["routePath"]) ??
        asString(r["path"]) ??
        null,
      views404: nOrNull(r["views404"] ?? r["views_404"] ?? r["count"] ?? r["hits"] ?? null),
      source: asString(r["source"]) ?? asString(r["kind"]) ?? null,
    }))
    .filter((r) => Boolean(r.routePath))
    .slice(0, 60);

  const typedRoutesRaw = pickArray(cr?.["typedRoutes"], cr?.["typed404"], err?.["typedRoutes"], err?.["typed404"]);
  const typedRoutes = typedRoutesRaw
    .map((r) => ({
      routePath: asString(r["routePath"]) ?? asString(r["path"]) ?? null,
      views404: nOrNull(r["count"] ?? r["hits"] ?? r["views404"] ?? null),
      source: "typed",
    }))
    .filter((r) => Boolean(r.routePath))
    .slice(0, 20);

  const refRaw = pickArray(cr?.["referrers"], cr?.["topReferrers"], err?.["referrers"]);
  const referrers = refRaw
    .map((x) => ({
      referrer: asString(x["referrer"]) ?? asString(x["source"]) ?? null,
      count: nOrNull(x["count"] ?? x["hits"] ?? x["views"] ?? null),
    }))
    .filter((x) => Boolean(x.referrer))
    .slice(0, 16);

  const gamesRaw = pickArray(cr?.["games"], cr?.["gameStats"], cr?.["arcadeGames"]);
  const games = gamesRaw
    .map((g) => ({
      gameId:
        asString(g["gameId"]) ??
        asString(g["gameSlug"]) ??
        asString(g["slug"]) ??
        asString(g["id"]) ??
        null,
      name:
        asString(g["name"]) ??
        asString(g["title"]) ??
        asString(g["gameName"]) ??
        asString(g["displayName"]) ??
        asString(g["surfaceName"]) ??
        asString(g["gameDisplayName"]) ??
        null,
      sessions: nOrNull(g["sessions"] ?? g["gameSessions"] ?? null),
      plays: nOrNull(g["plays"] ?? g["kicks"] ?? g["runs"] ?? null),
      avgScore: nOrNull(g["avgScore"] ?? g["scoreAvg"] ?? null),
      highScore: nOrNull(g["highScore"] ?? g["scoreMax"] ?? null),
      completionPct: nOrNull(g["completionPct"] ?? g["completePct"] ?? null),
    }))
    .filter((g) => Boolean(g.gameId || g.name))
    .slice(0, 18);

  const lbRaw = pickArray(cr?.["leaderboard"], cr?.["leaders"]);
  const leaderboard = lbRaw
    .map((x) => ({
      label: asString(x["label"]) ?? asString(x["player"]) ?? asString(x["name"]) ?? null,
      score: nOrNull(x["score"] ?? x["points"] ?? null),
      gameId:
        asString(x["gameId"]) ??
        asString(x["gameSlug"]) ??
        asString(x["slug"]) ??
        null,
      achievedAtISO: asString(x["achievedAtISO"]) ?? asString(x["ts"]) ?? null,
    }))
    .filter((x) => x.score != null)
    .slice(0, 20);

  return {
    updatedAtISO,
    views404Total,
    unique404Routes,
    views404RatePct,
    trend,
    topRoutes,
    typedRoutes,
    referrers,
    games,
    leaderboard,
  };
}

function csvEscape(value: string) {
  const v = String(value ?? "");
  if (v.includes('"') || v.includes(",") || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function buildControlRoomReportCSV(input: {
  siteLabel: string;
  siteUrl: string;
  range: string;
  updatedAtLabel: string;
  views404Total?: number | null;
  unique404Routes?: number | null;
  views404RatePct?: number | null;
  topRoutes: Array<{ routePath?: string | null; views404?: number | null; source?: string | null }>;
}) {
  const rows: string[] = [];
  rows.push("CavBot Control Room Report");
  rows.push(`Target,${csvEscape(input.siteLabel || "—")}`);
  rows.push(`Origin,${csvEscape(input.siteUrl || "—")}`);
  rows.push(`Range,${csvEscape(input.range || "—")}`);
  rows.push(`Updated,${csvEscape(input.updatedAtLabel || "—")}`);
  rows.push("");
  rows.push("Summary");
  rows.push(`Total 404 views,${input.views404Total ?? ""}`);
  rows.push(`Unique 404 routes,${input.unique404Routes ?? ""}`);
  rows.push(
    `404 rate (%),${
      typeof input.views404RatePct === "number" && Number.isFinite(input.views404RatePct)
        ? input.views404RatePct.toFixed(2)
        : ""
    }`
  );
  rows.push("");
  rows.push("Top 404 Routes");
  rows.push("Path,Views,Source");
  if (input.topRoutes.length) {
    input.topRoutes.forEach((route) => {
      rows.push(
        [
          csvEscape(route.routePath || "—"),
          route.views404 != null && Number.isFinite(route.views404) ? String(route.views404) : "",
          csvEscape(route.source || ""),
        ].join(",")
      );
    });
  } else {
    rows.push("None,,");
  }
  return rows.join("\n");
}

/* =========================
  Tone (bad=red, ok=lime, good=blue)
  ========================= */
type Tone = "good" | "ok" | "bad";

function toneFor404Total(v: number | null): Tone {
  if (v == null) return "ok";
  if (v <= 0) return "good";
  if (v <= 50) return "ok";
  return "bad";
}

/* =========================
  Route intelligence (no fake stats; pure inference)
  ========================= */
type RouteInsight = { label: string; fix: string };

function inferRouteInsights(routePath: string): RouteInsight[] {
  const p = String(routePath || "").trim();
  if (!p) return [];

  const out: RouteInsight[] = [];

  const hasQuery = p.includes("?");
  const hasHash = p.includes("#");
  const hasUpper = /[A-Z]/.test(p);
  const hasSpace = /\s/.test(p);
  const hasDoubleSlash = /\/{2,}/.test(p);
  const endsSlash = p.length > 1 && p.endsWith("/");
  const looksFile = /\.[a-z0-9]{2,5}($|\?)/i.test(p);
  const hasEncoded = /%[0-9A-F]{2}/i.test(p);
  const hasWww = /^https?:\/\/www\./i.test(p);
  const hasHttp = /^https?:\/\//i.test(p);

  if (hasHttp) out.push({ label: "Absolute URL captured", fix: "Normalize to a relative path before linking; avoid hardcoded origins in internal nav." });
  if (hasWww) out.push({ label: "www / apex mismatch", fix: "Ensure canonical host + redirects are consistent; update internal links to the canonical host." });
  if (hasDoubleSlash) out.push({ label: "Double slash path", fix: "Sanitize URL joins in your router / link builder; collapse repeated slashes." });
  if (hasSpace) out.push({ label: "Whitespace in path", fix: "Encode spaces (%20) or replace with hyphens; validate slug generation." });
  if (hasUpper) out.push({ label: "Case sensitivity risk", fix: "Unify route casing; add redirects (or rewrite rules) from mixed-case to canonical lowercase." });
  if (endsSlash) out.push({ label: "Trailing slash mismatch", fix: "Pick a canonical slash policy and redirect the opposite variant (with ↔ without)." });
  if (looksFile) out.push({ label: "Static asset missing", fix: "Verify file exists + correct path; check build output paths and CDN caching rules." });
  if (hasQuery) out.push({ label: "Query-driven route", fix: "If query is expected, ensure route handler doesn’t drop params; otherwise strip unknown params before routing." });
  if (hasHash) out.push({ label: "Hash fragment", fix: "Hashes don’t affect server routing; if this 404s, the base path is missing or mislinked." });
  if (hasEncoded) out.push({ label: "Encoded characters", fix: "Decode/encode consistently; validate URL-safe slugs and server decoding logic." });

  // If nothing obvious, give the highest-value generic diagnosis
  if (!out.length) {
    out.push({ label: "Broken internal link or stale external reference", fix: "Find the referring page, update the link, then 301 redirect the old path to the new canonical route." });
  }

  return out.slice(0, 3);
}

function primaryInsight(routePath: string) {
  const list = inferRouteInsights(routePath);
  return list[0] || { label: "Unknown cause", fix: "Inspect referrer + recent deploy history; add a targeted redirect once root cause is confirmed." };
}

function safeISOLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  return String(iso).replace("T", " ").replace("Z", " UTC").slice(0, 19);
}

/* =========================
  Simple sparkline helpers (no libraries)
  ========================= */
function svgSpark(values: number[]) {
  const w = 240;
  const h = 48;
  const pad = 4;
  const nPts = values.length;
  if (!nPts) return "";
  const maxV = Math.max(1, ...values);
  const minV = Math.min(0, ...values);
  const span = Math.max(1, maxV - minV);

  const pts = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(1, nPts - 1);
    const y = h - pad - ((v - minV) * (h - pad * 2)) / span;
    return [x, y] as const;
  });

  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return d.trim();
}

export default async function ControlRoomGamesPage({ searchParams }: PageProps) {
  noStore();
  const sp = await searchParams;

  const range = (typeof sp?.range === "string" ? sp.range : "24h") as RangeKey;

  let ws: LooseWorkspace | null = null;
  try {
    ws = await readWorkspace();
  } catch {
    ws = null;
  }

  const targets = normalizeTargets(ws);
  const sites = targets.map((t) => {
    const siteOrigin = t.origin;
    return { id: t.id, label: resolveSiteLabel(t), origin: siteOrigin, url: siteOrigin };
  });

  const siteParam = typeof sp?.site === "string" ? sp.site : "";

  const wsActiveOrigin =
    canonicalOrigin(
      ws?.activeSiteOrigin ||
        ws?.selection?.activeSiteOrigin ||
        ws?.activeSite?.origin ||
        ws?.workspace?.activeSiteOrigin ||
        ""
    ) || "";

  const siteById = sites.find((s) => s.id === siteParam);
  const siteByOrigin = siteParam.startsWith("http") ? sites.find((s) => s.url === canonicalOrigin(siteParam)) : null;
  const siteByWorkspace = !siteParam && wsActiveOrigin ? sites.find((s) => s.url === wsActiveOrigin) : null;

  const activeSite = siteById || siteByOrigin || siteByWorkspace || sites[0] || { id: "none", label: "No site selected", url: "" };

  const projectId = String(ws?.projectId || ws?.project?.id || ws?.account?.projectId || "1");

  let summary: unknown = null;
  let cr: ControlRoomPayload = {};

  try {
    summary = await getProjectSummary(projectId, {
      range: range === "30d" ? "30d" : "7d",
      siteOrigin: activeSite.url || undefined,
    });
    cr = normalizeControlRoomFromSummary(summary);
  } catch {
    summary = null;
    cr = {};
  }

  const arcadeIdentity = await resolveArcadeIdentity({
    projectId,
    siteOrigin: activeSite.url || wsActiveOrigin || "",
  });
  cr = applyArcadeIdentity(cr, arcadeIdentity);
  const configuredArcadeGameName = arcadeIdentity?.displayName || null;

  const updatedAtLabel = safeISOLabel(cr.updatedAtISO ?? null);

  // Derive some safe rollups (still "real" because derived from real inputs)
  const topRoutes = (cr.topRoutes || []).slice(0, 18);
  const unique404RoutesDerived = cr.unique404Routes ?? (cr.topRoutes && cr.topRoutes.length ? cr.topRoutes.length : null);

  const top1 = topRoutes[0];
  const top1Views = top1?.views404 ?? null;

  const viewsTone = toneFor404Total(cr.views404Total ?? null);
  const trendVals = (cr.trend || [])
    .map((p) => nOrNull(p.views404) ?? 0)
    .slice(-24);

  const sparkD = trendVals.length ? svgSpark(trendVals) : "";

  const LIVE_TZ = "America/Los_Angeles";
  const reportCsv = buildControlRoomReportCSV({
    siteLabel: activeSite.label || "Site",
    siteUrl: activeSite.url || "",
    range,
    updatedAtLabel,
    views404Total: cr.views404Total ?? null,
    unique404Routes: cr.unique404Routes ?? unique404RoutesDerived,
    views404RatePct: cr.views404RatePct ?? null,
    topRoutes,
  });
  void reportCsv;
  const reportParams = new URLSearchParams();
  reportParams.set("module", "control_room");
  reportParams.set("projectId", projectId);
  reportParams.set("range", range);
  if (activeSite.id && activeSite.id !== "none") reportParams.set("siteId", activeSite.id);
  if (activeSite.url) reportParams.set("origin", activeSite.url);
  const reportHref = `/console/report?${reportParams.toString()}`;
  const reportFileName = `control-room-${toSlug(activeSite.label || activeSite.id || "site")}-${range}.html`;
  const leaderboardRows = (cr.leaderboard || []).slice(0, 10);
  const leaderboardTopScore = leaderboardRows.reduce<number | null>((maxScore, row) => {
    const score = nOrNull(row.score);
    if (score == null) return maxScore;
    if (maxScore == null) return score;
    return score > maxScore ? score : maxScore;
  }, null);
  const leaderboardGameCount = new Set(
    leaderboardRows.map((row) => String(row.gameId || "").trim()).filter(Boolean)
  ).size;

  return (
    <AppShell title="Workspace" subtitle="Workspace command center">
      
      <div className="err-page">
        <div className="cb-console">
        

          {/* HEADER */}
          <header className="crg-head">
            <div className="crg-head-left">
              <div className="crg-titleblock">
                <h1 className="crg-h1">404 Control Room</h1>
                <p className="crg-sub">
                  Arcade-style recovery intelligence — track broken routes, see what clients typed, and understand why routes failed.
                </p>
              </div>

              <div className="crg-meta" />
            </div>

            <div className="crg-head-right" aria-label="Controls">
              <DashboardToolsControls
                containerClassName="crg-controls"
                rangeLabelClassName="crg-range"
                rangeLabelTextClassName="crg-range-label"
                rangeSelectClassName="crg-range-select"
                buttonClassName="cb-tool-pill"
                range={range}
                sites={sites}
                selectedSiteId={activeSite.id}
                reportHref={reportHref}
                reportFileName={reportFileName}
              />
            </div>
          </header>
<br /><br /><br /><br />
          {/* HERO METRICS */}
          <section className="crg-grid" aria-label="404 rollups">
            <article className={`cb-card tone-${viewsTone}`}>
              <div className="cb-card-top">
                <div className="cb-card-label">404 Views</div>
                <div className="cb-card-metric">{fmtInt(cr.views404Total)}</div>
              </div><br />
              <div className="cb-card-sub">
                Total not-found impressions captured for the selected target and range.
              </div>
            </article>

            <article className="cb-card tone-ok">
              <div className="cb-card-top">
                <div className="cb-card-label">Unique Broken Routes</div>
                <div className="cb-card-metric">{fmtInt(unique404RoutesDerived)}</div>
              </div><br />
              <div className="cb-card-sub">
                Distinct 404 paths observed. Use this to size the recovery workload.
              </div>
            </article>

            <article className="cb-card tone-ok">
              <div className="cb-card-top">
                <div className="cb-card-label">Top Route Impact</div>
                <div className="cb-card-metric">{fmtInt(top1Views)}</div>
              </div><br />
              <div className="cb-card-sub">
                {top1?.routePath ? (
                  <>
                    Highest-impact path: <span className="mono">{top1.routePath}</span>
                  </>
                ) : (
                  <>Highest-impact path will appear once 404 route aggregation is available.</>
                )}
              </div>
            </article>

            <article className="cb-card tone-ok">
              <div className="cb-card-top">
                <div className="cb-card-label">Trend</div>
                <div className="cb-card-metric">{trendVals.length ? fmtInt(trendVals[trendVals.length - 1]) : "—"}</div>
              </div>
              <div className="cb-card-sub">
                <div className="crg-spark" aria-label="404 views sparkline">
                  {sparkD ? (
                    <svg viewBox="0 0 240 48" width="240" height="48" aria-hidden="true">
                      <path d={sparkD} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.85" />
                    </svg>
                  ) : (
                    <span className="crg-dim">No trend points yet.</span>
                  )}
                </div>
              </div>
            </article>
          </section>
          {/* BROKEN ROUTES */}
          <section className="crg-section" aria-label="Broken routes">
            <article className="cb-card cb-card-pad crg-routes-section">
              <div className="cb-card-head">
                <div>
                  <h2 className="cb-h2">Broken Routes</h2>
                  <p className="cb-sub">The highest-impact 404 paths — prioritize these first.</p>
                </div>
                <div className="crg-pillrow">
                  <span className="crg-pill">
                    Showing: <b>{fmtInt(topRoutes.length)}</b>
                  </span>
                </div>
              </div>
              {topRoutes.length ? (
                <div className={`crg-tablewrap crg-tablewrap-routes${topRoutes.length > 10 ? " is-scroll" : ""}`}>
                  <table className="crg-table" aria-label="Top 404 routes table">
                    <thead>
                      <tr>
                        <th>Route</th>
                        <th className="t-right">404 Views</th>
                        <th>Likely Cause</th>
                        <th>Fix</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topRoutes.map((r, i) => {
                        const route = r.routePath || "—";
                        const insight = primaryInsight(route);
                        return (
                          <tr key={`${route}-${i}`}>
                            <td className="mono">{route}</td>
                            <td className="t-right">{fmtInt(r.views404)}</td>
                            <td>
                              <div className="crg-chips">
                                {inferRouteInsights(route).map((x, idx) => (
                                  <span key={idx} className="crg-chip-mini">
                                    {x.label}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="crg-fix">{insight.fix}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="crg-empty crg-empty-compact">
                  <div className="crg-empty-title">No 404 route rows available yet.</div>
                  <div className="crg-empty-sub">
                    As CavBot aggregates 404 paths from events, this table will populate with real broken routes.
                  </div>
                </div>
              )}
            </article>
          </section>

          {/* ARCADE TELEMETRY */}
          <section className="cb-card cb-card-pad crg-arcade-section" aria-label="Arcade telemetry">
            <div className="cb-card-head crg-headrow">
              <div>
                <h2 className="cb-h2">Arcade Telemetry</h2>
                <p className="cb-sub">Gameplay and score signals for your 404 recovery surfaces.</p>
              </div>
              <div className="crg-pillrow">
                <span className="crg-pill">
                  Games: <b>{fmtInt(cr.games?.length ?? null)}</b>
                </span>
              </div>
            </div>
            {cr.games && cr.games.length ? (
              <div className="crg-games">
                {cr.games.slice(0, 8).map((g, i) => (
                  <div key={`${g.gameId || "g"}-${i}`} className="crg-game">
                    <div className="crg-game-top">
                      <div className="crg-game-name">{g.name || g.gameId || "Game"}</div>
                      <div className="crg-game-id mono">{g.gameId || "—"}</div>
                    </div>

                    <div className="crg-game-grid">
                      <div className="crg-stat">
                        <div className="crg-stat-k">Sessions</div>
                        <div className="crg-stat-v">{fmtInt(g.sessions)}</div>
                      </div>
                      <div className="crg-stat">
                        <div className="crg-stat-k">Plays</div>
                        <div className="crg-stat-v">{fmtInt(g.plays)}</div>
                      </div>
                      <div className="crg-stat">
                        <div className="crg-stat-k">Avg Score</div>
                        <div className="crg-stat-v">{fmtInt(g.avgScore)}</div>
                      </div>
                      <div className="crg-stat">
                        <div className="crg-stat-k">High Score</div>
                        <div className="crg-stat-v">{fmtInt(g.highScore)}</div>
                      </div>
                      <div className="crg-stat">
                        <div className="crg-stat-k">Completion</div>
                        <div className="crg-stat-v">{fmtPct(g.completionPct, 1)}</div>
                      </div>
                    </div>

                    <div className="crg-game-sub">
                      If scores are low or completion drops, your recovery flow might be confusing — tighten CTAs, simplify choices, and make the “Back to safety” path obvious.
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="crg-empty crg-empty-compact crg-game-empty">
                <div className="crg-empty-title">No gameplay telemetry yet.</div>
                <div className="crg-empty-sub">
                  {configuredArcadeGameName ? (
                    <>
                      Once your <span className="mono">{configuredArcadeGameName}</span> surface emits game events, CavBot will
                      surface sessions, plays, scores, and completion here.
                    </>
                  ) : (
                    <>Once your 404 game surfaces emit game events, CavBot will surface sessions, plays, scores, and completion here.</>
                  )}
                </div>
              </div>
            )}
            <div className="crg-leader">
              <div className="crg-leader-top">
                <div className="crg-leader-head">
                  <div className="crg-leader-k">Leaderboard</div>
                  <div className="crg-leader-sub">High scores captured from real 404 game sessions.</div>
                </div>
              </div>

              {leaderboardRows.length ? (
                <>
                  <div className="crg-leader-metrics" aria-label="Leaderboard summary">
                    <div className="crg-leader-metric">
                      <span className="crg-leader-metric-k">Entries</span>
                      <span className="crg-leader-metric-v">{fmtInt(leaderboardRows.length)}</span>
                    </div>
                    <div className="crg-leader-metric">
                      <span className="crg-leader-metric-k">Top Score</span>
                      <span className="crg-leader-metric-v">{fmtInt(leaderboardTopScore)}</span>
                    </div>
                    <div className="crg-leader-metric">
                      <span className="crg-leader-metric-k">Games</span>
                      <span className="crg-leader-metric-v">{fmtInt(leaderboardGameCount || null)}</span>
                    </div>
                  </div>

                <div className="crg-tablewrap crg-leader-tablewrap">
                  <table className="crg-table crg-leader-table" aria-label="Leaderboard table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Game</th>
                        <th className="t-right">Score</th>
                        <th>Captured</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboardRows.map((x, i) => (
                        <tr key={i}>
                          <td>
                            <div className="crg-leader-player">
                              <span className={`crg-leader-rank${i < 3 ? ` is-top-${i + 1}` : ""}`}>#{i + 1}</span>
                              <span className="crg-leader-player-name">{x.label || "—"}</span>
                            </div>
                          </td>
                          <td className="mono crg-leader-game">{x.gameId || "—"}</td>
                          <td className="t-right"><span className="crg-leader-score">{fmtInt(x.score)}</span></td>
                          <td className="mono crg-leader-captured">{safeISOLabel(x.achievedAtISO || null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              ) : (
                <div className="crg-mini-empty crg-leader-empty">
                  <div className="crg-leader-empty-title">No leaderboard feed yet.</div>
                  <div className="crg-leader-empty-sub">
                    Once score events arrive, CavBot will auto-populate top players, games, and run timestamps here.
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="crg-section" aria-label="Route explanation">
            <article className="cb-card cb-card-pad crg-why-section">
              <div className="cb-card-head">
                <div>
                  <h2 className="cb-h2">Why Routes Break</h2>
                  <p className="cb-sub">CavBot flags the patterns that most commonly produce 404 damage.</p>
                </div>
              </div>
              <div className="crg-why">
                <div className="crg-why-item">
                  <div className="crg-why-k">Internal link drift</div>
                  <div className="crg-why-v">A route changed but nav, CMS, or templates still point to the old path.</div>
                  <div className="crg-why-fix">Fix: update the source link and 301 the old path to the new canonical route.</div>
                </div>

                <div className="crg-why-item">
                  <div className="crg-why-k">Slash + casing mismatch</div>
                  <div className="crg-why-v">With/without trailing slash or mixed-case paths fragment route integrity.</div>
                  <div className="crg-why-fix">Fix: choose one canonical variant and redirect the other consistently.</div>
                </div>

                <div className="crg-why-item">
                  <div className="crg-why-k">Asset path breakage</div>
                  <div className="crg-why-v">Build output or CDN rewrite rules move static assets without updating references.</div>
                  <div className="crg-why-fix">Fix: verify build manifests + update asset base paths; purge CDN caches.</div>
                </div>

                <div className="crg-why-item">
                  <div className="crg-why-k">Referrer leakage</div>
                  <div className="crg-why-v">External sources keep linking to deprecated paths after migrations.</div>
                  <div className="crg-why-fix">Fix: keep a migration redirect map; add targeted 301s for top referrers.</div>
                </div>
              </div>
              {/* Typed Routes + Referrers (real only if provided) */}
              <div className="crg-mini-split">
                <div className="crg-mini">
                  <div className="crg-mini-k">Most Typed Routes</div>
                  {cr.typedRoutes && cr.typedRoutes.length ? (
                    <ul className="crg-mini-list" aria-label="Typed routes list">
                      {cr.typedRoutes.slice(0, 6).map((r, i) => (
                        <li key={i}>
                          <span className="mono">{r.routePath}</span>
                          <span className="crg-mini-count">{fmtInt(r.views404)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="crg-mini-empty">No typed-route feed yet.</div>
                  )}
                </div>

                <div className="crg-mini">
                  <div className="crg-mini-k">Top Referrers</div>
                  {cr.referrers && cr.referrers.length ? (
                    <ul className="crg-mini-list" aria-label="Referrers list">
                      {cr.referrers.slice(0, 6).map((r, i) => (
                        <li key={i}>
                          <span className="mono">{r.referrer}</span>
                          <span className="crg-mini-count">{fmtInt(r.count)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="crg-mini-empty">No referrer rollup yet.</div>
                  )}
                </div>
              </div>
            </article>
          </section>
          {/* LOCAL SESSION SNAPSHOT (client-only, real only) */}
          <section className="cb-card cb-card-pad crg-local-section" aria-label="Local session snapshot">
            <div className="cb-card-head">
              <div>
                <h2 className="cb-h2">Local Session Snapshot</h2>
                <p className="cb-sub">Session-level diagnostics captured locally for immediate visibility and faster analysis.</p>
              </div>
            </div>
            <div className="crg-local-grid">
              <div className="crg-local tone-health">
                <div className="crg-local-k">Brain Health</div>
                <div className="crg-local-v" id="crg-local-health">—</div>
                <div className="crg-local-sub">Weighted posture from CavAi across SEO, performance, accessibility, UX, and engagement.</div>
              </div>
              <div className="crg-local tone-events">
                <div className="crg-local-k">404 Game Events (local)</div>
                <div className="crg-local-v" id="crg-local-game-events">—</div>
                <div className="crg-local-sub">Count of local events tagged as 404 control-room gameplay.</div>
              </div>
              <div className="crg-local tone-queue">
                <div className="crg-local-k">Queued Analytics Records</div>
                <div className="crg-local-v" id="crg-local-queue">—</div>
                <div className="crg-local-sub">Queued V5 records waiting to flush when the device is ready.</div>
              </div>
            </div>
          </section>

          <br />
          <br />

          <CavAiRouteRecommendations
            panelId="control-room"
            snapshot={summary}
            origin={activeSite.url || ""}
            pagesScanned={cr.unique404Routes ?? cr.views404Total ?? 1}
            title="CavBot 404 Reliability Priorities"
            subtitle="Deterministic 404 recovery priorities with evidence-linked actions."
            pillars={["reliability", "ux", "engagement", "performance"]}
          />


          {/* LIVE time ticker */}
          <Script id="cb-crg-live-time" strategy="afterInteractive">
            {`
(function(){
  try{
    if(window.__cbCrgLiveTimeInt) clearInterval(window.__cbCrgLiveTimeInt);
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
  window.__cbCrgLiveTimeInt = setInterval(tick, 10000);
})();`}
          </Script>


          {/* Local Snapshot wiring (real-only; reads CavAI Brain + local queues) */}
          <Script id="cb-crg-local-wire" strategy="afterInteractive">
            {`
(function(){
  function set(id, v){
    try{
      var el = document.getElementById(id);
      if(el) el.textContent = (v == null || v === "") ? "—" : String(v);
    }catch(e){}
  }

  function safeJSON(s){
    try{ return JSON.parse(s); }catch(e){ return null; }
  }

  function countGameEvents(){
    // Brain Gen 1 event log (local)
    var raw = null;
    try{ raw = globalThis.__cbLocalStore.getItem("cavbotEventLogV1"); }catch(e){}
    var log = raw ? safeJSON(raw) : null;
    var n1 = 0;

    if(Array.isArray(log)){
      for(var i=0;i<log.length;i++){
        var ev = log[i] || {};
        var name = String(ev.name || ev.event || "");
        var pt = String(ev.page_type || ev.pageType || ev.meta && ev.meta.page_type || "");
        if(name.indexOf("404") !== -1 || pt.indexOf("404") !== -1) n1++;
      }
    }

    // V5 queue (local)
    var rawQ = null;
    try{ rawQ = globalThis.__cbLocalStore.getItem("cavbotAnalyticsQueueV5"); }catch(e){}
    var q = rawQ ? safeJSON(rawQ) : null;
    var n2 = 0;
    if(Array.isArray(q)){
      for(var j=0;j<q.length;j++){
        var rec = q[j] || {};
        var pt2 = String(rec.page_type || rec.pageType || (rec.base && rec.base.page_type) || "");
        var comp = String(rec.component || rec.componentName || (rec.base && rec.base.component) || "");
        if(pt2.indexOf("404") !== -1 || comp.indexOf("404") !== -1) n2++;
      }
    }
    return { log:n1, queue:n2, queueSize: Array.isArray(q) ? q.length : null };
  }

  function readBrain(){
    try{
      var b = window.cavai;
      if(!b) return null;

      var sid = null;
      try{ sid = b.getSessionId ? b.getSessionId() : null; }catch(e){}

      var scores = null;
      try{ scores = b.getHealthScores ? b.getHealthScores() : null; }catch(e){}

      var overall = null;
      if(scores && typeof scores === "object"){
        // pick the most likely overall key (keep it real; no guessing if absent)
        overall = (scores.overall != null ? scores.overall : (scores.total != null ? scores.total : null));
      }

      return { sessionId: sid, overall: overall };
    }catch(e){
      return null;
    }
  }

  function tick(){
    var brain = readBrain();
    if(brain){
      set("crg-local-session", brain.sessionId || "—");
      if(brain.overall != null){
        var pct = Math.max(0, Math.min(100, Number(brain.overall)));
        set("crg-local-health", pct.toFixed(0) + "%");
      }else{
        set("crg-local-health", "—");
      }
    }else{
      set("crg-local-session", "—");
      set("crg-local-health", "—");
    }

    var c = countGameEvents();
    var gameEv = (c.log != null ? c.log : 0) + (c.queue != null ? c.queue : 0);
    set("crg-local-game-events", String(gameEv));
    set("crg-local-queue", c.queueSize != null ? String(c.queueSize) : "—");
  }

  tick();
  try{
    if(window.__cbCrgLocalInt) clearInterval(window.__cbCrgLocalInt);
  }catch(e){}
  window.__cbCrgLocalInt = setInterval(tick, 4000);
})();`}
          </Script>
        </div>
      </div>
    </AppShell>
  );
}
