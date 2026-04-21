import { NextResponse } from "next/server";

import { gateModuleAccess } from "@/lib/moduleGate.server";
import { readWorkspace } from "@/lib/workspaceStore.server";
import { getTenantProjectSummary } from "@/lib/projectSummary.server";
import {
  generateSeoActions,
  medianSeoScore,
  scoreSeoPages,
  worstPages,
  type SeoActionItem,
} from "@/lib/seo/seoInsights";
import { buildFaviconIntelligence } from "@/lib/seo/faviconIntelligence";

// Keep the API stable and safe:
// - SEO remains Premium-locked via gateModuleAccess("seo")
// - projectId in query is treated as a hint only; we use workspace-scoped projectId to prevent leakage.
// - SEO rollups derive from ingested summary/snapshots; favicon intelligence is computed server-side from the active origin.

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
function nOrNull(x: unknown) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

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
};

type SeoPayload = {
  updatedAtISO?: string | null;
  pagesObserved?: number | null;
  titleCoveragePct?: number | null;
  descriptionCoveragePct?: number | null;
  canonicalCoveragePct?: number | null;
  noindexPct?: number | null;
  nofollowPct?: number | null;
  missingH1Pct?: number | null;
  multipleH1Pct?: number | null;
  thinContentPct?: number | null;
  noindexCount?: number | null;
  nofollowCount?: number | null;
  missingTitleCount?: number | null;
  missingDescriptionCount?: number | null;
  missingCanonicalCount?: number | null;
  missingH1Count?: number | null;
  multipleH1Count?: number | null;
  thinContentCount?: number | null;
  sampleTitle?: string | null;
  sampleDescription?: string | null;
  sampleCanonical?: string | null;
  sampleRobots?: string | null;
  pages?: SeoPageRow[];
};

type VitalsPayload = {
  updatedAtISO?: string | null;
  samples?: number | null;
  lcpP75Ms?: number | null;
  inpP75Ms?: number | null;
  clsP75?: number | null;
  fcpP75Ms?: number | null;
  ttfbP75Ms?: number | null;
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

  const rollup = firstRecord(s?.rollup, s?.summary, s?.totals, s?.counts, s);

  const pagesRaw = firstArray(s?.pages, s?.pageRows, s?.rows, s?.inspectedPages, rollup?.pages);

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
            };
          })
          .filter((p): p is SeoPageRow => Boolean(p && p.urlPath))
          .slice(0, 80)
      : [];

  const metaRecord = asRecord(summaryRecord?.meta);
  const updatedAtISO =
    (s?.updatedAtISO as unknown) ||
    (s?.updatedAt as unknown) ||
    (rollup?.updatedAtISO as unknown) ||
    firstString(summaryRecord, "updatedAtISO") ||
    firstString(metaRecord, "updatedAtISO") ||
    null;

  return {
    updatedAtISO: updatedAtISO ? String(updatedAtISO) : null,
    pagesObserved: nOrNull(rollup?.pagesObserved ?? rollup?.pages_observed ?? rollup?.pages ?? rollup?.inspectedPages),
    titleCoveragePct: nOrNull(rollup?.titleCoveragePct ?? rollup?.title_coverage_pct ?? rollup?.titleCoverage),
    descriptionCoveragePct: nOrNull(rollup?.descriptionCoveragePct ?? rollup?.description_coverage_pct ?? rollup?.metaDescriptionCoveragePct),
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
      rollup?.sampleCanonical != null ? String(rollup.sampleCanonical) : s?.sampleCanonical != null ? String(s.sampleCanonical) : null,
    sampleRobots: rollup?.sampleRobots != null ? String(rollup.sampleRobots) : s?.sampleRobots != null ? String(s.sampleRobots) : null,
    pages,
  };
}

