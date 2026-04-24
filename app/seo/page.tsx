// app/seo/page.tsx
import "./seo.css";

import Image from "next/image";
import Script from "next/script";
import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { gateModuleAccess } from "@/lib/moduleGate.server";
import LockedModule from "@/components/LockedModule";
import AppShell from "@/components/AppShell";
import CavAiRouteRecommendations from "@/components/CavAiRouteRecommendations";
import { readWorkspace } from "@/lib/workspaceStore.server";
import type { WorkspacePayload } from "@/lib/workspaceStore.server";
import { getTenantProjectSummary } from "@/lib/projectSummary.server";
import {
  generateSeoActions,
  medianSeoScore,
  scoreSeoPages,
  worstPages,
  type ScoredSeoPageRow,
  type SeoActionItem,
} from "@/lib/seo/seoInsights";
import {
  buildFaviconIntelligence,
  faviconBytesLabel,
  faviconIssueLabel,
  faviconPrimaryLabel,
  faviconSizeLabel,
  faviconSourceLabel,
  type FaviconIntelligenceResult,
} from "@/lib/seo/faviconIntelligence";
import { fetchLiveMetadataSnapshot } from "@/lib/seo/liveMetadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type RangeKey = "24h" | "7d" | "14d" | "30d";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function toStringSafe(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function toBooleanSafe(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  if (typeof value === "number" && !Number.isNaN(value)) return Boolean(value);
  return null;
}

function firstString(rec: UnknownRecord | null, ...keys: string[]): string | null {
  if (!rec) return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(rec, key)) {
      const str = toStringSafe(rec[key]);
      if (str) return str;
    }
  }
  return null;
}

function firstRecord(...values: unknown[]): UnknownRecord | null {
  for (const value of values) {
    const rec = asRecord(value);
    if (rec) return rec;
  }
  return null;
}

function firstArray(...values: unknown[]): unknown[] | null {
  for (const value of values) {
    const arr = asArray(value);
    if (arr && arr.length) return arr;
  }
  return null;
}

type SeoWorkspace = WorkspacePayload & {
  // Some pages/components have historically stored selection pointers here.
  // Keep these additive without narrowing WorkspacePayload (avoid TS incompatibilities).
  selection?: { activeSiteOrigin?: string | null } | null;
  activeSite?: { origin?: string | null } | null;
  project?: { id?: number | string | null } | null;
};

/* =========================
  Shared helpers (match Errors)
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
  if (x == null) return null;
  if (typeof x === "string" && !x.trim()) return null;
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
function fmtCls(v: unknown) {
  const x = nOrNull(v);
  if (x == null) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(x);
}
function normalizeVitalMetric(v: unknown) {
  const x = nOrNull(v);
  if (x == null) return null;
  return x > 0 ? x : null;
}
function fmtVitalMs(v: unknown) {
  return fmtMs(normalizeVitalMetric(v));
}
function fmtVitalCls(v: unknown) {
  return fmtCls(normalizeVitalMetric(v));
}

function toHostPath(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "—";
  try {
    const u = new URL(s);
    const path = u.pathname || "/";
    return `${u.hostname}${path}`;
  } catch {
    return s;
  }
}

function nonEmptyText(value: unknown): string | null {
  const text = toStringSafe(value);
  if (!text) return null;
  const cleaned = text.trim();
  return cleaned ? cleaned : null;
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

function normalizeTargets(raw: unknown): ClientTarget[] {
  const roots: UnknownRecord[] = [];
  const push = (x: unknown) => {
    const rec = asRecord(x);
    if (rec) roots.push(rec);
  };

  const rawRecord = asRecord(raw);
  push(rawRecord);
  push(rawRecord?.workspace);
  push(rawRecord?.commandDeck);
  push(rawRecord?.deck);
  push(rawRecord?.data);
  push(rawRecord?.state);
  push(rawRecord?.project);
  push(rawRecord?.account);
  push(rawRecord?.payload);

  const keys = ["targets", "sites", "monitoredSites", "origins", "monitoredOrigins", "sitesList", "targetsList"];

  for (const r of roots) {
    for (const k of keys) {
      const v = r?.[k];
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
          const entry = asRecord(item);
          if (entry) {
            const rawOrigin =
              firstString(entry, "origin", "url", "siteOrigin", "href", "baseUrl", "website", "primaryOrigin") || "";
            origin = canonicalOrigin(rawOrigin);
            id = toSlug(
              firstString(entry, "slug", "id") ||
                origin ||
                "site"
            );
            label =
              firstString(entry, "label") ||
              firstString(entry, "name") ||
              firstString(entry, "displayName") ||
              firstString(entry, "title");
          }
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
  SEO payload normalization
  ========================= */
type SeoPageRow = {
  urlPath: string | null;
  origin: string | null;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robots: string | null;
  noindex: boolean | null;
  nofollow: boolean | null;
  h1Count: number | null;
  wordCount: number | null;
  updatedAtISO: string | null;
  issues: string[] | null;

  // Optional enrichments (only if present in snapshots)
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  jsonLdCount: number | null;
  schemaTypes: string[] | null;
  htmlLang: string | null;
};

type SeoPayload = {
  updatedAtISO?: string | null;

  pagesObserved?: number | null;

  // Coverage (0..100)
  titleCoveragePct?: number | null;
  descriptionCoveragePct?: number | null;
  canonicalCoveragePct?: number | null;

  // Indexability
  noindexPct?: number | null;
  nofollowPct?: number | null;

  // Structure
  missingH1Pct?: number | null;
  multipleH1Pct?: number | null;
  thinContentPct?: number | null;

  // Volumes
  noindexCount?: number | null;
  nofollowCount?: number | null;
  missingTitleCount?: number | null;
  missingDescriptionCount?: number | null;
  missingCanonicalCount?: number | null;
  missingH1Count?: number | null;
  multipleH1Count?: number | null;
  thinContentCount?: number | null;

  // Samples (latest / representative)
  sampleTitle?: string | null;
  sampleDescription?: string | null;
  sampleCanonical?: string | null;
  sampleRobots?: string | null;

  // Page rows (optional)
  pages?: SeoPageRow[];

  // Derived insights (computed locally from ingested snapshots)
  actions?: SeoActionItem[];
  siteSeoScore?: number | null;
  topBadPages?: ScoredSeoPageRow[];
  favicon?: FaviconIntelligenceResult | null;
};

