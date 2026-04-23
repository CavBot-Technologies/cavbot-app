import "server-only";

import type { CavAiLatestPackWithHistory } from "@/lib/cavai/packs.server";
import type { ProjectSummary } from "@/lib/cavbotTypes";
import type { CavAiFindingV1, CavAiInsightPackV1, CavAiPriorityV1 } from "@/packages/cavai-contracts/src";

type AnyRecord = Record<string, unknown>;

const SEO_CODES = new Set([
  "missing_title",
  "missing_meta_description",
  "missing_h1",
  "multiple_h1",
  "social_tags",
  "missing_canonical",
  "missing_favicon",
  "missing_apple_touch_icon",
  "missing_web_manifest_icon_set",
  "missing_manifest",
  "missing_structured_data",
  "missing_website_schema",
  "missing_organization_schema",
  "missing_person_schema",
  "missing_theme_color",
  "keywords_insufficient_data",
  "keyword_cluster_gap",
]);

const A11Y_CODES = new Set([
  "missing_accessible_name",
  "icon_button_missing_label",
  "missing_form_labels",
  "placeholder_as_label",
  "image_missing_alt",
  "product_image_alt_coverage_low",
  "heading_level_skipped",
  "multiple_h1",
  "missing_h1",
  "focus_visible",
  "focus_outline_removed",
  "focus_trap_detected",
  "focus_error_summary_missing",
  "contrast_failure",
  "missing_main_landmark",
  "missing_nav_landmark",
  "missing_home_link",
  "tabindex_misuse",
  "reduced_motion_not_respected",
  "missing_accessibility_statement",
]);

const ROUTE_CODES = new Set([
  "route_http_404",
  "route_http_5xx",
  "status_404_misconfigured",
  "missing_custom_404_page",
  "broken_404_nav_home",
  "internal_links_to_404",
  "missing_home_link",
  "missing_nav_landmark",
  "broken_back_to_top",
  "inconsistent_navigation",
  "recommend_404_arcade_game",
  "slow_response",
  "high_layout_shift",
  "horizontal_overflow_detected",
  "text_clip_overflow_risk",
  "missing_loading_state",
]);

const ROUTE_404_CODES = new Set([
  "route_http_404",
  "status_404_misconfigured",
  "missing_custom_404_page",
  "broken_404_nav_home",
  "internal_links_to_404",
  "recommend_404_arcade_game",
]);

const JS_ERROR_CODES = new Set([
  "js_error_fingerprint",
  "auth_login_failure_spike",
  "signup_failure_spike",
]);

const API_ERROR_CODES = new Set([
  "api_error_cluster",
  "auth_endpoint_error_cluster",
  "route_http_5xx",
]);

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): AnyRecord | null {
  return isRecord(value) ? value : null;
}

function ensureRecord(root: AnyRecord, key: string) {
  const existing = asRecord(root[key]);
  if (existing) return existing;
  const next: AnyRecord = {};
  root[key] = next;
  return next;
}

function readPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const key of path.split(".")) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function firstNumber(root: unknown, paths: string[]) {
  for (const path of paths) {
    const value = Number(readPath(root, path));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function titleFromCode(code: string, priorityMap: Map<string, CavAiPriorityV1>) {
  const priorityTitle = priorityMap.get(code)?.title;
  if (priorityTitle) return priorityTitle;
  return code
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function countMatchingFindings(pack: CavAiInsightPackV1, predicate: (finding: CavAiFindingV1) => boolean) {
  return pack.core.findings.filter(predicate).length;
}

function uniqueMatchingPages(pack: CavAiInsightPackV1, predicate: (finding: CavAiFindingV1) => boolean) {
  const pages = new Set<string>();
  for (const finding of pack.core.findings) {
    if (!predicate(finding)) continue;
    const pagePath = String(finding.pagePath || "/").trim() || "/";
    pages.add(pagePath);
  }
  return pages;
}

function issueCountForFinding(finding: CavAiFindingV1) {
  const metricEvidence = finding.evidence.find((item) => item.type === "metric");
  const metricValue =
    metricEvidence && Number.isFinite(Number(metricEvidence.value))
      ? Math.max(1, Math.trunc(Number(metricEvidence.value)))
      : null;
  return metricValue ?? 1;
}

function buildPageRows(
  pack: CavAiInsightPackV1,
  priorityMap: Map<string, CavAiPriorityV1>,
  predicate: (finding: CavAiFindingV1) => boolean,
) {
  const grouped = new Map<string, { issues: Set<string>; diagnosticCount: number }>();

  for (const finding of pack.core.findings) {
    if (!predicate(finding)) continue;
    const pagePath = String(finding.pagePath || "/").trim() || "/";
    const entry = grouped.get(pagePath) || { issues: new Set<string>(), diagnosticCount: 0 };
    entry.issues.add(titleFromCode(String(finding.code || ""), priorityMap));
    entry.diagnosticCount += issueCountForFinding(finding);
    grouped.set(pagePath, entry);
  }

  return [...grouped.entries()]
    .map(([pagePath, value]) => ({
      urlPath: pagePath,
      origin: pack.origin,
      routePath: pagePath,
      issues: [...value.issues].slice(0, 16),
      diagnosticCount: value.diagnosticCount,
    }))
    .sort((left, right) => {
      if (right.diagnosticCount !== left.diagnosticCount) return right.diagnosticCount - left.diagnosticCount;
      return left.urlPath.localeCompare(right.urlPath);
    });
}

function derivedGuardianScore(pack: CavAiInsightPackV1) {
  const weights: Record<string, number> = {
    critical: 18,
    high: 11,
    medium: 7,
    low: 4,
    note: 2,
  };

  const penalty = pack.priorities.slice(0, 8).reduce((total, priority) => {
    const severityWeight = weights[String(priority.severity || "").toLowerCase()] ?? 4;
    const coverageWeight = clamp(Number(priority.coverage || 0) / 8, 0, 12);
    return total + severityWeight + coverageWeight;
  }, 0);

  return clamp(Math.round(100 - penalty), 12, 100);
}

function derivedScoreFromHistoryEntry(entry: CavAiLatestPackWithHistory["history"][number]) {
  const penalty = clamp(entry.priorityCount * 6 + entry.findingCount * 2, 0, 88);
  return clamp(Math.round(100 - penalty), 12, 100);
}

export function enrichProjectSummaryWithLatestPack(
  summary: ProjectSummary,
  latestPackWithHistory: CavAiLatestPackWithHistory | null,
): ProjectSummary {
  if (!latestPackWithHistory?.pack) return summary;

  const pack = latestPackWithHistory.pack;
  const priorityMap = new Map(pack.priorities.map((priority) => [priority.code, priority]));
  const enriched = { ...summary } as ProjectSummary & AnyRecord;
  const diagnostics = ensureRecord(enriched, "diagnostics");
  const snapshot = ensureRecord(enriched, "snapshot");
  const metrics = asRecord(enriched.metrics) || {};
  if (!asRecord(enriched.metrics)) enriched.metrics = metrics;

  const pagesScanned = Math.max(0, Math.trunc(Number(pack.pagesScanned || 0)));
  const pageLimit = Math.max(1, Math.trunc(Number(pack.pageLimit || 1)));
  const guardianScore =
    firstNumber(enriched, ["guardianScore", "metrics.guardianScore", "diagnostics.guardianScore", "snapshot.guardianScore"])
    ?? derivedGuardianScore(pack);
  const aggregationCoveragePercent =
    firstNumber(enriched, [
      "aggregationCoveragePercent",
      "metrics.aggregationCoveragePercent",
      "diagnostics.aggregationCoveragePercent",
      "snapshot.aggregationCoveragePercent",
    ]) ?? clamp((pagesScanned / Math.max(1, pageLimit)) * 100, 0, 100);
  const sessions30d = firstNumber(enriched, ["metrics.sessions30d", "metrics.sessions"]);
  const views404 = firstNumber(enriched, ["metrics.views40430d", "metrics.views404_24h", "metrics.views404"]);
  const jsErrors = firstNumber(enriched, ["metrics.jsErrors30d", "metrics.jsErrors"]);
  const apiErrors = firstNumber(enriched, ["metrics.apiErrors30d", "metrics.apiErrors"]);
  const contrastFailures = firstNumber(enriched, ["metrics.contrastFailures30d", "metrics.contrastFailCount"]);
  const focusInvisible = firstNumber(enriched, ["metrics.focusInvisible30d", "metrics.focusFailCount"]);
  const a11yIssues = firstNumber(enriched, ["metrics.a11yIssues30d", "metrics.a11yIssues"]);

  const seoRows = buildPageRows(pack, priorityMap, (finding) => SEO_CODES.has(String(finding.code || "")));
  const a11yRows = buildPageRows(pack, priorityMap, (finding) => A11Y_CODES.has(String(finding.code || "")));
  const routeRows = buildPageRows(pack, priorityMap, (finding) => ROUTE_CODES.has(String(finding.code || "")));
  const route404Rows = buildPageRows(pack, priorityMap, (finding) => ROUTE_404_CODES.has(String(finding.code || "")));
  const errorRows = buildPageRows(
    pack,
    priorityMap,
    (finding) => JS_ERROR_CODES.has(String(finding.code || "")) || API_ERROR_CODES.has(String(finding.code || "")),
  );

  diagnostics.guardianScore = guardianScore;
  diagnostics.aggregationCoveragePercent = aggregationCoveragePercent;
  snapshot.guardianScore = guardianScore;
  snapshot.aggregationCoveragePercent = aggregationCoveragePercent;

  const guardianTrend = latestPackWithHistory.history
    .slice()
    .reverse()
    .map((entry) => ({
      day: entry.createdAtISO.slice(0, 10),
      score: derivedScoreFromHistoryEntry(entry),
    }));
  if (guardianTrend.length) {
    diagnostics.guardianTrend = guardianTrend;
    enriched.guardianTrend = guardianTrend;
  }

  const trend7d = latestPackWithHistory.history
    .slice()
    .reverse()
    .map((entry) => ({
      day: entry.createdAtISO.slice(0, 10),
      signals: entry.findingCount,
    }));
  if (trend7d.length) {
    diagnostics.trend7d = trend7d;
    enriched.trend7d = trend7d;
  }

  if (routeRows.length) {
    diagnostics.topRoutes = routeRows.slice(0, 12).map((row) => ({
      routePath: row.routePath,
      issues: row.issues,
      views404: ROUTE_404_CODES.size ? row.diagnosticCount : null,
    }));
  }

  const seo = ensureRecord(diagnostics, "seo");
  const seoRollup = ensureRecord(seo, "rollup");
  const missingTitlePages = uniqueMatchingPages(pack, (finding) => finding.code === "missing_title").size;
  const missingDescriptionPages = uniqueMatchingPages(pack, (finding) => finding.code === "missing_meta_description").size;
  const missingCanonicalPages = uniqueMatchingPages(pack, (finding) => finding.code === "missing_canonical").size;
  const missingH1Pages = uniqueMatchingPages(pack, (finding) => finding.code === "missing_h1").size;
  const multipleH1Pages = uniqueMatchingPages(pack, (finding) => finding.code === "multiple_h1").size;
  const thinContentPages = uniqueMatchingPages(
    pack,
    (finding) => finding.code === "keywords_insufficient_data" || finding.code === "keyword_cluster_gap",
  ).size;

  seo.updatedAtISO = seo.updatedAtISO || pack.generatedAt;
  seo.pages = Array.isArray(seo.pages) && seo.pages.length ? seo.pages : seoRows;
  seoRollup.pagesObserved = Number.isFinite(Number(seoRollup.pagesObserved)) ? seoRollup.pagesObserved : pagesScanned;
  seoRollup.titleCoveragePct ??= pagesScanned ? clamp(((pagesScanned - missingTitlePages) / pagesScanned) * 100, 0, 100) : null;
  seoRollup.descriptionCoveragePct ??= pagesScanned
    ? clamp(((pagesScanned - missingDescriptionPages) / pagesScanned) * 100, 0, 100)
    : null;
  seoRollup.canonicalCoveragePct ??= pagesScanned
    ? clamp(((pagesScanned - missingCanonicalPages) / pagesScanned) * 100, 0, 100)
    : null;
  seoRollup.missingH1Pct ??= pagesScanned ? clamp((missingH1Pages / pagesScanned) * 100, 0, 100) : null;
  seoRollup.multipleH1Pct ??= pagesScanned ? clamp((multipleH1Pages / pagesScanned) * 100, 0, 100) : null;
  seoRollup.thinContentPct ??= pagesScanned ? clamp((thinContentPages / pagesScanned) * 100, 0, 100) : null;
  seoRollup.noindexPct ??= 0;
  seoRollup.nofollowPct ??= 0;
  seoRollup.noindexCount ??= 0;
  seoRollup.nofollowCount ??= 0;
  seoRollup.missingTitleCount ??= missingTitlePages;
  seoRollup.missingDescriptionCount ??= missingDescriptionPages;
  seoRollup.missingCanonicalCount ??= missingCanonicalPages;
  seoRollup.missingH1Count ??= missingH1Pages;
  seoRollup.multipleH1Count ??= multipleH1Pages;
  seoRollup.thinContentCount ??= thinContentPages;

  const a11y = ensureRecord(diagnostics, "a11y");
  const a11yRollup = ensureRecord(a11y, "rollup");
  const missingAltCount = countMatchingFindings(pack, (finding) =>
    finding.code === "image_missing_alt" || finding.code === "product_image_alt_coverage_low",
  );
  const unlabeledControlCount = countMatchingFindings(pack, (finding) =>
    finding.code === "missing_accessible_name" || finding.code === "icon_button_missing_label",
  );
  const missingFormLabelCount = countMatchingFindings(pack, (finding) =>
    finding.code === "missing_form_labels" || finding.code === "placeholder_as_label",
  );
  const missingLangCount = countMatchingFindings(pack, (finding) => finding.code === "missing_main_landmark");
  const headingSkipCount = countMatchingFindings(pack, (finding) => finding.code === "heading_level_skipped");
  const multipleH1Count = countMatchingFindings(pack, (finding) => finding.code === "multiple_h1");
  const missingSkipLinkCount = countMatchingFindings(pack, (finding) => finding.code === "missing_nav_landmark");
  const contrastFailCount = countMatchingFindings(pack, (finding) => finding.code === "contrast_failure");
  const focusFailCount = countMatchingFindings(
    pack,
    (finding) =>
      finding.code === "focus_visible"
      || finding.code === "focus_outline_removed"
      || finding.code === "focus_trap_detected"
      || finding.code === "focus_error_summary_missing",
  );

  const derivedA11yScore = clamp(
    100 - (contrastFailCount * 6 + focusFailCount * 5 + missingAltCount * 4 + missingFormLabelCount * 4),
    12,
    100,
  );

  a11y.updatedAtISO = a11y.updatedAtISO || pack.generatedAt;
  a11y.pages = Array.isArray(a11y.pages) && a11y.pages.length
    ? a11y.pages
    : a11yRows.map((row) => ({
        ...row,
        missingAltCount: row.issues.some((issue) => /alt/i.test(issue)) ? row.diagnosticCount : 0,
        unlabeledControlCount: row.issues.some((issue) => /label|name/i.test(issue)) ? row.diagnosticCount : 0,
        missingFormLabelCount: row.issues.some((issue) => /form|label/i.test(issue)) ? row.diagnosticCount : 0,
        missingLangCount: row.issues.some((issue) => /landmark/i.test(issue)) ? row.diagnosticCount : 0,
        headingSkipCount: row.issues.some((issue) => /heading/i.test(issue)) ? row.diagnosticCount : 0,
        multipleH1Count: row.issues.some((issue) => /h1/i.test(issue)) ? row.diagnosticCount : 0,
        missingSkipLinkCount: row.issues.some((issue) => /nav/i.test(issue)) ? row.diagnosticCount : 0,
        contrastFailCount: row.issues.some((issue) => /contrast/i.test(issue)) ? row.diagnosticCount : 0,
        focusFailCount: row.issues.some((issue) => /focus/i.test(issue)) ? row.diagnosticCount : 0,
      }));
  a11yRollup.pagesObserved = Number.isFinite(Number(a11yRollup.pagesObserved)) ? a11yRollup.pagesObserved : pagesScanned;
  a11yRollup.a11yScore ??= derivedA11yScore;
  a11yRollup.altTextCoveragePct ??= pagesScanned ? clamp(((pagesScanned - missingAltCount) / pagesScanned) * 100, 0, 100) : null;
  a11yRollup.ariaNameCoveragePct ??= pagesScanned
    ? clamp(((pagesScanned - unlabeledControlCount) / pagesScanned) * 100, 0, 100)
    : null;
  a11yRollup.formLabelCoveragePct ??= pagesScanned
    ? clamp(((pagesScanned - missingFormLabelCount) / pagesScanned) * 100, 0, 100)
    : null;
  a11yRollup.langCoveragePct ??= pagesScanned ? clamp(((pagesScanned - missingLangCount) / pagesScanned) * 100, 0, 100) : null;
  a11yRollup.skipLinkCoveragePct ??= pagesScanned
    ? clamp(((pagesScanned - missingSkipLinkCount) / pagesScanned) * 100, 0, 100)
    : null;
  a11yRollup.headingIntegrityIssuePct ??= pagesScanned
    ? clamp(((headingSkipCount + multipleH1Count) / pagesScanned) * 100, 0, 100)
    : null;
  a11yRollup.issues ??= a11yIssues ?? a11yRows.reduce((total, row) => total + row.diagnosticCount, 0);
  a11yRollup.missingAltCount ??= missingAltCount;
  a11yRollup.unlabeledControlCount ??= unlabeledControlCount;
  a11yRollup.missingFormLabelCount ??= missingFormLabelCount;
  a11yRollup.missingLangCount ??= missingLangCount;
  a11yRollup.headingSkipCount ??= headingSkipCount;
  a11yRollup.multipleH1Count ??= multipleH1Count;
  a11yRollup.missingSkipLinkCount ??= missingSkipLinkCount;
  a11yRollup.contrastFailCount ??= contrastFailures ?? contrastFailCount;
  a11yRollup.focusFailCount ??= focusInvisible ?? focusFailCount;

  const routes = ensureRecord(diagnostics, "routes");
  const routesRollup = ensureRecord(routes, "rollup");
  routes.updatedAtISO = routes.updatedAtISO || pack.generatedAt;
  routes.topRoutes = Array.isArray(routes.topRoutes) && routes.topRoutes.length
    ? routes.topRoutes
    : routeRows.slice(0, 24).map((row) => ({
        routePath: row.routePath,
        views404: ROUTE_404_CODES.size ? row.diagnosticCount : null,
        jsErrors: row.issues.some((issue) => /error/i.test(issue)) ? row.diagnosticCount : 0,
        apiErrors: row.issues.some((issue) => /api|backend|5xx/i.test(issue)) ? row.diagnosticCount : 0,
        issues: row.issues,
      }));
  routesRollup.routesObserved ??= pagesScanned;
  routesRollup.uniqueRoutes ??= pagesScanned;
  routesRollup.pageViews ??= firstNumber(enriched, ["metrics.pageViews24h", "metrics.pageViews30d", "metrics.pageViews"]);
  routesRollup.sessions ??= sessions30d;
  routesRollup.routeChanges ??= routeRows.length;
  routesRollup.spaNavigations ??= 0;
  routesRollup.views404Count ??= views404 ?? route404Rows.reduce((total, row) => total + row.diagnosticCount, 0);
  routesRollup.jsErrorCount ??= jsErrors ?? errorRows.filter((row) => row.issues.some((issue) => /js/i.test(issue))).length;
  routesRollup.slowRouteCount ??= uniqueMatchingPages(
    pack,
    (finding) => finding.code === "high_layout_shift" || finding.code === "slow_response",
  ).size;
  routesRollup.views404Pct ??=
    views404 != null && sessions30d != null && sessions30d > 0
      ? clamp((views404 / sessions30d) * 100, 0, 100)
      : null;
  routesRollup.jsErrorPct ??=
    jsErrors != null && sessions30d != null && sessions30d > 0
      ? clamp((jsErrors / sessions30d) * 100, 0, 100)
      : null;
  routesRollup.slowRoutePct ??= pagesScanned
    ? clamp((Number(routesRollup.slowRouteCount || 0) / pagesScanned) * 100, 0, 100)
    : null;

  const errors = ensureRecord(diagnostics, "errors");
  const errorsTotals = ensureRecord(errors, "totals");
  errors.updatedAtISO = errors.updatedAtISO || pack.generatedAt;
  errorsTotals.jsErrors ??= jsErrors ?? countMatchingFindings(pack, (finding) => JS_ERROR_CODES.has(finding.code));
  errorsTotals.apiErrors ??= apiErrors ?? countMatchingFindings(pack, (finding) => API_ERROR_CODES.has(finding.code));
  errorsTotals.unhandledRejections ??= 0;
  errorsTotals.views404 ??= views404 ?? route404Rows.reduce((total, row) => total + row.diagnosticCount, 0);
  errors.groups = Array.isArray(errors.groups) && errors.groups.length
    ? errors.groups
    : errorRows.slice(0, 18).map((row) => ({
        fingerprint: `pack:${row.routePath}:${row.issues.join("|")}`,
        kind: row.issues.some((issue) => /api|backend|5xx/i.test(issue)) ? "api" : "js",
        message: row.issues[0] || "CavAi issue detected",
        routePath: row.routePath,
        count: row.diagnosticCount,
        sessions: null,
        firstSeenISO: pack.generatedAt,
        lastSeenISO: pack.generatedAt,
      }));
  errors.recent = Array.isArray(errors.recent) && errors.recent.length
    ? errors.recent
    : errorRows.slice(0, 24).map((row) => ({
        tsISO: pack.generatedAt,
        kind: row.issues.some((issue) => /api|backend|5xx/i.test(issue)) ? "api" : "js",
        message: row.issues[0] || "CavAi issue detected",
        routePath: row.routePath,
        fingerprint: `pack:${row.routePath}:${row.issues.join("|")}`,
      }));

  const controlRoom = ensureRecord(enriched, "controlRoom");
  controlRoom.updatedAtISO = controlRoom.updatedAtISO || pack.generatedAt;
  controlRoom.views404Total ??= views404 ?? route404Rows.reduce((total, row) => total + row.diagnosticCount, 0);
  controlRoom.unique404Routes ??= route404Rows.length;
  controlRoom.views404RatePct ??=
    controlRoom.views404Total != null && sessions30d != null && sessions30d > 0
      ? clamp((Number(controlRoom.views404Total) / sessions30d) * 100, 0, 100)
      : null;
  controlRoom.top404Routes = Array.isArray(controlRoom.top404Routes) && controlRoom.top404Routes.length
    ? controlRoom.top404Routes
    : route404Rows.slice(0, 16).map((row) => ({
        routePath: row.routePath,
        views404: row.diagnosticCount,
        source: "diagnostic",
      }));

  if (metrics.guardianScore == null) metrics.guardianScore = guardianScore;
  if (metrics.aggregationCoveragePercent == null) metrics.aggregationCoveragePercent = aggregationCoveragePercent;
  if (metrics.views40430d == null && views404 != null) metrics.views40430d = views404;
  if (metrics.jsErrors30d == null && jsErrors != null) metrics.jsErrors30d = jsErrors;
  if (metrics.apiErrors30d == null && apiErrors != null) metrics.apiErrors30d = apiErrors;
  if (metrics.a11yIssues30d == null && a11yIssues != null) metrics.a11yIssues30d = a11yIssues;
  if (metrics.contrastFailures30d == null && contrastFailures != null) metrics.contrastFailures30d = contrastFailures;
  if (metrics.focusInvisible30d == null && focusInvisible != null) metrics.focusInvisible30d = focusInvisible;

  return enriched;
}