function normalizeVitalsFromSummary(summary: unknown): VitalsPayload {
  const summaryRecord = asRecord(summary);
  const performanceRecord = firstRecord(summaryRecord?.performance);
  const guardianRecord = firstRecord(summaryRecord?.guardian);
  const diagnosticsRecord = firstRecord(summaryRecord?.diagnostics);

  const v = firstRecord(
    summaryRecord?.webVitals,
    summaryRecord?.vitals,
    performanceRecord?.vitals,
    performanceRecord?.webVitals,
    guardianRecord?.vitals,
    diagnosticsRecord?.vitals,
    null
  );

  const r = firstRecord(v?.rollup, v?.summary, v?.p75, v) ?? null;

  const updatedAtISO =
    v?.updatedAtISO != null
      ? String(v.updatedAtISO)
      : v?.updatedAt != null
      ? String(v.updatedAt)
      : firstString(summaryRecord, "updatedAtISO");

  return {
    updatedAtISO: updatedAtISO || null,
    samples: nOrNull(r?.samples ?? r?.n ?? r?.observations ?? r?.pagesObserved),
    lcpP75Ms: nOrNull(r?.lcpP75Ms ?? r?.lcp_p75_ms ?? r?.lcpP75 ?? r?.lcpMs),
    inpP75Ms: nOrNull(r?.inpP75Ms ?? r?.inp_p75_ms ?? r?.inpP75 ?? r?.inpMs),
    clsP75: nOrNull(r?.clsP75 ?? r?.cls_p75 ?? r?.cls),
    fcpP75Ms: nOrNull(r?.fcpP75Ms ?? r?.fcp_p75_ms ?? r?.fcpP75 ?? r?.fcpMs),
    ttfbP75Ms: nOrNull(r?.ttfbP75Ms ?? r?.ttfb_p75_ms ?? r?.ttfbP75 ?? r?.ttfbMs),
  };
}

export async function GET(req: Request) {
  const gate = await gateModuleAccess(req, "seo");
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "PREMIUM_REQUIRED", message: "SEO Intelligence is Premium." },
      { status: 402 }
    );
  }

  const url = new URL(req.url);
  const range = asRangeKey(url.searchParams.get("range"));
  const siteId = (url.searchParams.get("site") || "").trim();
  const projectIdHint = (url.searchParams.get("projectId") || "").trim();

  // Workspace-scoped projectId is the source of truth for multi-tenant safety.
  const ws = await readWorkspace();
  const projectId = String(ws?.projectId || "1");

  const sites = (ws?.sites || []).map((s) => ({
    id: String(s.id || ""),
    label: String(s.label || "").trim() || "Site",
    url: String(s.origin || "").trim(),
  }));

  const activeSite =
    (siteId && sites.find((s) => s.id === siteId)) ||
    (ws?.activeSiteId ? sites.find((s) => s.id === String(ws.activeSiteId)) : null) ||
    sites[0] ||
    { id: "none", label: "No site selected", url: "" };

  let summary: unknown = null;
  let seo: SeoPayload = {};
  let vitals: VitalsPayload = {};
  let favicon = null as Awaited<ReturnType<typeof buildFaviconIntelligence>> | null;

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

  const pages: SeoPageRow[] = Array.isArray(seo?.pages) ? (seo.pages as SeoPageRow[]) : [];
  const scoredPages = scoreSeoPages(pages);
  const siteSeoScore = medianSeoScore(scoredPages);
  const topBadPages = worstPages(scoredPages, 8);

  const actions: SeoActionItem[] = generateSeoActions({
    seo,
    pages,
    scoredPages,
    vitals: {
      samples: vitals?.samples ?? null,
      lcpP75Ms: vitals?.lcpP75Ms ?? null,
      inpP75Ms: vitals?.inpP75Ms ?? null,
      clsP75: vitals?.clsP75 ?? null,
    },
    siteOrigin: activeSite.url || null,
    favicon,
  });

  const updatedAtISO = seo?.updatedAtISO || vitals?.updatedAtISO || null;

  const payload = {
    ok: true,
    projectId,
    projectIdHint: projectIdHint || null,
    site: { id: activeSite.id, label: activeSite.label, origin: activeSite.url || null },
    range,
    updatedAtISO,
    seoRollup: seo,
    vitals,
    favicon,
    insights: {
      siteSeoScore,
      actions,
      topBadPages,
    },
  };

  // Ensure response is never cached across tenants.
  const res = NextResponse.json(payload, { status: 200 });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