function normalizeSeoFromSummary(summary: unknown): SeoPayload {
  const summaryRecord = asRecord(summary);
  const diagnosticRecord = firstRecord(summaryRecord?.diagnostics);
  const guardianRecord = firstRecord(summaryRecord?.guardian);
  const snapshotRecord = firstRecord(summaryRecord?.snapshot);

  const s = firstRecord(
    summaryRecord?.seo,
    summaryRecord?.seoIntelligence,
    summaryRecord?.seoPosture,
    diagnosticRecord?.seo,
    guardianRecord?.seo,
    snapshotRecord?.seo,
    summaryRecord
  );

  const rollup = firstRecord(
    s?.rollup,
    s?.summary,
    s?.totals,
    s?.counts,
    s
  );

  const pagesRaw = firstArray(
    s?.pages,
    s?.pageRows,
    s?.rows,
    s?.inspectedPages,
    rollup?.pages
  );

  const pages =
    pagesRaw && pagesRaw.length
      ? pagesRaw
          .map((item) => {
            const entry = asRecord(item);
            if (!entry) return null;

            const urlPath = firstString(entry, "urlPath", "path");
            const origin = firstString(entry, "origin", "siteOrigin");
            const issuesArray = asArray(entry.issues);
            const issues =
              issuesArray?.map((x) => toStringSafe(x)).filter((x): x is string => typeof x === "string" && x.length > 0) ?? null;

            return {
              urlPath: urlPath || null,
              origin: origin || null,
              title: firstString(entry, "title") || null,
              metaDescription: firstString(entry, "metaDescription", "description") || null,
              canonical: firstString(entry, "canonical") || null,
              robots: firstString(entry, "robots") || null,
              noindex: toBooleanSafe(entry.noindex),
              nofollow: toBooleanSafe(entry.nofollow),
              h1Count: nOrNull(entry.h1Count ?? entry.h1_count ?? entry.h1 ?? null),
              wordCount: nOrNull(entry.wordCount ?? entry.word_count ?? entry.words ?? null),
              updatedAtISO: firstString(entry, "updatedAtISO", "updatedAt") || null,
              issues: issues?.length ? issues.slice(0, 16) : null,

              // Enrichments: only if present in the snapshot payload; otherwise null.
              ogTitle: firstString(entry, "ogTitle", "og:title") || null,
              ogDescription: firstString(entry, "ogDescription", "og:description") || null,
              ogImage: firstString(entry, "ogImage", "og:image") || null,
              jsonLdCount: nOrNull(entry.jsonLdCount ?? entry.jsonldCount ?? entry.jsonLd ?? null),
              schemaTypes: (() => {
                const raw = asArray(entry.schemaTypes ?? entry.schemas ?? entry.structuredDataTypes);
                if (!raw || !raw.length) return null;
                const out = raw
                  .map((x) => toStringSafe(x))
                  .filter((x): x is string => typeof x === "string" && x.length > 0)
                  .slice(0, 12);
                return out.length ? out : null;
              })(),
              htmlLang: firstString(entry, "htmlLang", "lang", "documentLang") || null,
            };
          })
          .filter((p): p is SeoPageRow => Boolean(p && p.urlPath))
          .slice(0, 80)
      : [];

  const metaRecord = asRecord(summaryRecord?.meta);
  const updatedAtISO =
    s?.updatedAtISO ||
    s?.updatedAt ||
    rollup?.updatedAtISO ||
    firstString(summaryRecord, "updatedAtISO") ||
    firstString(metaRecord, "updatedAtISO") ||
    null;

  return {
    updatedAtISO: updatedAtISO ? String(updatedAtISO) : null,

    pagesObserved: nOrNull(rollup?.pagesObserved ?? rollup?.pages_observed ?? rollup?.pages ?? rollup?.inspectedPages),

    titleCoveragePct: nOrNull(rollup?.titleCoveragePct ?? rollup?.title_coverage_pct ?? rollup?.titleCoverage),
    descriptionCoveragePct: nOrNull(
      rollup?.descriptionCoveragePct ?? rollup?.description_coverage_pct ?? rollup?.metaDescriptionCoveragePct
    ),
    canonicalCoveragePct: nOrNull(rollup?.canonicalCoveragePct ?? rollup?.canonical_coverage_pct ?? rollup?.canonicalCoverage),

    noindexPct: nOrNull(rollup?.noindexPct ?? rollup?.noindex_pct ?? rollup?.noIndexPct),
    nofollowPct: nOrNull(rollup?.nofollowPct ?? rollup?.nofollow_pct ?? rollup?.noFollowPct),

    missingH1Pct: nOrNull(rollup?.missingH1Pct ?? rollup?.missing_h1_pct ?? rollup?.missingH1),
    multipleH1Pct: nOrNull(rollup?.multipleH1Pct ?? rollup?.multiple_h1_pct ?? rollup?.multipleH1),
    thinContentPct: nOrNull(rollup?.thinContentPct ?? rollup?.thin_content_pct ?? rollup?.thinContent),

    noindexCount: nOrNull(rollup?.noindexCount ?? rollup?.noindex_count ?? rollup?.noIndexCount),
    nofollowCount: nOrNull(rollup?.nofollowCount ?? rollup?.nofollow_count ?? rollup?.noFollowCount),
    missingTitleCount: nOrNull(rollup?.missingTitleCount ?? rollup?.missing_title_count),
    missingDescriptionCount: nOrNull(rollup?.missingDescriptionCount ?? rollup?.missing_description_count),
    missingCanonicalCount: nOrNull(rollup?.missingCanonicalCount ?? rollup?.missing_canonical_count),
    missingH1Count: nOrNull(rollup?.missingH1Count ?? rollup?.missing_h1_count),
    multipleH1Count: nOrNull(rollup?.multipleH1Count ?? rollup?.multiple_h1_count),
    thinContentCount: nOrNull(rollup?.thinContentCount ?? rollup?.thin_content_count),

    sampleTitle: rollup?.sampleTitle != null ? String(rollup.sampleTitle) : s?.sampleTitle != null ? String(s.sampleTitle) : null,
    sampleDescription:
      rollup?.sampleDescription != null
        ? String(rollup.sampleDescription)
        : s?.sampleDescription != null
        ? String(s.sampleDescription)
        : null,
    sampleCanonical:
      rollup?.sampleCanonical != null
        ? String(rollup.sampleCanonical)
        : s?.sampleCanonical != null
        ? String(s.sampleCanonical)
        : null,
    sampleRobots:
      rollup?.sampleRobots != null ? String(rollup.sampleRobots) : s?.sampleRobots != null ? String(s.sampleRobots) : null,

    pages,
  };
}

/* =========================
  Web Vitals normalization (optional)
  ========================= */
type VitalsPayload = {
  updatedAtISO?: string | null;
  samples?: number | null;
  lcpP75Ms?: number | null;
  inpP75Ms?: number | null;
  clsP75?: number | null;
  fcpP75Ms?: number | null;
  ttfbP75Ms?: number | null;
};

