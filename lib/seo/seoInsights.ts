import {
  faviconIssueScopeLabel,
  faviconIssueToSeoAction,
  type FaviconIntelligenceResult,
} from "@/lib/seo/faviconIntelligence";

export type SeoActionSeverity = "critical" | "high" | "medium" | "low";
export type SeoActionImpact = "high" | "medium" | "low";
export type SeoActionConfidence = "observed" | "inferred";

export type SeoActionScope = {
  affectedPagesCount: number | null;
  affectedPct: number | null; // 0..100
};

export type SeoActionItem = {
  id: string;
  severity: SeoActionSeverity;
  impact: SeoActionImpact;
  title: string;
  whyItMatters: string;
  howToFix: string[]; // 3-6 bullets
  scope: SeoActionScope;
  examples: string[]; // up to 5 urlPath values
  confidence: SeoActionConfidence;
};

export type SeoVitalsSnapshot = {
  samples?: number | null;
  lcpP75Ms?: number | null;
  inpP75Ms?: number | null;
  clsP75?: number | null;
};

export type SeoPageRow = {
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
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: string | null;
  jsonLdCount?: number | null;
  schemaTypes?: string[] | null;
  htmlLang?: string | null;
};

export type SeoRollup = {
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
};

export type SeoHealthReason =
  | "missing_title"
  | "missing_description"
  | "missing_canonical"
  | "noindex"
  | "missing_h1"
  | "multiple_h1"
  | "thin_content";

export type SeoPageScore = {
  score: number; // 0..100
  reasons: SeoHealthReason[];
};