function normalizeVitalsFromSummary(summary: unknown): VitalsPayload {
  const summaryRecord = asRecord(summary);
  const v = firstRecord(
    summaryRecord?.webVitals,
    summaryRecord?.vitals,
    firstRecord(summaryRecord?.performance)?.vitals,
    firstRecord(summaryRecord?.performance)?.webVitals,
    firstRecord(summaryRecord?.guardian)?.vitals,
    firstRecord(summaryRecord?.diagnostics)?.vitals,
    null
  );

  const r = firstRecord(v?.rollup, v?.summary, v?.p75, v) ?? null;

  const updatedAtISO =
    v?.updatedAtISO != null
      ? String(v.updatedAtISO)
      : v?.updatedAt != null
      ? String(v.updatedAt)
      : firstString(summaryRecord, "updatedAtISO");

  const normalized = {
    updatedAtISO: updatedAtISO || null,
    samples: nOrNull(r?.samples ?? r?.n ?? r?.observations ?? r?.pagesObserved),

    lcpP75Ms: nOrNull(r?.lcpP75Ms ?? r?.lcp_p75_ms ?? r?.lcpP75 ?? r?.lcpMs),
    inpP75Ms: nOrNull(r?.inpP75Ms ?? r?.inp_p75_ms ?? r?.inpP75 ?? r?.inpMs),
    clsP75: nOrNull(r?.clsP75 ?? r?.cls_p75 ?? r?.cls),
    fcpP75Ms: nOrNull(r?.fcpP75Ms ?? r?.fcp_p75_ms ?? r?.fcpP75 ?? r?.fcpMs),
    ttfbP75Ms: nOrNull(r?.ttfbP75Ms ?? r?.ttfb_p75_ms ?? r?.ttfbP75 ?? r?.ttfbMs),
  };

  const noSamples = normalized.samples == null || normalized.samples <= 0;
  const allPlaceholder = [
    normalized.lcpP75Ms,
    normalized.inpP75Ms,
    normalized.clsP75,
    normalized.fcpP75Ms,
    normalized.ttfbP75Ms,
  ].every((value) => value == null || value === 0);

  if (noSamples && allPlaceholder) {
    normalized.samples = null;
    normalized.lcpP75Ms = null;
    normalized.inpP75Ms = null;
    normalized.clsP75 = null;
    normalized.fcpP75Ms = null;
    normalized.ttfbP75Ms = null;
  }

  return normalized;
}

/* =========================
  Tone (bad=red, ok=lime, good=blue)
  ========================= */
type Tone = "good" | "ok" | "bad";

function toneFromCoveragePct(pct: number | null): Tone {
  if (pct == null) return "ok";
  if (pct >= 95) return "good";
  if (pct >= 80) return "ok";
  return "bad";
}
function toneFromIssuePct(pct: number | null): Tone {
  if (pct == null) return "ok";
  if (pct <= 1) return "good";
  if (pct <= 5) return "ok";
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
function toneForFcp(ms: number | null): Tone {
  if (ms == null) return "ok";
  if (ms <= 1800) return "good";
  if (ms <= 3000) return "ok";
  return "bad";
}
function toneForTtfb(ms: number | null): Tone {
  if (ms == null) return "ok";
  if (ms <= 800) return "good";
  if (ms <= 1800) return "ok";
  return "bad";
}

function postureLabel(seo: SeoPayload): { label: string; tone: Tone } {
  const cov = seo.titleCoveragePct != null ? seo.titleCoveragePct : null;
  const desc = seo.descriptionCoveragePct != null ? seo.descriptionCoveragePct : null;
  const canon = seo.canonicalCoveragePct != null ? seo.canonicalCoveragePct : null;

  const noindex = seo.noindexPct != null ? seo.noindexPct : null;
  const missingH1 = seo.missingH1Pct != null ? seo.missingH1Pct : null;
  const thin = seo.thinContentPct != null ? seo.thinContentPct : null;

  const goodCov = (cov ?? 0) >= 95 && (desc ?? 0) >= 90 && (canon ?? 0) >= 90;
  const lowRisk = (noindex ?? 0) <= 1 && (missingH1 ?? 0) <= 1 && (thin ?? 0) <= 5;

  if (goodCov && lowRisk) return { label: "Elite", tone: "good" };
  if ((cov ?? 0) >= 85 && (desc ?? 0) >= 80 && (canon ?? 0) >= 80 && (noindex ?? 0) <= 5) return { label: "Stable", tone: "ok" };
  if ((cov ?? 0) >= 70 && (desc ?? 0) >= 70) return { label: "At Risk", tone: "bad" };
  return { label: "Critical", tone: "bad" };
}

function issueChips(row: SeoPageRow) {
  const chips: string[] = [];
  if (!row.title) chips.push("Missing title");
  if (!row.metaDescription) chips.push("Missing description");
  if (!row.canonical) chips.push("Missing canonical");
  if (row.noindex) chips.push("NoIndex");
  if (row.nofollow) chips.push("NoFollow");
  if ((row.h1Count ?? 0) === 0) chips.push("Missing H1");
  if ((row.h1Count ?? 0) > 1) chips.push("Multiple H1");
  if ((row.wordCount ?? 0) > 0 && (row.wordCount ?? 0) < 200) chips.push("Thin content");
  if (Array.isArray(row.issues)) chips.push(...row.issues.slice(0, 6));
  return chips.slice(0, 8);
}

export default async function SeoPage({ searchParams }: PageProps) {
  noStore();
  const sp = await searchParams;
  const requestHeaders = await headers();

  const req = new Request("https://cavbot.local/seo", {
    headers: new Headers(requestHeaders),
  });

  const gate = await gateModuleAccess(req, "seo");

  if (!gate.ok) {
    return (
      <AppShell title="Workspace" subtitle="Workspace command center">
        <LockedModule
          moduleName="SEO Intelligence"
          description="Search posture, indexability, page metadata coverage, and vitals across your monitored targets."
          requiredPlanLabel="Premium"
        />
      </AppShell>
    );
  }

  const range = (typeof sp?.range === "string" ? sp.range : "24h") as RangeKey;

  let ws: SeoWorkspace | null = null;
  try {
    ws = await readWorkspace();
  } catch {
    ws = null;
  }

  const targets = normalizeTargets(ws);
  const sites = targets.map((t) => ({ id: t.id, label: resolveSiteLabel(t), url: t.origin }));

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
  let seo: SeoPayload = {};
  let vitals: VitalsPayload = {};
  let favicon: FaviconIntelligenceResult | null = null;
  let liveMetadata: Awaited<ReturnType<typeof fetchLiveMetadataSnapshot>> = null;

  try {
    const { summary: loadedSummary } = await getTenantProjectSummary({
      projectId,
      range: range === "30d" ? "30d" : "7d",
      siteOrigin: activeSite.url || undefined,
    });
    summary = loadedSummary;
    seo = normalizeSeoFromSummary(summary);
    vitals = normalizeVitalsFromSummary(summary);
  } catch {
    summary = null;
    seo = {};
    vitals = {};
  }

  try {
    favicon = await buildFaviconIntelligence({
      origin: activeSite.url || "",
      summary,
    });
  } catch {
    favicon = null;
  }

  try {
    liveMetadata = await fetchLiveMetadataSnapshot({
      origin: activeSite.url || "",
    });
  } catch {
    liveMetadata = null;
  }

  const updatedAtISO = seo.updatedAtISO || vitals.updatedAtISO || null;
  const updatedAtLabel = updatedAtISO ? String(updatedAtISO).replace("T", " ").replace("Z", " UTC").slice(0, 19) : "—";

  function hrefWith(next: Partial<{ range: RangeKey; site: string }>) {
    const p = new URLSearchParams();
    p.set("module", "seo");
    p.set("projectId", projectId);
    p.set("range", next.range || range);
    const siteId = next.site || activeSite.id;
    if (siteId && siteId !== "none") p.set("siteId", siteId);
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  const posture = postureLabel(seo);

  const LIVE_TZ = "America/Los_Angeles";

  const pages = (seo.pages || []).slice(0, 28);
  const scoredPages = scoreSeoPages(seo.pages || []);
  const siteSeoScore = medianSeoScore(scoredPages);
  const topBadPages = worstPages(scoredPages, 8);

  const actions = generateSeoActions({
    seo,
    pages: seo.pages || [],
    scoredPages,
    vitals: {
      samples: vitals.samples ?? null,
      lcpP75Ms: vitals.lcpP75Ms ?? null,
      inpP75Ms: vitals.inpP75Ms ?? null,
      clsP75: vitals.clsP75 ?? null,
    },
    siteOrigin: activeSite.url || null,
    favicon,
  });

  // Attach computed insights to the SEO payload for future rendering/export, without changing UI structure.
  seo.actions = actions;
  seo.siteSeoScore = siteSeoScore;
  seo.topBadPages = topBadPages;
  seo.favicon = favicon;

  const covTitleTone = toneFromCoveragePct(seo.titleCoveragePct ?? null);
  const covDescTone = toneFromCoveragePct(seo.descriptionCoveragePct ?? null);
  const covCanonTone = toneFromCoveragePct(seo.canonicalCoveragePct ?? null);

  const noindexTone = toneFromIssuePct(seo.noindexPct ?? null);
  const nofollowTone = toneFromIssuePct(seo.nofollowPct ?? null);
  const missingH1Tone = toneFromIssuePct(seo.missingH1Pct ?? null);
  const multiH1Tone = toneFromIssuePct(seo.multipleH1Pct ?? null);
  const thinTone = toneFromIssuePct(seo.thinContentPct ?? null);

  const lcpVital = normalizeVitalMetric(vitals.lcpP75Ms);
  const inpVital = normalizeVitalMetric(vitals.inpP75Ms);
  const clsVital = normalizeVitalMetric(vitals.clsP75);
  const fcpVital = normalizeVitalMetric(vitals.fcpP75Ms);
  const ttfbVital = normalizeVitalMetric(vitals.ttfbP75Ms);

  const lcpTone = toneForLcp(lcpVital);
  const inpTone = toneForInp(inpVital);
  const clsTone = toneForCls(clsVital);
  const fcpTone = toneForFcp(fcpVital);
  const ttfbTone = toneForTtfb(ttfbVital);
  const metadataGapRows: Array<{ id: string; label: string; count: number }> = [
    { id: "missing_title", label: "Missing Titles", count: nOrNull(seo.missingTitleCount) ?? 0 },
    { id: "missing_description", label: "Missing Descriptions", count: nOrNull(seo.missingDescriptionCount) ?? 0 },
    { id: "missing_canonical", label: "Missing Canonicals", count: nOrNull(seo.missingCanonicalCount) ?? 0 },
  ];
  const metadataGapTotal = metadataGapRows.reduce((sum, row) => sum + row.count, 0);
  const representativePage =
    (seo.pages || []).find((page) => page.title || page.metaDescription || page.canonical || page.robots) || null;
  const representativeTitle =
    nonEmptyText(seo.sampleTitle) || nonEmptyText(representativePage?.title) || nonEmptyText(liveMetadata?.title) || null;
  const representativeDescription =
    nonEmptyText(seo.sampleDescription) ||
    nonEmptyText(representativePage?.metaDescription) ||
    nonEmptyText(liveMetadata?.description) ||
    null;
  const representativeCanonical =
    nonEmptyText(seo.sampleCanonical) ||
    nonEmptyText(representativePage?.canonical) ||
    nonEmptyText(liveMetadata?.canonical) ||
    nonEmptyText(liveMetadata?.pageUrl) ||
    null;
  const representativeRobots =
    nonEmptyText(seo.sampleRobots) || nonEmptyText(representativePage?.robots) || nonEmptyText(liveMetadata?.robots) || null;
  const hasLivePreviewData = Boolean(
    representativeTitle || representativeDescription || representativeCanonical || representativeRobots
  );
  const hasLivePreviewTitle = Boolean(representativeTitle);
  const previewTitleLabel = representativeTitle || `${activeSite.label} — Page Title`;
  const previewDescriptionLabel = representativeDescription || "No live meta description was detected for this route.";
  const sampleRobotsLabel = representativeRobots || "—";
  const previewUrlLabel = (() => {
    const raw = representativeCanonical || activeSite.url || "";
    if (!raw) return "—";
    try {
      const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`);
      const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
      return `${parsed.hostname}${path}`;
    } catch {
      return raw;
    }
  })();

  const faviconPayload = seo.favicon || null;
  const faviconIcons = faviconPayload?.icons || [];
  const faviconTopIssues = faviconPayload?.priorities?.topIssues || [];
  const faviconPrioritySummary = faviconPayload?.priorities || { p0: 0, p1: 0, p2: 0, topIssues: [] };
  const faviconIssueTotal = faviconPrioritySummary.p0 + faviconPrioritySummary.p1 + faviconPrioritySummary.p2;
  const faviconHasIcons = faviconIcons.length > 0;
  const faviconIssueCodes = new Set((faviconPayload?.issues || []).map((issue) => issue.code));
  const faviconIcoIcon = faviconIcons.find((icon) => /\/favicon\.ico(?:$|[?#])/i.test(icon.url)) || null;

  type FaviconHealthTone = "good" | "warn" | "bad" | "neutral";
  type FaviconChecklistState = "ready" | "warn" | "missing";

  const faviconIcoState: FaviconChecklistState =
    !faviconHasIcons
      ? "missing"
      : faviconIssueCodes.has("missing_favicon")
      ? "missing"
      : faviconIcoIcon?.status === "broken"
        ? "warn"
        : faviconIcoIcon
          ? "ready"
          : "warn";
  const favicon16State: FaviconChecklistState =
    !faviconHasIcons || faviconIssueCodes.has("missing_16x16") ? "missing" : "ready";
  const favicon32State: FaviconChecklistState =
    !faviconHasIcons || faviconIssueCodes.has("missing_32x32") ? "missing" : "ready";
  const faviconAppleState: FaviconChecklistState = faviconIssueCodes.has("missing_apple_touch_icon")
    ? "missing"
    : faviconIssueCodes.has("apple_touch_not_180")
      ? "warn"
      : faviconPayload?.hasAppleTouchIcon
        ? "ready"
        : "missing";
  const faviconManifestState: FaviconChecklistState = faviconPayload?.hasManifestIcon ? "ready" : "missing";

  const faviconChecklist: Array<{ id: string; label: string; detail: string; state: FaviconChecklistState }> = [
    {
      id: "favicon_ico",
      label: "/favicon.ico",
      detail: "Primary browser tab icon asset.",
      state: faviconIcoState,
    },
    {
      id: "favicon_16",
      label: "/favicon-16x16.png",
      detail: "Explicit 16x16 raster variant.",
      state: favicon16State,
    },
    {
      id: "favicon_32",
      label: "/favicon-32x32.png",
      detail: "Explicit 32x32 raster variant.",
      state: favicon32State,
    },
    {
      id: "apple_touch",
      label: "/apple-touch-icon.png",
      detail: "iOS touch icon (expected 180x180).",
      state: faviconAppleState,
    },
    {
      id: "manifest_icons",
      label: "/site.webmanifest",
      detail: "Install icon set with 192x192 and 512x512 variants.",
      state: faviconManifestState,
    },
  ];
  const faviconChecklistReadyCount = faviconChecklist.reduce(
    (count, item) => count + (item.state === "ready" ? 1 : 0),
    0
  );
  const faviconHealthTone: FaviconHealthTone =
    !faviconHasIcons
      ? "neutral"
      : faviconPrioritySummary.p0 > 0
        ? "bad"
        : faviconPrioritySummary.p1 > 0
          ? "warn"
          : faviconIssueTotal > 0
            ? "warn"
            : "good";
  const faviconHealthLabel = !faviconHasIcons
    ? "No icon set detected"
    : faviconPrioritySummary.p0 > 0
      ? "Critical fixes required"
      : faviconPrioritySummary.p1 > 0
        ? "Attention required"
        : faviconIssueTotal > 0
          ? "Minor cleanups available"
          : "Healthy icon set";
  const faviconHealthSummary = !faviconHasIcons
    ? "Publish the baseline icon set to support tabs, touch surfaces, and manifest installs."
    : faviconIssueTotal > 0
      ? `${fmtInt(faviconIssueTotal)} issue${faviconIssueTotal === 1 ? "" : "s"} across all priority levels.`
      : "Core favicon coverage is complete across detected surfaces.";
  const faviconHasIssues = faviconIssueTotal > 0;
  const faviconHealthLineMode = faviconHasIssues ? "bad" : "good";
  const faviconHealthLineSummary = faviconHasIssues
    ? `${fmtInt(faviconIssueTotal)} issue${faviconIssueTotal === 1 ? "" : "s"} detected.`
    : "No favicon issues detected.";
  const faviconHealthLinePath = faviconHasIssues
    ? "M2 10 L12 10 L18 6 L23 17 L29 4 L36 18 L43 7 L50 16 L57 5 L64 17 L72 8 L79 15 L88 9 L96 14 L106 12"
    : "M2 12 L16 12 L22 8 L27 16 L34 6 L42 14 L58 14 L66 10 L72 12 L86 12 L92 9 L98 12 L106 12";
  const faviconPreviewFromPrimary =
    String(faviconPayload?.primary?.tabIconUrl || "").trim() ||
    String(faviconPayload?.primary?.appleTouchUrl || "").trim() ||
    String(faviconPayload?.primary?.manifestIconUrl || "").trim() ||
    "";
  const rankedFaviconIcons = faviconIcons
    .slice()
    .sort((a, b) => {
      const score = (icon: (typeof faviconIcons)[number]) => {
        let out = 0;
        if (icon.status === "ok") out += 200;
        else if (icon.status === "warn") out += 80;
        if (icon.primaryKinds.includes("tab")) out += 120;
        if (icon.primaryKinds.includes("apple-touch")) out += 90;
        if (icon.primaryKinds.includes("manifest")) out += 70;
        const sizeHint = icon.actualWidth && icon.actualHeight ? Math.min(icon.actualWidth, icon.actualHeight) : 0;
        out += Math.min(128, sizeHint);
        if (icon.format === "svg") out += 40;
        return out;
      };
      return score(b) - score(a);
    });
  const faviconPreviewFallbackUrl =
    rankedFaviconIcons.find((icon) => icon.status !== "broken")?.url ||
    rankedFaviconIcons[0]?.url ||
    "";
  const faviconPreviewUrl = faviconPreviewFromPrimary || faviconPreviewFallbackUrl || "";

  return (
    <AppShell title="Workspace" subtitle="Workspace command center">
      <div className="err-page">
        <div className="cb-console">
         
          {/* HEADER */}
          <header className="seo-head">
            <div className="seo-head-left">
              <div className="seo-titleblock">
                <h1 className="seo-h1">SEO Intelligence</h1>
                <p className="seo-sub">Search posture, indexability, page metadata coverage, and vitals.</p>
              </div>
              <div className="seo-meta">
                <span className="seo-chip seo-chip-strong" title={activeSite.url || ""}>
                  Target: <b>{activeSite.label}</b>
                </span>
                <span className="seo-chip">
                  Updated: <b>{updatedAtLabel}</b>
                </span>
                <span className={`seo-chip tone-${posture.tone}`}>
                  Posture: <b>{posture.label}</b>
                </span>
              </div>
            </div>

            <div className="seo-head-right" aria-label="Controls">
              <label className="seo-range" aria-label="Timeline">
                <span className="seo-range-label">Timeline</span>
                <select className="seo-range-select" defaultValue={range} data-range-select data-default-site={activeSite.id}>
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
<br /><br /><br /><br />
          {/* HERO METRICS */}
          <section className="seo-grid" aria-label="SEO rollups">
            <article className={`cb-card tone-${posture.tone}`}>
              <div className="cb-card-top">
                <div className="cb-card-label">Pages Observed</div>
                <div className="cb-card-metric">{fmtInt(seo.pagesObserved)}</div>
              </div><br />
              <div className="cb-card-sub">Pages inspected for metadata, structure, and indexability signals.</div>
            </article>

            <article className={`cb-card tone-${covTitleTone}`}>
              <div className="cb-card-top">
                <div className="cb-card-label">Title Coverage</div>
                <div className="cb-card-metric">{fmtPct(seo.titleCoveragePct)}</div>
              </div><br />
              <div className="cb-card-sub">Percent of observed pages with a non-empty &lt;title&gt;.</div>
            </article>

            <article className={`cb-card tone-${covDescTone}`}>
              <div className="cb-card-top">
                <div className="cb-card-label">Description Coverage</div>
                <div className="cb-card-metric">{fmtPct(seo.descriptionCoveragePct)}</div>
              </div><br />
              <div className="cb-card-sub">Percent of observed pages with a meta description.</div>
            </article>

            <article className={`cb-card tone-${covCanonTone}`}>
              <div className="cb-card-top">
                <div className="cb-card-label">Canonical Coverage</div>
                <div className="cb-card-metric">{fmtPct(seo.canonicalCoveragePct)}</div>
              </div><br />
              <div className="cb-card-sub">Percent of observed pages with a canonical URL.</div>
            </article>
          </section>
<br />
          {/* INDEXABILITY + STRUCTURE */}
          <section className="seo-split" aria-label="Indexability and structure">
            <article className="cb-card cb-card-pad seo-mini-section">
              <div className="cb-card-head">
                <div>
                  <h2 className="cb-h2">Indexability</h2>
                  <p className="cb-sub">Robots posture across observed pages.</p>
                </div>
              </div>
              <div className="seo-mini-grid">
                <div className={`seo-mini tone-${noindexTone}`}>
                  <div className="seo-mini-k">NoIndex</div>
                  <div className="seo-mini-v">{fmtPct(seo.noindexPct)}</div>
                  <div className="seo-mini-sub">{fmtInt(seo.noindexCount)} pages flagged</div>
                </div>

                <div className={`seo-mini tone-${nofollowTone}`}>
                  <div className="seo-mini-k">NoFollow</div>
                  <div className="seo-mini-v">{fmtPct(seo.nofollowPct)}</div>
                  <div className="seo-mini-sub">{fmtInt(seo.nofollowCount)} pages flagged</div>
                </div>

                <div className="seo-mini">
                  <div className="seo-mini-k">Sample Robots</div>
                  <div className="seo-mini-v mono">{sampleRobotsLabel}</div>
                  <div className="seo-mini-sub">Representative robots meta snapshot.</div>
                </div>
              </div>
            </article>

            <article className="cb-card cb-card-pad seo-mini-section">
              <div className="cb-card-head">
                <div>
                  <h2 className="cb-h2">Structure</h2>
                  <p className="cb-sub">Heading integrity and content density.</p>
                </div>
              </div>
              <div className="seo-mini-grid">
                <div className={`seo-mini tone-${missingH1Tone}`}>
                  <div className="seo-mini-k">Missing H1</div>
                  <div className="seo-mini-v">{fmtPct(seo.missingH1Pct)}</div>
                  <div className="seo-mini-sub">{fmtInt(seo.missingH1Count)} pages affected</div>
                </div>

                <div className={`seo-mini tone-${multiH1Tone}`}>
                  <div className="seo-mini-k">Multiple H1</div>
                  <div className="seo-mini-v">{fmtPct(seo.multipleH1Pct)}</div>
                  <div className="seo-mini-sub">{fmtInt(seo.multipleH1Count)} pages affected</div>
                </div>

                <div className={`seo-mini tone-${thinTone}`}>
                  <div className="seo-mini-k">Thin Content</div>
                  <div className="seo-mini-v">{fmtPct(seo.thinContentPct)}</div>
                  <div className="seo-mini-sub">{fmtInt(seo.thinContentCount)} pages affected</div>
                </div>
              </div>
            </article>
          </section>
<br /><br />
          {/* WEB VITALS */}
          <section className="cb-card cb-card-pad seo-vitals-card" aria-label="Web Vitals">
            <div className="cb-card-head">
              <div>
                <h2 className="cb-h2">Web Vitals</h2>
                <p className="cb-sub">P75 vitals (when available) for the selected target and range.</p>
              </div>
            </div>
            <div className="seo-vitals">
              <div className={`seo-vital tone-${lcpTone}`}>
                <div className="seo-vital-k">LCP (P75)</div>
                <div className={`seo-vital-v${lcpVital == null ? " is-empty" : ""}`}>{fmtVitalMs(lcpVital)}</div>
                <div className="seo-vital-sub">Largest Contentful Paint</div>
              </div>

              <div className={`seo-vital tone-${inpTone}`}>
                <div className="seo-vital-k">INP (P75)</div>
                <div className={`seo-vital-v${inpVital == null ? " is-empty" : ""}`}>{fmtVitalMs(inpVital)}</div>
                <div className="seo-vital-sub">Interaction to Next Paint</div>
              </div>

              <div className={`seo-vital tone-${clsTone}`}>
                <div className="seo-vital-k">CLS (P75)</div>
                <div className={`seo-vital-v${clsVital == null ? " is-empty" : ""}`}>{fmtVitalCls(clsVital)}</div>
                <div className="seo-vital-sub">Cumulative Layout Shift</div>
              </div>

              <div className={`seo-vital tone-${fcpTone}`}>
                <div className="seo-vital-k">FCP (P75)</div>
                <div className={`seo-vital-v${fcpVital == null ? " is-empty" : ""}`}>{fmtVitalMs(fcpVital)}</div>
                <div className="seo-vital-sub">First Contentful Paint</div>
              </div>

              <div className={`seo-vital tone-${ttfbTone}`}>
                <div className="seo-vital-k">TTFB (P75)</div>
                <div className={`seo-vital-v${ttfbVital == null ? " is-empty" : ""}`}>{fmtVitalMs(ttfbVital)}</div>
                <div className="seo-vital-sub">Time to First Byte</div>
              </div>
            </div>
          </section>
<br />
          {/* SAMPLES */}
          <section className="seo-samples" aria-label="Samples">
            <article className="cb-card cb-card-pad seo-metadata-card">
              <div className="cb-card-head">
                <div>
                  <h2 className="cb-h2">Representative Metadata</h2>
                  <p className="cb-sub">Sample values help validate collection and formatting.</p>
                </div>
              </div>
<br />
              <div className="seo-metadata-shell">
                <section className="seo-metadata-panel" aria-label="Captured metadata">
                  <div className="seo-metadata-kicker">Captured Metadata</div>
                  <dl className="seo-metadata-list">
                    <div className={`seo-metadata-row ${representativeTitle ? "is-present" : "is-missing"}`}>
                      <dt>Title</dt>
                      <dd className="mono">{representativeTitle || "—"}</dd>
                    </div>
                    <div className={`seo-metadata-row ${representativeDescription ? "is-present" : "is-missing"}`}>
                      <dt>Description</dt>
                      <dd className="mono">{representativeDescription || "—"}</dd>
                    </div>
                    <div className={`seo-metadata-row ${representativeCanonical ? "is-present" : "is-missing"}`}>
                      <dt>Canonical</dt>
                      <dd className="mono">{representativeCanonical || "—"}</dd>
                    </div>
                    <div className={`seo-metadata-row ${representativeRobots ? "is-present" : "is-missing"}`}>
                      <dt>Robots</dt>
                      <dd className="mono">{sampleRobotsLabel}</dd>
                    </div>
                  </dl>
                </section>

                <section className="seo-serp-card" role="note" aria-label="Search snippet preview">
                  <div className="seo-serp-card-top">
                    <div className="seo-serp-card-state">{hasLivePreviewData ? "Live data" : "No live metadata found"}</div>
                  </div>
                  <div className={`seo-serp-card-body${hasLivePreviewData ? "" : " is-awaiting"}`}>
                    <div className={`seo-serp-card-title${hasLivePreviewTitle ? "" : " is-placeholder"}`}>{previewTitleLabel}</div>
                    <div className="seo-serp-card-url mono">{previewUrlLabel}</div>
                    <div className="seo-serp-card-desc">{previewDescriptionLabel}</div>
                  </div>
                  <div className="seo-serp-card-foot mono">
                    <span>Robots</span>
                    <strong>{sampleRobotsLabel}</strong>
                  </div>
                </section>
              </div>
            </article>

            <article className="cb-card cb-card-pad seo-volumes">
              <div className="cb-card-head">
                <div>
                  <h2 className="cb-h2">Coverage Volumes</h2>
                  <p className="cb-sub">Metadata gaps across observed pages.</p>
                </div>
              </div>
<br />
              <div className="seo-coverage" aria-label="Metadata coverage summary">
                <div className="seo-coverage-summary" role="status" aria-live="polite">
                  <div className="seo-coverage-total-v">{fmtInt(metadataGapTotal)}</div>
                  <div className="seo-coverage-total-copy">
                    <div className="seo-coverage-total-k">Total missing metadata fields</div>
                    <div className="seo-coverage-total-sub">
                      Across title, description, and canonical checks for this target.
                    </div>
                  </div>
                </div>

                <dl className="seo-coverage-list">
                  {metadataGapRows.map((row) => (
                    <div key={row.id} className={`seo-coverage-row ${row.count > 0 ? "has-gap" : "is-clean"}`}>
                      <dt className="seo-coverage-k">{row.label}</dt>
                      <dd className="seo-coverage-v">{fmtInt(row.count)}</dd>
                    </div>
                  ))}
                </dl>

                <div className="seo-coverage-footnote">
                  Counts reflect observed pages for this site.
                </div>
              </div>
            </article>
          </section>
          {/* FAVICONS */}
          <section className="cb-card cb-card-pad seo-favicon-card" aria-label="Favicons">
            <div className="cb-card-head seo-favicon-head">
              <div>
                <h2 className="cb-h2">Favicons</h2>
                <p className="cb-sub">Real icon assets discovered from head links, manifest, and fallback endpoints.</p>
              </div>
              <div className={`seo-favicon-health tone-${faviconHealthTone}`} role="status" aria-live="polite">
                <div className="seo-favicon-health-k">Health</div>
                <div className="seo-favicon-health-v">{faviconHealthLabel}</div>
                <div className="seo-favicon-health-sub">{faviconHealthSummary}</div>
              </div>
            </div>

            <div className="seo-favicon-metrics" role="list" aria-label="Favicon summary">
              <article className="seo-favicon-metric seo-favicon-metric-preview tone-neutral" role="listitem">
                <div className="seo-favicon-metric-k">Primary icon</div>
                {faviconPreviewUrl ? (
                  <div className="seo-favicon-previewLargeWrap" aria-label="Primary favicon preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="seo-favicon-previewLarge"
                      src={faviconPreviewUrl}
                      alt=""
                      width={64}
                      height={64}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ) : (
                  <div className="seo-favicon-previewLargeEmpty" aria-hidden="true">
                    —
                  </div>
                )}
              </article>
              <article className="seo-favicon-metric tone-neutral" role="listitem">
                <div className="seo-favicon-metric-k">Detected</div>
                <div className="seo-favicon-metric-v">{fmtInt(faviconIcons.length)}</div>
              </article>
              <article className="seo-favicon-metric tone-p0" role="listitem">
                <div className="seo-favicon-metric-k">P0</div>
                <div className="seo-favicon-metric-v">{fmtInt(faviconPrioritySummary.p0)}</div>
              </article>
              <article className="seo-favicon-metric tone-p1" role="listitem">
                <div className="seo-favicon-metric-k">P1</div>
                <div className="seo-favicon-metric-v">{fmtInt(faviconPrioritySummary.p1)}</div>
              </article>
              <article className="seo-favicon-metric tone-p2" role="listitem">
                <div className="seo-favicon-metric-k">P2</div>
                <div className="seo-favicon-metric-v">{fmtInt(faviconPrioritySummary.p2)}</div>
              </article>
            </div>

            <div className={`seo-favicon-state is-${faviconHealthLineMode}`} role="status" aria-live="polite">
              <div className="seo-favicon-state-copyBlock">
                <div className="seo-favicon-state-copy">{faviconHealthLineSummary}</div>
              </div>
              <span className={`seo-favicon-healthline is-${faviconHealthLineMode}`} aria-hidden="true">
                <svg viewBox="0 0 108 20" focusable="false" aria-hidden="true">
                  <path className="seo-favicon-healthline-base" d={faviconHealthLinePath} />
                  <path className="seo-favicon-healthline-trace" d={faviconHealthLinePath} />
                </svg>
              </span>
            </div>

            {faviconTopIssues.length ? (
              <div className="seo-favicon-issues" role="list" aria-label="Top favicon issues">
                {faviconTopIssues.map((issue, idx) => (
                  <article key={`${issue.code}-${idx}`} className="seo-favicon-issue" role="listitem">
                    <div className="seo-favicon-issue-top">
                      <span className={`seo-favicon-priority tone-${issue.priority.toLowerCase()}`}>{issue.priority}</span>
                      <div className="seo-favicon-issue-title">{issue.title}</div>
                    </div>
                    <div className="seo-favicon-issue-detail">{issue.detail}</div>
                  </article>
                ))}
              </div>
            ) : null}

            <div className="seo-favicon-checkshell">
              <div className="seo-favicon-checkhead">
                <div className="seo-favicon-checktitle">Baseline icon set</div>
                <div className="seo-favicon-checkcount">
                  {fmtInt(faviconChecklistReadyCount)}/{fmtInt(faviconChecklist.length)} ready
                </div>
              </div>
              <div className="seo-favicon-checklist" role="list" aria-label="Expected favicon set">
                {faviconChecklist.map((item) => (
                  <article key={item.id} className={`seo-favicon-check is-${item.state}`} role="listitem">
                    <div className="seo-favicon-check-top">
                      <span className="seo-favicon-check-label mono">{item.label}</span>
                      <span className={`seo-favicon-check-state is-${item.state}`}>
                        {item.state === "ready" ? "Ready" : item.state === "warn" ? "Review" : "Missing"}
                      </span>
                    </div>
                    <div className="seo-favicon-check-detail">{item.detail}</div>
                  </article>
                ))}
              </div>
            </div>

            {faviconIcons.length ? (
              <div className="seo-favicon-grid" role="list" aria-label="Favicon inventory">
                {faviconIcons.map((icon, idx) => (
                  <article key={`${icon.url}-${idx}`} className="seo-favicon-item" role="listitem">
                    <div className="seo-favicon-item-head">
                      <div className="seo-favicon-preview-shell" aria-hidden="true">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="seo-favicon-preview"
                          src={icon.url}
                          alt=""
                          width={26}
                          height={26}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div className="seo-favicon-item-copy">
                        <div className="seo-favicon-item-url mono" title={icon.url}>
                          {toHostPath(icon.url)}
                        </div>
                        <div className="seo-favicon-item-source">{faviconSourceLabel(icon.source)}</div>
                      </div>
                      <span
                        className={`seo-favicon-item-status ${
                          icon.status === "ok" ? "tone-good" : icon.status === "broken" ? "tone-bad" : "tone-warn"
                        }`}
                      >
                        {icon.status}
                      </span>
                    </div>

                    <dl className="seo-favicon-specs">
                      <div className="seo-favicon-spec">
                        <dt>Size</dt>
                        <dd className="mono">{faviconSizeLabel(icon)}</dd>
                      </div>
                      <div className="seo-favicon-spec">
                        <dt>Type</dt>
                        <dd className="mono">{icon.format.toUpperCase()}</dd>
                      </div>
                      <div className="seo-favicon-spec">
                        <dt>Bytes</dt>
                        <dd className="mono">{faviconBytesLabel(icon.bytes)}</dd>
                      </div>
                      <div className="seo-favicon-spec">
                        <dt>Fetch</dt>
                        <dd className="mono">{icon.fetchStatus > 0 ? icon.fetchStatus : "—"}</dd>
                      </div>
                    </dl>

                    <div className="seo-favicon-tags">
                      <div className="seo-favicon-tagblock">
                        <div className="seo-favicon-tagk">Primary usage</div>
                        <div className="seo-chips">
                          {icon.primaryKinds.length ? (
                            icon.primaryKinds.map((kind) => (
                              <span key={kind} className="seo-chip-mini">
                                {faviconPrimaryLabel(kind)}
                              </span>
                            ))
                          ) : (
                            <span className="seo-chip-mini">—</span>
                          )}
                        </div>
                      </div>
                      <div className="seo-favicon-tagblock">
                        <div className="seo-favicon-tagk">Signals</div>
                        <div className="seo-chips">
                          {icon.warningCodes.length ? (
                            icon.warningCodes.slice(0, 3).map((warningCode) => (
                              <span key={warningCode} className="seo-chip-mini">
                                {faviconIssueLabel(warningCode)}
                              </span>
                            ))
                          ) : (
                            <span className="seo-chip-mini tone-good">Clean</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>

          {/* PAGE AUDITS */}
          <section className="cb-card cb-card-pad" aria-label="Page audits">
            <div className="cb-card-head seo-headrow">
              <div>
                <h2 className="cb-h2">Page Audits</h2>
                <p className="cb-sub">Most recent inspected pages with visible issues and metadata state.</p>
              </div>
              <div className="seo-pillrow">
                <span className="seo-pill">
                  Showing: <b>{fmtInt(pages.length)}</b>
                </span>
              </div>
            </div>
<br /><br />
            {pages.length ? (
              <div className="seo-tablewrap">
                <table className="seo-table" aria-label="SEO page audits table">
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th>Title</th>
                      <th>Description</th>
                      <th>Canonical</th>
                      <th className="t-right">H1</th>
                      <th className="t-right">Words</th>
                      <th>Signals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map((p, i) => {
                      const sigs = issueChips(p);
                      return (
                        <tr key={`${p.urlPath || "p"}-${i}`}>
                          <td className="mono">{p.urlPath || "—"}</td>
                          <td className="mono">{p.title ? p.title.slice(0, 72) : "—"}</td>
                          <td className="mono">{p.metaDescription ? p.metaDescription.slice(0, 72) : "—"}</td>
                          <td className="mono">{p.canonical ? p.canonical.slice(0, 72) : "—"}</td>
                          <td className="t-right">{fmtInt(p.h1Count)}</td>
                          <td className="t-right">{fmtInt(p.wordCount)}</td>
                          <td>
                            <div className="seo-chips">
                              {sigs.length ? (
                                sigs.map((s, idx) => (
                                  <span key={idx} className="seo-chip-mini">
                                    {s}
                                  </span>
                                ))
                              ) : (
                                <span className="seo-chip-mini tone-good">Clean</span>
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
              <div className="seo-empty">
                <div className="seo-empty-title">No page rows available yet.</div>
                <div className="seo-empty-sub">
                  Once CavBot is ingesting page snapshots, this table will populate with real inspected pages.
                </div>
              </div>
            )}
          </section>

          <br /><br />

          <CavAiRouteRecommendations
            panelId="seo"
            snapshot={summary}
            origin={activeSite.url || ""}
            pagesScanned={seo.pagesObserved ?? scoredPages.length ?? 1}
            title="CavBot SEO Priorities"
            subtitle="Deterministic schema, metadata, and trust-signal priorities for this target."
            pillars={["seo", "ux", "engagement", "reliability"]}
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
          <Script id="cb-seo-live-time" strategy="afterInteractive">
            {`
(function(){
  try{
    if(window.__cbSeoLiveTimeInt) clearInterval(window.__cbSeoLiveTimeInt);
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
  window.__cbSeoLiveTimeInt = setInterval(tick, 10000);
})();`}
          </Script>

          {/* Tools wiring (guarded) */}
          <Script id="cb-seo-tools-wire" strategy="afterInteractive">
            {`
(function(){
  var modal = document.querySelector("[data-tools-modal]");
  var openBtn = document.querySelector("[data-tools-open]");
  var closeEls = document.querySelectorAll("[data-tools-close]");
  var siteSel = document.querySelector("[data-tools-site]");
  var applyBtn = document.querySelector("[data-tools-apply]");
  var reportLink = document.querySelector("[data-tools-report]");

  function lockBody(on){
    try{ document.body.classList.toggle("cb-modal-open", !!on); }catch(e){}
  }

  // Ensure first load never starts with the modal visible (SPA nav + CSS-reset safe).
  try{
    if(modal) modal.hidden = true;
    lockBody(false);
    if(openBtn) openBtn.setAttribute("aria-expanded","false");
  }catch(e){}

  function syncReportLink(){
    if(!reportLink) return;
    try{
      var p = new URLSearchParams(window.location.search || "");
      var range = p.get("range") || "24h";
      var site = (siteSel && siteSel.value) ? siteSel.value : (p.get("site") || "none");
      var projectId = ${JSON.stringify(projectId)};

      var next = new URLSearchParams();
      next.set("module", "seo");
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

  // Rewire-safe: Next.js client navigation can re-render this page without a full reload.
  // Avoid a global "wired once" flag; instead wire per-element, and keep one ESC handler.
  try{
    if(openBtn && openBtn.dataset.cbWired !== "1"){
      openBtn.dataset.cbWired = "1";
      openBtn.addEventListener("click", open);
    }
    closeEls.forEach(function(el){
      if(el && el.dataset && el.dataset.cbWired === "1") return;
      try{ if(el && el.dataset) el.dataset.cbWired = "1"; }catch(e){}
      el.addEventListener("click", close);
    });
    if(window.__cbSeoToolsEscHandler){
      document.removeEventListener("keydown", window.__cbSeoToolsEscHandler);
    }
    window.__cbSeoToolsEscHandler = function(e){ try{ if(e.key === "Escape") close(); }catch(_e){} };
    document.addEventListener("keydown", window.__cbSeoToolsEscHandler);
  }catch(e){}

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

  // Console-style timeline dropdown: keep SEO param keys unchanged.
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
        </div>
      </div>
    </AppShell>
  );
}