export type ScoredSeoPageRow = SeoPageRow & {
  seoScore: number;
  seoReasons: SeoHealthReason[];
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function normalizePathLike(p: string) {
  // Keep it conservative: we're only comparing urlPath vs canonical pathname.
  const s = String(p || "").trim();
  if (!s) return "";
  return s.endsWith("/") && s.length > 1 ? s.slice(0, -1) : s;
}

function parseRobotsMeta(robots: string | null): { noindex: boolean; nofollow: boolean } {
  const raw = String(robots || "").toLowerCase();
  if (!raw) return { noindex: false, nofollow: false };
  return {
    noindex: raw.split(/[,\\s]+/).includes("noindex"),
    nofollow: raw.split(/[,\\s]+/).includes("nofollow"),
  };
}

export function computeSeoPageScore(row: SeoPageRow): SeoPageScore {
  let score = 100;
  const reasons: SeoHealthReason[] = [];

  if (!isNonEmptyString(row.title)) {
    score -= 25;
    reasons.push("missing_title");
  }
  if (!isNonEmptyString(row.metaDescription)) {
    score -= 15;
    reasons.push("missing_description");
  }
  if (!isNonEmptyString(row.canonical)) {
    score -= 12;
    reasons.push("missing_canonical");
  }

  // Indexability: prioritize explicit fields; fall back to robots string only when explicit is absent.
  const robots = parseRobotsMeta(row.robots);
  const noindex = row.noindex === true || (row.noindex == null && robots.noindex);
  if (noindex) {
    score -= 30;
    reasons.push("noindex");
  }

  if ((row.h1Count ?? 0) === 0) {
    score -= 12;
    reasons.push("missing_h1");
  }
  if ((row.h1Count ?? 0) > 1) {
    score -= 8;
    reasons.push("multiple_h1");
  }
  if ((row.wordCount ?? 0) > 0 && (row.wordCount ?? 0) < 200) {
    score -= 10;
    reasons.push("thin_content");
  }

  return { score: clamp(score, 0, 100), reasons: uniq(reasons) };
}

export function scoreSeoPages(pages: SeoPageRow[]): ScoredSeoPageRow[] {
  return pages.map((p) => {
    const s = computeSeoPageScore(p);
    return { ...p, seoScore: s.score, seoReasons: s.reasons };
  });
}

export function medianSeoScore(scored: ScoredSeoPageRow[]): number | null {
  const vals = scored.map((p) => p.seoScore).filter((n) => Number.isFinite(n));
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  if (vals.length % 2) return vals[mid];
  return Math.round((vals[mid - 1] + vals[mid]) / 2);
}

export function worstPages(scored: ScoredSeoPageRow[], n = 8): ScoredSeoPageRow[] {
  return scored
    .slice()
    .sort((a, b) => (a.seoScore - b.seoScore) || String(a.urlPath || "").localeCompare(String(b.urlPath || "")))
    .slice(0, n);
}

function pickExamples(pages: SeoPageRow[], pred: (p: SeoPageRow) => boolean, limit = 5): string[] {
  const out: string[] = [];
  for (const p of pages) {
    if (out.length >= limit) break;
    const path = p.urlPath || "";
    if (!path) continue;
    if (!pred(p)) continue;
    out.push(path);
  }
  return out;
}

function severityRank(s: SeoActionSeverity) {
  if (s === "critical") return 4;
  if (s === "high") return 3;
  if (s === "medium") return 2;
  return 1;
}
function impactRank(i: SeoActionImpact) {
  if (i === "high") return 3;
  if (i === "medium") return 2;
  return 1;
}

function orderActions(items: SeoActionItem[]): SeoActionItem[] {
  return items
    .slice()
    .sort((a, b) => {
      const sa = severityRank(a.severity);
      const sb = severityRank(b.severity);
      if (sb !== sa) return sb - sa;
      const ia = impactRank(a.impact);
      const ib = impactRank(b.impact);
      if (ib !== ia) return ib - ia;
      const ca = a.scope.affectedPagesCount ?? 0;
      const cb = b.scope.affectedPagesCount ?? 0;
      if (cb !== ca) return cb - ca;
      return a.id.localeCompare(b.id);
    });
}

function pctFromCount(total: number | null | undefined, count: number | null | undefined): number | null {
  const t = typeof total === "number" && total > 0 ? total : null;
  const c = typeof count === "number" && count >= 0 ? count : null;
  if (t == null || c == null) return null;
  return Math.max(0, Math.min(100, (c / t) * 100));
}

function inferDuplicatesFromSample(pages: SeoPageRow[], key: "title" | "metaDescription") {
  const map = new Map<string, string[]>();
  for (const p of pages) {
    const v = (p[key] || "").trim();
    const path = (p.urlPath || "").trim();
    if (!v || !path) continue;
    const existing = map.get(v) || [];
    existing.push(path);
    map.set(v, existing);
  }
  const dups = Array.from(map.entries())
    .filter(([, paths]) => paths.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  const top = dups[0];
  if (!top) return { duplicateGroups: 0, affectedPagesCount: 0, examplePaths: [] as string[] };
  const affected = dups.reduce((acc, [, paths]) => acc + paths.length, 0);
  const examplePaths = top[1].slice(0, 5);
  return { duplicateGroups: dups.length, affectedPagesCount: affected, examplePaths };
}

function canonicalMismatchExamples(pages: SeoPageRow[], siteOrigin: string | null) {
  if (!siteOrigin) return { count: 0, examples: [] as string[] };
  const origin = siteOrigin;
  let count = 0;
  const ex: string[] = [];
  for (const p of pages) {
    if (!p.urlPath || !p.canonical) continue;
    let u: URL | null = null;
    try {
      u = new URL(/^https?:\/\//i.test(p.canonical) ? p.canonical : `https://${String(p.canonical).replace(/^\/\//, "")}`);
    } catch {
      continue;
    }
    const isOffOrigin = u.origin !== origin;
    const pathA = normalizePathLike(p.urlPath);
    const pathB = normalizePathLike(u.pathname || "");
    const isPathMismatch = Boolean(pathA && pathB && pathA !== pathB);
    if (isOffOrigin || isPathMismatch) {
      count += 1;
      if (ex.length < 5) ex.push(p.urlPath);
    }
  }
  return { count, examples: ex };
}

function intentionalNoindexExamples(pages: SeoPageRow[]) {
  const patterns = [/^\/admin(\/|$)/i, /^\/login(\/|$)/i, /^\/signin(\/|$)/i, /^\/checkout(\/|$)/i, /^\/cart(\/|$)/i];
  const matches = pages
    .map((p) => p.urlPath || "")
    .filter(Boolean)
    .filter((p) => patterns.some((re) => re.test(p)));
  return uniq(matches).slice(0, 5);
}

export function generateSeoActions(input: {
  seo: SeoRollup;
  pages: SeoPageRow[];
  scoredPages: ScoredSeoPageRow[];
  vitals?: SeoVitalsSnapshot | null;
  siteOrigin?: string | null;
  favicon?: FaviconIntelligenceResult | null;
}): SeoActionItem[] {
  const { seo, pages, scoredPages, vitals, siteOrigin, favicon } = input;

  const observed = typeof seo.pagesObserved === "number" ? seo.pagesObserved : null;
  const hasRows = pages.length > 0;

  const hasFaviconData = Boolean(favicon && (favicon.icons.length > 0 || favicon.issues.length > 0));
  if (!observed && !hasRows && !hasFaviconData) {
    return [
      {
        id: "insufficient_data",
        severity: "low",
        impact: "low",
        title: "Waiting for SEO snapshots",
        whyItMatters: "SEO Intelligence needs real page snapshots to measure coverage, indexability, and structure.",
        howToFix: [
          "Verify CavBot is installed and sending snapshots for this site.",
          "Generate real traffic across key pages (home, category, product, blog) so snapshots populate.",
          "Recheck this module after new sessions are captured for the selected timeline.",
        ],
        scope: { affectedPagesCount: null, affectedPct: null },
        examples: [],
        confidence: "observed",
      },
    ];
  }

  const actions: SeoActionItem[] = [];

  if (favicon?.issues?.length) {
    const p0 = favicon.issues.find((issue) => issue.priority === "P0") || null;
    const p1 = favicon.issues.find((issue) => issue.priority === "P1") || null;
    const selected = [p0, p1].filter((issue): issue is NonNullable<typeof issue> => Boolean(issue));
    if (!selected.length) selected.push(favicon.issues[0]);

    for (const issue of selected.slice(0, 2)) {
      const mapped = faviconIssueToSeoAction(issue);
      actions.push({
        id: `favicon_${issue.code}`,
        severity: mapped.severity,
        impact: mapped.impact,
        title: mapped.title,
        whyItMatters: mapped.whyItMatters,
        howToFix: [
          ...mapped.howToFix,
          faviconIssueScopeLabel(issue),
        ].slice(0, 6),
        scope: { affectedPagesCount: null, affectedPct: null },
        examples: issue.urls.slice(0, 5),
        confidence: "observed",
      });
    }
  }

  // A) Indexability guard (Critical)
  const noindexCount = seo.noindexCount ?? null;
  const noindexPct = seo.noindexPct ?? pctFromCount(observed, noindexCount);
  if ((typeof noindexCount === "number" && noindexCount > 0) || (typeof noindexPct === "number" && noindexPct > 1)) {
    const intentExamples = intentionalNoindexExamples(pages);
    const examples = pickExamples(
      pages,
      (p) => {
        const robots = parseRobotsMeta(p.robots);
        return p.noindex === true || (p.noindex == null && robots.noindex);
      },
      5
    );
    actions.push({
      id: "noindex_pages",
      severity: "critical",
      impact: "high",
      title: "Pages are blocked from indexing",
      whyItMatters: "If important pages are marked noindex, they cannot appear in search results and will not accrue organic value.",
      howToFix: [
        "Audit which pages are intentionally noindex versus accidental.",
        "Remove `noindex` from pages that should rank, and ensure the rendered HTML reflects the change.",
        "Confirm the page is accessible to crawlers and is not blocked elsewhere (robots.txt, auth walls).",
        intentExamples.length ? `If intentional, keep noindex for pages like: ${intentExamples.join(", ")}` : "If intentional, restrict noindex to admin/login/checkout-style pages only.",
      ].slice(0, 6),
      scope: { affectedPagesCount: noindexCount ?? null, affectedPct: typeof noindexPct === "number" ? noindexPct : null },
      examples,
      confidence: "observed",
    });
  }

  // Essential metadata coverage
  const missTitle = seo.missingTitleCount ?? null;
  if (typeof missTitle === "number" && missTitle > 0) {
    actions.push({
      id: "missing_title",
      severity: "high",
      impact: "high",
      title: "Missing page titles are reducing discoverability",
      whyItMatters: "Titles are a primary relevance signal and the default headline in search results.",
      howToFix: [
        "Ensure every indexable page renders a non-empty `<title>`.",
        "Generate titles from real content (product/category/blog) and keep them unique per page.",
        "Prefer a stable format: `Primary Topic | Brand` for consistency.",
      ],
      scope: { affectedPagesCount: missTitle, affectedPct: pctFromCount(observed, missTitle) },
      examples: pickExamples(pages, (p) => !isNonEmptyString(p.title)),
      confidence: "observed",
    });
  }

  const missDesc = seo.missingDescriptionCount ?? null;
  if (typeof missDesc === "number" && missDesc > 0) {
    actions.push({
      id: "missing_description",
      severity: "high",
      impact: "medium",
      title: "Missing meta descriptions are hurting click-through rate",
      whyItMatters: "Descriptions influence how your snippet reads in search and can materially affect CTR on high-impression pages.",
      howToFix: [
        "Render a meta description for every key page type (home, category, product, blog).",
        "Keep it specific: include the primary entity and one differentiator.",
        "Avoid duplicating the same description across many pages.",
      ],
      scope: { affectedPagesCount: missDesc, affectedPct: pctFromCount(observed, missDesc) },
      examples: pickExamples(pages, (p) => !isNonEmptyString(p.metaDescription)),
      confidence: "observed",
    });
  }

  const missCanon = seo.missingCanonicalCount ?? null;
  if (typeof missCanon === "number" && missCanon > 0) {
    actions.push({
      id: "missing_canonical",
      severity: "high",
      impact: "medium",
      title: "Missing canonicals can fragment page authority",
      whyItMatters: "Without canonicals, duplicates (query params, sorting, trailing slashes) can split signals and waste crawl budget.",
      howToFix: [
        "Render a canonical URL on indexable pages.",
        "Ensure canonical points to the preferred origin + path for each page.",
        "Keep canonical stable across parameterized variants.",
      ],
      scope: { affectedPagesCount: missCanon, affectedPct: pctFromCount(observed, missCanon) },
      examples: pickExamples(pages, (p) => !isNonEmptyString(p.canonical)),
      confidence: "observed",
    });
  }

  // Canonical mismatches (observed from row-level canonical/urlPath)
  const canonMismatch = canonicalMismatchExamples(pages, siteOrigin ?? null);
  if (canonMismatch.count > 0) {
    actions.push({
      id: "canonical_mismatch",
      severity: "high",
      impact: "high",
      title: "Canonicals may be pointing to the wrong URL",
      whyItMatters: "If canonicals point off-origin or to a different path, search engines can index and rank the wrong page variant.",
      howToFix: [
        "Ensure canonical origin matches the selected target site (protocol + host).",
        "Ensure canonical pathname matches the current page path (including trailing slash policy).",
        "Avoid mixing staging/alternate domains in canonical tags.",
      ],
      scope: { affectedPagesCount: canonMismatch.count, affectedPct: pctFromCount(observed, canonMismatch.count) },
      examples: canonMismatch.examples,
      confidence: "observed",
    });
  }

  // H1 / content structure (medium)
  const missH1 = seo.missingH1Count ?? null;
  if (typeof missH1 === "number" && missH1 > 0) {
    actions.push({
      id: "missing_h1",
      severity: "medium",
      impact: "medium",
      title: "Some pages are missing an H1",
      whyItMatters: "An H1 helps communicate the primary topic to users and assistive tech, and often aligns with the page’s intent.",
      howToFix: [
        "Add a single, descriptive H1 to each template.",
        "Keep H1 aligned with the page title but not a duplicate wall of text.",
        "Avoid hiding the H1 purely for styling reasons; style it instead.",
      ],
      scope: { affectedPagesCount: missH1, affectedPct: pctFromCount(observed, missH1) },
      examples: pickExamples(pages, (p) => (p.h1Count ?? 0) === 0),
      confidence: "observed",
    });
  }

  const multiH1 = seo.multipleH1Count ?? null;
  if (typeof multiH1 === "number" && multiH1 > 0) {
    actions.push({
      id: "multiple_h1",
      severity: "medium",
      impact: "low",
      title: "Multiple H1s are creating unclear hierarchy",
      whyItMatters: "Multiple H1s can confuse the document outline and make it harder for crawlers and users to infer the page’s primary topic.",
      howToFix: [
        "Ensure each page has exactly one H1 (per template).",
        "Demote secondary headings to H2/H3 levels.",
        "Avoid using H1 purely for styling; use CSS for size/weight.",
      ],
      scope: { affectedPagesCount: multiH1, affectedPct: pctFromCount(observed, multiH1) },
      examples: pickExamples(pages, (p) => (p.h1Count ?? 0) > 1),
      confidence: "observed",
    });
  }

  const thin = seo.thinContentCount ?? null;
  if (typeof thin === "number" && thin > 0) {
    actions.push({
      id: "thin_content",
      severity: "medium",
      impact: "medium",
      title: "Thin pages may not satisfy search intent",
      whyItMatters: "Very low-content pages can underperform on relevance and struggle to rank for meaningful queries.",
      howToFix: [
        "Expand on-page content where it adds value (FAQs, specs, unique copy, internal links).",
        "Consolidate near-empty pages into stronger canonical pages when appropriate.",
        "Ensure key pages provide enough context for users to take action.",
      ],
      scope: { affectedPagesCount: thin, affectedPct: pctFromCount(observed, thin) },
      examples: pickExamples(pages, (p) => (p.wordCount ?? 0) > 0 && (p.wordCount ?? 0) < 200),
      confidence: "observed",
    });
  }

  // Duplicate titles/descriptions: infer from sample rows (bounded) unless explicit rollups exist.
  if (pages.length) {
    const dupTitle = inferDuplicatesFromSample(pages, "title");
    if (dupTitle.affectedPagesCount >= 2) {
      actions.push({
        id: "duplicate_titles",
        severity: "medium",
        impact: "medium",
        title: "Duplicate titles are diluting page differentiation",
        whyItMatters: "When many pages share the same title, search engines have less signal to distinguish intent and relevance across URLs.",
        howToFix: [
          "Make titles unique per page by including the specific entity (category/product/location).",
          "Use templates with stable ordering and avoid generic placeholders.",
          "Audit the highest-traffic duplicated pages first and fix those templates.",
        ],
        scope: { affectedPagesCount: dupTitle.affectedPagesCount, affectedPct: pctFromCount(observed, dupTitle.affectedPagesCount) },
        examples: dupTitle.examplePaths,
        confidence: "inferred",
      });
    }

    const dupDesc = inferDuplicatesFromSample(pages, "metaDescription");
    if (dupDesc.affectedPagesCount >= 2) {
      actions.push({
        id: "duplicate_descriptions",
        severity: "low",
        impact: "low",
        title: "Duplicate meta descriptions are limiting snippet quality",
        whyItMatters: "When descriptions repeat, snippets are less compelling and search engines may ignore them for autogenerated text.",
        howToFix: [
          "Generate descriptions that reflect the page’s unique content and offering.",
          "Keep them concise and human-readable; avoid keyword stuffing.",
          "Fix templates that render the same description site-wide.",
        ],
        scope: { affectedPagesCount: dupDesc.affectedPagesCount, affectedPct: pctFromCount(observed, dupDesc.affectedPagesCount) },
        examples: dupDesc.examplePaths,
        confidence: "inferred",
      });
    }
  }

  // D) Web vitals -> SEO context (one action if bad)
  const lcp = vitals?.lcpP75Ms ?? null;
  const inp = vitals?.inpP75Ms ?? null;
  const cls = vitals?.clsP75 ?? null;
  const lcpBad = typeof lcp === "number" && lcp > 4000;
  const inpBad = typeof inp === "number" && inp > 500;
  const clsBad = typeof cls === "number" && cls > 0.25;
  if (lcpBad || inpBad || clsBad) {
    const parts: string[] = [];
    if (typeof lcp === "number") parts.push(`LCP P75 ${Math.round(lcp)} ms`);
    if (typeof inp === "number") parts.push(`INP P75 ${Math.round(inp)} ms`);
    if (typeof cls === "number") parts.push(`CLS P75 ${cls.toFixed(3)}`);
    actions.push({
      id: "vitals_limiting_search_experience",
      severity: "high",
      impact: "high",
      title: "Performance is limiting search experience",
      whyItMatters: `Observed vitals indicate slow or unstable experiences (${parts.join(", ")}). This can reduce engagement and harm SEO outcomes.`,
      howToFix: [
        "Reduce render-blocking work and ship less JS on critical routes.",
        "Optimize images/fonts and eliminate layout shifts from late-loading elements.",
        "Measure by template: fix the worst-performing page types first.",
      ],
      scope: { affectedPagesCount: null, affectedPct: null },
      examples: [],
      confidence: "observed",
    });
  }

  // C) Score-based action (worst pages)
  if (scoredPages.length) {
    const worst = worstPages(scoredPages, 8);
    const badCount = scoredPages.filter((p) => p.seoScore <= 60).length;
    if (badCount > 0) {
      actions.push({
        id: "lowest_health_pages",
        severity: "medium",
        impact: "high",
        title: "Fix the lowest SEO-health pages first",
        whyItMatters: "A small set of broken templates can create many low-quality pages and drag down overall site posture.",
        howToFix: [
          "Start with the lowest-scoring pages and identify the template causing missing fields.",
          "Fix at the template/source level to lift many pages at once.",
          "Re-check after new snapshots confirm the fixes are rendered.",
        ],
        scope: { affectedPagesCount: badCount, affectedPct: pctFromCount(observed, badCount) },
        examples: worst.map((p) => p.urlPath || "").filter(Boolean).slice(0, 5),
        confidence: "observed",
      });
    }
  }

  return orderActions(actions);
}
