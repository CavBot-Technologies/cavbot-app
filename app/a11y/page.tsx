// app/a11y/page.tsx
import "./a11y.css";

import Image from "next/image";
import Script from "next/script";
import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { gateModuleAccess } from "@/lib/moduleGate.server";
import LockedModule from "@/components/LockedModule";
import AppShell from "@/components/AppShell";
import CavAiRouteRecommendations from "@/components/CavAiRouteRecommendations";
import { readWorkspace } from "@/lib/workspaceStore.server";
import { getProjectSummary } from "@/lib/cavbotApi.server";

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
const asString = (value: unknown): string | null => {
  if (value == null) return null;
  return String(value);
};

function firstStringArray(...values: unknown[]): string[] | null {
  for (const value of values) {
    if (Array.isArray(value) && value.length) {
      const out = value
        .map((x) => (x == null ? "" : String(x).trim()))
        .filter(Boolean)
        .slice(0, 16);
      return out.length ? out : null;
    }
    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }
  }
  return null;
}

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
function bOrNull(x: unknown): boolean | null {
  if (typeof x === "boolean") return x;
  if (typeof x === "number") return Number.isFinite(x) ? x !== 0 : null;
  if (typeof x === "string") {
    const s = x.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
    if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  }
  return null;
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
function pickNumberFromPaths(root: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const v = nOrNull(lookupPath(root, path));
    if (v != null) return v;
  }
  return null;
}
function pickStringFromPaths(root: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const v = asString(lookupPath(root, path));
    if (v != null && v.trim()) return v;
  }
  return null;
}
function pickBoolFromPaths(root: unknown, paths: string[]): boolean | null {
  for (const path of paths) {
    const v = bOrNull(lookupPath(root, path));
    if (v != null) return v;
  }
  return null;
}
function pickRecordArrayFromPaths(root: unknown, paths: string[]): UnknownRecord[] {
  for (const path of paths) {
    const candidate = lookupPath(root, path);
    if (Array.isArray(candidate) && candidate.length) {
      return candidate.filter(isRecord) as UnknownRecord[];
    }
  }
  return [];
}
function pickArrayCountFromPaths(root: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const candidate = lookupPath(root, path);
    if (Array.isArray(candidate)) return candidate.length;
    const v = nOrNull(candidate);
    if (v != null) return v;
  }
  return null;
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
function fmtScore(v: unknown) {
  const x = nOrNull(v);
  if (x == null) return "—";
  return `${clamp(x, 0, 100).toFixed(0)}`;
}
function fmtBool(v: unknown) {
  if (v == null) return "—";
  return Boolean(v) ? "Yes" : "No";
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
  A11y payload normalization
  ========================= */
type A11yPageRow = {
  urlPath?: string | null;
  origin?: string | null;

  // Common issue counts (row-level, optional)
  missingAltCount?: number | null;
  unlabeledControlCount?: number | null;
  missingFormLabelCount?: number | null;
  missingLangCount?: number | null;
  headingSkipCount?: number | null;
  multipleH1Count?: number | null;
  missingSkipLinkCount?: number | null;
  contrastFailCount?: number | null;
  focusFailCount?: number | null;

  // Optional raw strings
  updatedAtISO?: string | null;
  issues?: string[] | null;
};

type A11yPayload = {
  updatedAtISO?: string | null;

  pagesObserved?: number | null;

  // Score (0..100)
  a11yScore?: number | null;

  // Coverage / posture (0..100)
  altTextCoveragePct?: number | null;
  ariaNameCoveragePct?: number | null;
  formLabelCoveragePct?: number | null;
  langCoveragePct?: number | null;
  skipLinkCoveragePct?: number | null;

  // Fail rates (0..100)
  headingIntegrityIssuePct?: number | null;
  contrastFailPct?: number | null;
  focusFailPct?: number | null;

  // Totals
  totalIssues?: number | null;

  missingAltCount?: number | null;
  unlabeledControlCount?: number | null;
  missingFormLabelCount?: number | null;
  missingLangCount?: number | null;
  headingSkipCount?: number | null;
  multipleH1Count?: number | null;
  missingSkipLinkCount?: number | null;
  contrastFailCount?: number | null;
  focusFailCount?: number | null;

  // Samples
  sampleLang?: string | null;
  sampleSkipLink?: boolean | null;

  // Rows
  pages?: A11yPageRow[];
};


function normalizeA11yFromSummary(summary: unknown): A11yPayload {
  const summaryRoot = asRecord(summary) || {};
  const intelligenceRoot =
    asRecord(summaryRoot["a11yIntelligence"]) || asRecord(summaryRoot["accessibilityIntelligence"]) || null;
  if (!isRecord(summaryRoot["a11y"]) && intelligenceRoot) summaryRoot["a11y"] = intelligenceRoot;
  if (!isRecord(summaryRoot["accessibility"]) && intelligenceRoot) summaryRoot["accessibility"] = intelligenceRoot;

  const diagnosticsRoot = asRecord(summaryRoot["diagnostics"]);
  if (diagnosticsRoot) {
    const diagnosticsIntelligence =
      asRecord(diagnosticsRoot["a11yIntelligence"]) || asRecord(diagnosticsRoot["accessibilityIntelligence"]) || null;
    if (!isRecord(diagnosticsRoot["a11y"]) && diagnosticsIntelligence) diagnosticsRoot["a11y"] = diagnosticsIntelligence;
    if (!isRecord(diagnosticsRoot["accessibility"]) && diagnosticsIntelligence) diagnosticsRoot["accessibility"] = diagnosticsIntelligence;
  }

  const snapshotRoot = asRecord(summaryRoot["snapshot"]);
  if (snapshotRoot) {
    const snapshotIntelligence =
      asRecord(snapshotRoot["a11yIntelligence"]) || asRecord(snapshotRoot["accessibilityIntelligence"]) || null;
    if (!isRecord(snapshotRoot["a11y"]) && snapshotIntelligence) snapshotRoot["a11y"] = snapshotIntelligence;
    if (!isRecord(snapshotRoot["accessibility"]) && snapshotIntelligence) snapshotRoot["accessibility"] = snapshotIntelligence;
  }

  const pagesRaw = pickRecordArrayFromPaths(summaryRoot, [
    "a11y.pages",
    "a11y.pageRows",
    "a11y.rows",
    "a11y.inspectedPages",
    "a11y.rollup.pages",
    "a11y.summary.pages",
    "a11y.totals.pages",
    "a11y.counts.pages",
    "accessibility.pages",
    "accessibility.pageRows",
    "accessibility.rows",
    "accessibility.inspectedPages",
    "accessibility.rollup.pages",
    "accessibility.summary.pages",
    "diagnostics.a11y.pages",
    "diagnostics.a11y.pageRows",
    "diagnostics.accessibility.pages",
    "snapshot.a11y.pages",
    "snapshot.accessibility.pages",
    "metrics.a11y.pages",
    "metrics.a11yPages",
  ]);

  const pages = pagesRaw
    .map((p) => {
      const row = asRecord(p["a11y"]) || asRecord(p["accessibility"]) || p;
      return {
        urlPath:
          pickStringFromPaths(row, ["urlPath", "path", "url", "routePath", "pathname", "pagePath"]) ?? null,
        origin: pickStringFromPaths(row, ["origin", "siteOrigin", "baseOrigin", "hostOrigin"]) ?? null,
        missingAltCount: pickNumberFromPaths(row, [
          "missingAltCount",
          "altMissing",
          "imgAltMissing",
          "imagesMissingAlt",
          "imageMissingAltCount",
          "counts.missingAltCount",
          "accessibilityPlus.imageMissingAltCount",
        ]),
        unlabeledControlCount: pickNumberFromPaths(row, [
          "unlabeledControlCount",
          "unlabeledControls",
          "controlsMissingName",
          "missingInteractiveName",
          "missingAccessibleNames",
          "counts.unlabeledControlCount",
          "accessibilityPlus.missingAccessibleNames",
        ]),
        missingFormLabelCount: pickNumberFromPaths(row, [
          "missingFormLabelCount",
          "formsMissingLabels",
          "missingFormLabels",
          "inputsMissingLabel",
          "counts.missingFormLabelCount",
          "accessibilityPlus.missingFormLabels",
        ]),
        missingLangCount: pickNumberFromPaths(row, [
          "missingLangCount",
          "missingLang",
          "docLangMissing",
          "counts.missingLangCount",
        ]),
        headingSkipCount: pickNumberFromPaths(row, [
          "headingSkipCount",
          "headingSkips",
          "headingStructureSkips",
          "headingLevelSkips",
          "counts.headingSkipCount",
          "accessibilityPlus.headingSkipCount",
          "accessibilityPlus.headingLevelSkips",
        ]),
        multipleH1Count: pickNumberFromPaths(row, [
          "multipleH1Count",
          "multiH1",
          "h1Multiple",
          "counts.multipleH1Count",
        ]),
        missingSkipLinkCount: pickNumberFromPaths(row, [
          "missingSkipLinkCount",
          "skipLinkMissing",
          "skipLinkMissingCount",
          "counts.missingSkipLinkCount",
        ]),
        contrastFailCount:
          pickNumberFromPaths(row, [
            "contrastFailCount",
            "contrastFails",
            "contrastIssues",
            "contrastFailureCount",
            "counts.contrastFailCount",
            "accessibilityPlus.contrastFailureCount",
          ]) ??
          pickArrayCountFromPaths(row, [
            "contrastFailures",
            "accessibilityPlus.contrastFailures",
            "issues.contrastFailures",
          ]),
        focusFailCount:
          pickNumberFromPaths(row, [
            "focusFailCount",
            "focusFails",
            "focusIssues",
            "focusOutlineRemovedCount",
            "counts.focusFailCount",
            "accessibilityPlus.focusOutlineRemovedCount",
          ]) ??
          pickArrayCountFromPaths(row, ["focusFailures", "focusWarnings", "issues.focusWarnings"]),
        updatedAtISO: pickStringFromPaths(row, ["updatedAtISO", "updatedAt", "tsISO", "timestamp"]) ?? null,
        issues: firstStringArray(
          lookupPath(row, "issues"),
          lookupPath(row, "flags"),
          lookupPath(row, "errors"),
          lookupPath(row, "topIssues"),
          lookupPath(row, "signals")
        ),
      };
    })
    .filter((p) => Boolean(p.urlPath))
    .slice(0, 80);

  const updatedAtISO =
    pickStringFromPaths(summaryRoot, [
      "a11y.updatedAtISO",
      "a11y.updatedAt",
      "a11y.rollup.updatedAtISO",
      "accessibility.updatedAtISO",
      "accessibility.updatedAt",
      "accessibility.rollup.updatedAtISO",
      "diagnostics.a11y.updatedAtISO",
      "diagnostics.accessibility.updatedAtISO",
      "snapshot.a11y.updatedAtISO",
      "snapshot.accessibility.updatedAtISO",
      "updatedAtISO",
      "meta.updatedAtISO",
    ]) ?? null;

  const scoreRaw = pickNumberFromPaths(summaryRoot, [
    "a11y.rollup.a11yScore",
    "a11y.rollup.accessibilityScore",
    "a11y.rollup.score",
    "a11y.rollup.wcagScore",
    "a11y.a11yScore",
    "a11y.accessibilityScore",
    "a11y.score",
    "accessibility.rollup.accessibilityScore",
    "accessibility.rollup.score",
    "accessibility.accessibilityScore",
    "accessibility.score",
    "diagnostics.a11y.rollup.a11yScore",
    "diagnostics.a11y.score",
    "diagnostics.accessibility.score",
    "snapshot.a11y.a11yScore",
    "snapshot.accessibility.accessibilityScore",
    "metrics.a11yScore",
    "metrics.accessibilityScore",
  ]);

  const altCov = pickNumberFromPaths(summaryRoot, [
    "a11y.rollup.altTextCoveragePct",
    "a11y.rollup.alt_coverage_pct",
    "a11y.rollup.altCoveragePct",
    "a11y.rollup.imagesWithAltPct",
    "a11y.rollup.imgAltCoveragePct",
    "a11y.rollup.imageAltCoveragePct",
    "a11y.altTextCoveragePct",
    "accessibility.rollup.altTextCoveragePct",
    "accessibility.altTextCoveragePct",
    "diagnostics.a11y.rollup.altTextCoveragePct",
    "snapshot.accessibility.altTextCoveragePct",
    "metrics.altTextCoveragePct",
  ]);

  const ariaNameCov = pickNumberFromPaths(summaryRoot, [
    "a11y.rollup.ariaNameCoveragePct",
    "a11y.rollup.aria_name_coverage_pct",
    "a11y.rollup.interactiveNameCoveragePct",
    "a11y.rollup.controlsWithNamePct",
    "a11y.rollup.accessibleNameCoveragePct",
    "a11y.ariaNameCoveragePct",
    "accessibility.rollup.ariaNameCoveragePct",
    "accessibility.ariaNameCoveragePct",
    "diagnostics.a11y.ariaNameCoveragePct",
    "snapshot.accessibility.ariaNameCoveragePct",
    "metrics.ariaNameCoveragePct",
  ]);

  const formLabelCov = pickNumberFromPaths(summaryRoot, [
    "a11y.rollup.formLabelCoveragePct",
    "a11y.rollup.form_label_coverage_pct",
    "a11y.rollup.inputsWithLabelPct",
    "a11y.rollup.labelCoveragePct",
    "a11y.rollup.formLabelsCoveragePct",
    "a11y.formLabelCoveragePct",
    "accessibility.rollup.formLabelCoveragePct",
    "accessibility.formLabelCoveragePct",
    "diagnostics.a11y.formLabelCoveragePct",
    "snapshot.accessibility.formLabelCoveragePct",
    "metrics.formLabelCoveragePct",
  ]);

  const langCov = pickNumberFromPaths(summaryRoot, [
    "a11y.rollup.langCoveragePct",
    "a11y.rollup.lang_coverage_pct",
    "a11y.rollup.documentLangCoveragePct",
    "a11y.rollup.documentLanguageCoveragePct",
    "a11y.langCoveragePct",
    "accessibility.rollup.langCoveragePct",
    "accessibility.langCoveragePct",
    "diagnostics.a11y.langCoveragePct",
    "snapshot.accessibility.langCoveragePct",
    "snapshot.langCoveragePct",
    "metrics.langCoveragePct",
  ]);

  const skipLinkCov = pickNumberFromPaths(summaryRoot, [
    "a11y.rollup.skipLinkCoveragePct",
    "a11y.rollup.skip_link_coverage_pct",
    "a11y.rollup.skipLinkPct",
    "a11y.rollup.skipLinksCoveragePct",
    "a11y.skipLinkCoveragePct",
    "accessibility.rollup.skipLinkCoveragePct",
    "accessibility.skipLinkCoveragePct",
    "diagnostics.a11y.skipLinkCoveragePct",
    "snapshot.accessibility.skipLinkCoveragePct",
    "metrics.skipLinkCoveragePct",
  ]);

  const headingIntegrityPct = pickNumberFromPaths(summaryRoot, [
    "a11y.rollup.headingIntegrityIssuePct",
    "a11y.rollup.headingIntegrityPct",
    "a11y.rollup.headingIntegrity",
    "a11y.rollup.headingIssuePct",
    "a11y.headingIntegrityIssuePct",
    "accessibility.rollup.headingIntegrityIssuePct",
    "accessibility.headingIntegrityIssuePct",
    "diagnostics.a11y.headingIntegrityIssuePct",
    "snapshot.accessibility.headingIntegrityIssuePct",
  ]);

  const pagesObserved =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.pagesObserved",
      "a11y.rollup.pagesCount",
      "a11y.rollup.auditedPages",
      "a11y.rollup.inspectedPages",
      "a11y.pagesObserved",
      "a11y.pagesCount",
      "accessibility.rollup.pagesObserved",
      "accessibility.pagesObserved",
      "diagnostics.a11y.pagesObserved",
      "snapshot.accessibility.pagesObserved",
      "metrics.pagesObserved",
      "metrics.a11yPagesObserved",
      "metrics.a11yAudits30d",
    ]) ??
    (pages.length ? pages.length : null);

  const totalIssues =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.totalIssues",
      "a11y.rollup.issueCount",
      "a11y.rollup.issues",
      "a11y.rollup.total",
      "a11y.rollup.totalRows",
      "a11y.rollup.failCount",
      "a11y.totalIssues",
      "a11y.issues",
      "accessibility.totalIssues",
      "accessibility.issues",
      "diagnostics.a11y.issues",
      "metrics.a11yIssues30d",
      "metrics.a11yIssues",
    ]) ?? null;

  const missingAltCount =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.missingAltCount",
      "a11y.rollup.altMissing",
      "a11y.rollup.imagesMissingAlt",
      "a11y.rollup.imgAltMissing",
      "a11y.rollup.imageMissingAltCount",
      "a11y.missingAltCount",
      "accessibility.rollup.missingAltCount",
      "accessibility.missingAltCount",
      "diagnostics.a11y.missingAltCount",
      "snapshot.accessibilityPlus.imageMissingAltCount",
      "snapshot.accessibility.imageMissingAltCount",
      "metrics.missingAltCount",
    ]) ?? null;

  const unlabeledControlCount =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.unlabeledControlCount",
      "a11y.rollup.unlabeledControls",
      "a11y.rollup.controlsMissingName",
      "a11y.rollup.missingAccessibleNames",
      "a11y.unlabeledControlCount",
      "accessibility.rollup.unlabeledControlCount",
      "accessibility.unlabeledControlCount",
      "diagnostics.a11y.unlabeledControlCount",
      "snapshot.accessibilityPlus.missingAccessibleNames",
      "metrics.unlabeledControlCount",
    ]) ?? null;

  const missingFormLabelCount =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.missingFormLabelCount",
      "a11y.rollup.formsMissingLabels",
      "a11y.rollup.missingFormLabels",
      "a11y.rollup.inputsMissingLabel",
      "a11y.missingFormLabelCount",
      "accessibility.rollup.missingFormLabelCount",
      "accessibility.missingFormLabelCount",
      "diagnostics.a11y.missingFormLabelCount",
      "snapshot.accessibilityPlus.missingFormLabels",
      "metrics.missingFormLabelCount",
    ]) ?? null;

  const missingLangCount =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.missingLangCount",
      "a11y.rollup.missingLang",
      "a11y.rollup.docLangMissing",
      "a11y.missingLangCount",
      "accessibility.rollup.missingLangCount",
      "accessibility.missingLangCount",
      "diagnostics.a11y.missingLangCount",
      "metrics.missingLangCount",
    ]) ?? null;

  const headingSkipCount =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.headingSkipCount",
      "a11y.rollup.headingSkips",
      "a11y.rollup.headingStructureSkips",
      "a11y.rollup.headingLevelSkips",
      "a11y.headingSkipCount",
      "accessibility.rollup.headingSkipCount",
      "accessibility.headingSkipCount",
      "diagnostics.a11y.headingSkipCount",
      "snapshot.accessibilityPlus.headingSkipCount",
      "snapshot.accessibilityPlus.headingLevelSkips",
      "metrics.headingSkipCount",
    ]) ?? null;

  const multipleH1Count =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.multipleH1Count",
      "a11y.rollup.multiH1",
      "a11y.rollup.h1Multiple",
      "a11y.multipleH1Count",
      "accessibility.rollup.multipleH1Count",
      "accessibility.multipleH1Count",
      "diagnostics.a11y.multipleH1Count",
      "metrics.multipleH1Count",
    ]) ?? null;

  const missingSkipLinkCount =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.missingSkipLinkCount",
      "a11y.rollup.skipLinkMissing",
      "a11y.rollup.skipLinkMissingCount",
      "a11y.missingSkipLinkCount",
      "accessibility.rollup.missingSkipLinkCount",
      "accessibility.missingSkipLinkCount",
      "diagnostics.a11y.missingSkipLinkCount",
      "metrics.missingSkipLinkCount",
    ]) ?? null;

  const contrastFailCount =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.contrastFailCount",
      "a11y.rollup.contrastFails",
      "a11y.rollup.contrastIssues",
      "a11y.rollup.contrastFailureCount",
      "a11y.contrastFailCount",
      "a11y.contrastFailures",
      "accessibility.rollup.contrastFailCount",
      "accessibility.contrastFailCount",
      "accessibility.contrastFailures",
      "diagnostics.a11y.contrastFailCount",
      "diagnostics.a11y.contrastFailures",
      "metrics.contrastFailCount",
      "metrics.contrastFailures30d",
    ]) ??
    pickArrayCountFromPaths(summaryRoot, [
      "a11y.rollup.contrastFailures",
      "a11y.contrastFailures",
      "accessibility.rollup.contrastFailures",
      "accessibility.contrastFailures",
      "diagnostics.a11y.contrastFailures",
      "snapshot.accessibility.contrastFailures",
      "snapshot.accessibilityPlus.contrastFailures",
    ]);

  const focusFailCount =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.focusFailCount",
      "a11y.rollup.focusFails",
      "a11y.rollup.focusIssues",
      "a11y.rollup.focusOutlineRemovedCount",
      "a11y.focusFailCount",
      "a11y.focusWarnings",
      "accessibility.rollup.focusFailCount",
      "accessibility.focusFailCount",
      "accessibility.focusWarnings",
      "diagnostics.a11y.focusFailCount",
      "diagnostics.a11y.focusWarnings",
      "metrics.focusFailCount",
      "metrics.focusInvisible30d",
    ]) ??
    pickArrayCountFromPaths(summaryRoot, [
      "a11y.rollup.focusWarnings",
      "a11y.focusWarnings",
      "accessibility.rollup.focusWarnings",
      "accessibility.focusWarnings",
      "diagnostics.a11y.focusWarnings",
      "snapshot.accessibility.focusWarnings",
    ]);

  const auditsObserved = pickNumberFromPaths(summaryRoot, [
    "a11y.rollup.audits",
    "a11y.audits",
    "accessibility.rollup.audits",
    "accessibility.audits",
    "metrics.a11yAudits30d",
    "metrics.a11yAudits",
  ]);

  const contrastFailPct =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.contrastFailPct",
      "a11y.rollup.contrastIssuesPct",
      "a11y.rollup.contrastPct",
      "a11y.rollup.contrastFailurePct",
      "a11y.contrastFailPct",
      "accessibility.rollup.contrastFailPct",
      "accessibility.contrastFailPct",
      "diagnostics.a11y.contrastFailPct",
      "snapshot.accessibility.contrastFailPct",
      "metrics.contrastFailPct",
    ]) ??
    (contrastFailCount != null && auditsObserved != null && auditsObserved > 0
      ? clamp((contrastFailCount / auditsObserved) * 100, 0, 100)
      : null);

  const focusFailPct =
    pickNumberFromPaths(summaryRoot, [
      "a11y.rollup.focusFailPct",
      "a11y.rollup.focusIssuesPct",
      "a11y.rollup.focusPct",
      "a11y.rollup.focusFailurePct",
      "a11y.focusFailPct",
      "accessibility.rollup.focusFailPct",
      "accessibility.focusFailPct",
      "diagnostics.a11y.focusFailPct",
      "snapshot.accessibility.focusFailPct",
      "metrics.focusFailPct",
    ]) ??
    (focusFailCount != null && auditsObserved != null && auditsObserved > 0
      ? clamp((focusFailCount / auditsObserved) * 100, 0, 100)
      : null);

  const normalizedHeadingIntegrityPct =
    headingIntegrityPct ??
    (headingSkipCount != null && pagesObserved != null && pagesObserved > 0
      ? clamp((((headingSkipCount ?? 0) + (multipleH1Count ?? 0)) / pagesObserved) * 100, 0, 100)
      : null);

  const sampleLang =
    pickStringFromPaths(summaryRoot, [
      "a11y.rollup.sampleLang",
      "a11y.sampleLang",
      "a11y.rollup.documentLangSample",
      "accessibility.rollup.sampleLang",
      "accessibility.sampleLang",
      "snapshot.accessibility.sampleLang",
      "snapshot.accessibility.documentLangSample",
      "snapshot.lang",
      "metrics.sampleLang",
    ]) ?? null;

  const sampleSkipLink =
    pickBoolFromPaths(summaryRoot, [
      "a11y.rollup.sampleSkipLink",
      "a11y.rollup.skipLinkPresentSample",
      "a11y.sampleSkipLink",
      "a11y.skipLinkPresentSample",
      "accessibility.rollup.sampleSkipLink",
      "accessibility.sampleSkipLink",
      "snapshot.accessibility.sampleSkipLink",
      "snapshot.accessibility.skipLinkPresentSample",
      "snapshot.accessibility.skipLinkFound",
      "snapshot.skipLinkPresent",
      "metrics.sampleSkipLink",
    ]) ?? null;

  return {
    updatedAtISO,
    pagesObserved,
    a11yScore: nOrNull(scoreRaw),
    altTextCoveragePct: nOrNull(altCov),
    ariaNameCoveragePct: nOrNull(ariaNameCov),
    formLabelCoveragePct: nOrNull(formLabelCov),
    langCoveragePct: nOrNull(langCov),
    skipLinkCoveragePct: nOrNull(skipLinkCov),
    headingIntegrityIssuePct: nOrNull(normalizedHeadingIntegrityPct),
    contrastFailPct: nOrNull(contrastFailPct),
    focusFailPct: nOrNull(focusFailPct),
    totalIssues,
    missingAltCount,
    unlabeledControlCount,
    missingFormLabelCount,
    missingLangCount,
    headingSkipCount,
    multipleH1Count,
    missingSkipLinkCount,
    contrastFailCount,
    focusFailCount,
    sampleLang,
    sampleSkipLink,
    pages,
  };
}
/* =========================
  Tone + posture (bad=red, ok=lime, good=blue)
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
function toneFromScore(score: number | null): Tone {
  if (score == null) return "ok";
  if (score >= 92) return "good";
  if (score >= 80) return "ok";
  return "bad";
}

function postureLabel(a11y: A11yPayload): { label: string; tone: Tone } {
  const score = a11y.a11yScore ?? null;

  const alt = a11y.altTextCoveragePct ?? null;
  const names = a11y.ariaNameCoveragePct ?? null;
  const labels = a11y.formLabelCoveragePct ?? null;
  const lang = a11y.langCoveragePct ?? null;
  const skip = a11y.skipLinkCoveragePct ?? null;

  const headingIssue = a11y.headingIntegrityIssuePct ?? null;
  const contrastFail = a11y.contrastFailPct ?? null;
  const focusFail = a11y.focusFailPct ?? null;

  if (score != null) {
    if (score >= 92) return { label: "Elite", tone: "good" };
    if (score >= 80) return { label: "Stable", tone: "ok" };
    if (score >= 65) return { label: "At Risk", tone: "bad" };
    return { label: "Critical", tone: "bad" };
  }

  const covOk =
    (alt ?? 0) >= 95 &&
    (names ?? 0) >= 90 &&
    (labels ?? 0) >= 90 &&
    (lang ?? 0) >= 98 &&
    (skip ?? 0) >= 90;

  const lowRisk = (headingIssue ?? 0) <= 1 && (contrastFail ?? 0) <= 1 && (focusFail ?? 0) <= 1;

  if (covOk && lowRisk) return { label: "Elite", tone: "good" };
  if ((alt ?? 0) >= 85 && (names ?? 0) >= 80 && (labels ?? 0) >= 80 && (contrastFail ?? 0) <= 5) return { label: "Stable", tone: "ok" };
  if ((alt ?? 0) >= 70 && (labels ?? 0) >= 70) return { label: "At Risk", tone: "bad" };
  return { label: "Critical", tone: "bad" };
}

function issueChips(row: A11yPageRow) {
  const chips: string[] = [];

  if ((row.missingAltCount ?? 0) > 0) chips.push("Missing alt");
  if ((row.unlabeledControlCount ?? 0) > 0) chips.push("Unlabeled control");
  if ((row.missingFormLabelCount ?? 0) > 0) chips.push("Missing form label");
  if ((row.missingLangCount ?? 0) > 0) chips.push("Missing lang");
  if ((row.headingSkipCount ?? 0) > 0) chips.push("Heading skip");
  if ((row.multipleH1Count ?? 0) > 0) chips.push("Multiple H1");
  if ((row.missingSkipLinkCount ?? 0) > 0) chips.push("Missing skip link");
  if ((row.contrastFailCount ?? 0) > 0) chips.push("Contrast fail");
  if ((row.focusFailCount ?? 0) > 0) chips.push("Focus fail");

  if (Array.isArray(row.issues)) chips.push(...row.issues.slice(0, 6));

  return chips.slice(0, 8);
}

export default async function A11yPage({ searchParams }: PageProps) {
  noStore();
  const sp = await searchParams;
  const requestHeaders = await headers();

  const req = new Request("https://cavbot.local/a11y", {
    headers: new Headers(requestHeaders),
  });

  const gate = await gateModuleAccess(req, "a11y");

  if (!gate.ok) {
    return (
      <AppShell title="Workspace" subtitle="Workspace command center">
        <LockedModule
          moduleName="Accessibility Intelligence"
          description="WCAG posture, audit coverage, contrast and focus visibility signals across your monitored targets."
          requiredPlanLabel="Premium+"
        />
      </AppShell>
    );
  }

  const range = (typeof sp?.range === "string" ? sp.range : "24h") as RangeKey;


  let ws: LooseWorkspace | null = null;
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
  let a11y: A11yPayload = {};

  try {
    summary = await getProjectSummary(projectId, {
      range: range === "30d" ? "30d" : "7d",
      siteOrigin: activeSite.url || undefined,
    });
    a11y = normalizeA11yFromSummary(summary);
  } catch {
    summary = null;
    a11y = {};
  }

  function hrefWith(next: Partial<{ range: RangeKey; site: string }>) {
    const p = new URLSearchParams();
    p.set("module", "a11y");
    p.set("projectId", projectId);
    p.set("range", next.range || range);
    const siteId = next.site || activeSite.id;
    if (siteId && siteId !== "none") p.set("siteId", siteId);
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  const posture = postureLabel(a11y);

  const LIVE_TZ = "America/Los_Angeles";

  const pages = (a11y.pages || []).slice(0, 28);

  const scoreTone = toneFromScore(a11y.a11yScore ?? null);

  const altTone = toneFromCoveragePct(a11y.altTextCoveragePct ?? null);
  const nameTone = toneFromCoveragePct(a11y.ariaNameCoveragePct ?? null);
  const labelTone = toneFromCoveragePct(a11y.formLabelCoveragePct ?? null);
  const langTone = toneFromCoveragePct(a11y.langCoveragePct ?? null);
  const skipTone = toneFromCoveragePct(a11y.skipLinkCoveragePct ?? null);

  const headingTone = toneFromIssuePct(a11y.headingIntegrityIssuePct ?? null);
  const contrastTone = toneFromIssuePct(a11y.contrastFailPct ?? null);
  const focusTone = toneFromIssuePct(a11y.focusFailPct ?? null);

  return (
    <AppShell title="Workspace" subtitle="Workspace command center">
      <div className="a11y-page err-page">
        <div className="cb-console">
         
          {/* HEADER */}
          <header className="a11y-head">
            <div className="a11y-head-left">
              <div className="a11y-titleblock">
                <h1 className="a11y-h1">A11y Snapshot</h1>
                <p className="a11y-sub">WCAG posture, audit coverage, contrast and focus visibility signals.</p>
              </div>
            </div>

            <div className="a11y-head-right" aria-label="Controls">
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
          <br /><br /><br /><br />
          <main className="a11y-main">
            {/* HERO METRICS */}
            <section className="a11y-grid a11y-section" aria-label="Accessibility rollups">
              <article className={`cb-card tone-${posture.tone}`}>
                <div className="cb-card-top">
                  <div className="cb-card-label">Pages Observed</div>
                  <div className="cb-card-metric">{fmtInt(a11y.pagesObserved)}</div>
                </div>
                <br />
                <div className="cb-card-sub">Distinct pages seen in real traffic and evaluated for accessibility signals.</div>
              </article>

              <article className={`cb-card tone-${scoreTone}`}>
                <div className="cb-card-top">
                  <div className="cb-card-label">A11y Score</div>
                  <div className="cb-card-metric">{fmtScore(a11y.a11yScore)}</div>
                </div>
                <br />
                <div className="cb-card-sub">Rollup score (when available). If this is blank, collection is still warming up.</div>
              </article>

              <article className={`cb-card tone-${toneFromIssuePct(null)}`}>
                <div className="cb-card-top">
                  <div className="cb-card-label">Total Issues</div>
                  <div className="cb-card-metric">{fmtInt(a11y.totalIssues)}</div>
                </div>
                <br />
                <div className="cb-card-sub">Total findings across observed pages for the selected range and target.</div>
              </article>

              <article className={`cb-card tone-${contrastTone}`}>
                <div className="cb-card-top">
                  <div className="cb-card-label">Contrast Fail Rate</div>
                  <div className="cb-card-metric">{fmtPct(a11y.contrastFailPct)}</div>
                </div>
                <br />
                <div className="cb-card-sub">Percent of observed pages with detected contrast failures (when enabled).</div>
              </article>
            </section>
            <br /><br />

            {/* COVERAGE + INTEGRITY */}
            <section className="a11y-split a11y-section" aria-label="Coverage and integrity">
              <article className="cb-card cb-card-pad">
                <div className="cb-card-head">
                  <div>
                    <h2 className="cb-h2">Audit Coverage</h2>
                    <p className="cb-sub">Core signals that protect real users: images, names, labels, language, skip links.</p>
                  </div>
                </div>

                <div className="a11y-mini-grid a11y-coverage-grid">
                  <div className={`a11y-mini tone-${altTone}`}>
                    <div className="a11y-mini-k">Alt Text Coverage</div>
                    <div className="a11y-mini-v">{fmtPct(a11y.altTextCoveragePct)}</div>
                    <div className="a11y-mini-sub">{fmtInt(a11y.missingAltCount)} missing alt</div>
                  </div>

                  <div className={`a11y-mini tone-${nameTone}`}>
                    <div className="a11y-mini-k">Interactive Names</div>
                    <div className="a11y-mini-v">{fmtPct(a11y.ariaNameCoveragePct)}</div>
                    <div className="a11y-mini-sub">{fmtInt(a11y.unlabeledControlCount)} unlabeled controls</div>
                  </div>

                  <div className={`a11y-mini tone-${labelTone}`}>
                    <div className="a11y-mini-k">Form Labels</div>
                    <div className="a11y-mini-v">{fmtPct(a11y.formLabelCoveragePct)}</div>
                    <div className="a11y-mini-sub">{fmtInt(a11y.missingFormLabelCount)} inputs missing labels</div>
                  </div>

                  <div className={`a11y-mini tone-${langTone}`}>
                    <div className="a11y-mini-k">Document Language</div>
                    <div className="a11y-mini-v">{fmtPct(a11y.langCoveragePct)}</div>
                    <div className="a11y-mini-sub">{fmtInt(a11y.missingLangCount)} pages missing lang</div>
                  </div>

                  <div className={`a11y-mini tone-${skipTone}`}>
                    <div className="a11y-mini-k">Skip Link</div>
                    <div className="a11y-mini-v">{fmtPct(a11y.skipLinkCoveragePct)}</div>
                    <div className="a11y-mini-sub">{fmtInt(a11y.missingSkipLinkCount)} pages missing skip link</div>
                  </div>

                  <div className="a11y-mini">
                    <div className="a11y-mini-k">Sample Signals</div>
                    <div className="a11y-mini-v mono">{a11y.sampleLang || "—"}</div>
                    <div className="a11y-mini-sub">Lang sample · Skip link: {fmtBool(a11y.sampleSkipLink)}</div>
                  </div>
                </div>
              </article>

              <article className="cb-card cb-card-pad a11y-integrity-card">
                <div className="cb-card-head">
                  <div>
                    <h2 className="cb-h2">Integrity Signals</h2>
                    <p className="cb-sub">Structure, contrast, and focus visibility — the fast path to real accessibility wins.</p>
                  </div>
                </div>

                <div className="a11y-mini-grid a11y-mini-grid-3 a11y-integrity-grid">
                  <div className={`a11y-mini tone-${headingTone}`}>
                    <div className="a11y-mini-k">Heading Integrity</div>
                    <div className="a11y-mini-v">{fmtPct(a11y.headingIntegrityIssuePct)}</div>
                    <div className="a11y-mini-sub">
                      {fmtInt(a11y.headingSkipCount)} skips · {fmtInt(a11y.multipleH1Count)} multiple H1
                    </div>
                  </div>

                  <div className={`a11y-mini tone-${contrastTone}`}>
                    <div className="a11y-mini-k">Contrast</div>
                    <div className="a11y-mini-v">{fmtPct(a11y.contrastFailPct)}</div>
                    <div className="a11y-mini-sub">{fmtInt(a11y.contrastFailCount)} failures detected</div>
                  </div>

                  <div className={`a11y-mini tone-${focusTone}`}>
                    <div className="a11y-mini-k">Focus Visibility</div>
                    <div className="a11y-mini-v">{fmtPct(a11y.focusFailPct)}</div>
                    <div className="a11y-mini-sub">{fmtInt(a11y.focusFailCount)} failures detected</div>
                  </div>
                </div>
              </article>
            </section>
            <br /><br />

            {/* VOLUMES */}
            <section className="cb-card cb-card-pad a11y-section" aria-label="Accessibility volumes">
              <div className="cb-card-head a11y-headrow">
                <div>
                  <h2 className="cb-h2">Issue Volumes</h2>
                  <p className="cb-sub">Counts help you prioritize fixes that unlock the largest accessibility improvements first.</p>
                </div>
                <div className="a11y-pillrow">
                  <span className="a11y-pill">
                    Target: <b>{activeSite.label}</b>
                  </span>
                </div>
              </div>

              <div className="a11y-vol-grid">
                <div className="a11y-vol">
                  <div className="a11y-vol-k">Missing Alt</div>
                  <div className="a11y-vol-v">{fmtInt(a11y.missingAltCount)}</div>
                </div>
                <div className="a11y-vol">
                  <div className="a11y-vol-k">Unlabeled Controls</div>
                  <div className="a11y-vol-v">{fmtInt(a11y.unlabeledControlCount)}</div>
                </div>
                <div className="a11y-vol">
                  <div className="a11y-vol-k">Missing Form Labels</div>
                  <div className="a11y-vol-v">{fmtInt(a11y.missingFormLabelCount)}</div>
                </div>
                <div className="a11y-vol">
                  <div className="a11y-vol-k">Missing Lang</div>
                  <div className="a11y-vol-v">{fmtInt(a11y.missingLangCount)}</div>
                </div>
                <div className="a11y-vol">
                  <div className="a11y-vol-k">Heading Skips</div>
                  <div className="a11y-vol-v">{fmtInt(a11y.headingSkipCount)}</div>
                </div>
                <div className="a11y-vol">
                  <div className="a11y-vol-k">Multiple H1</div>
                  <div className="a11y-vol-v">{fmtInt(a11y.multipleH1Count)}</div>
                </div>
                <div className="a11y-vol">
                  <div className="a11y-vol-k">Missing Skip Link</div>
                  <div className="a11y-vol-v">{fmtInt(a11y.missingSkipLinkCount)}</div>
                </div>
                <div className="a11y-vol">
                  <div className="a11y-vol-k">Contrast Fails</div>
                  <div className="a11y-vol-v">{fmtInt(a11y.contrastFailCount)}</div>
                </div>
                <div className="a11y-vol">
                  <div className="a11y-vol-k">Focus Fails</div>
                  <div className="a11y-vol-v">{fmtInt(a11y.focusFailCount)}</div>
                </div>
              </div>
            </section>
            <br /><br />

            {/* PAGE AUDITS */}
            <section className="cb-card cb-card-pad a11y-section" aria-label="Page audits">
              <div className="cb-card-head a11y-headrow">
                <div>
                  <h2 className="cb-h2">Page Audits</h2>
                  <p className="cb-sub">Most recent observed pages with visible accessibility signals and issue chips.</p>
                </div>
                <div className="a11y-pillrow">
                  <span className="a11y-pill">
                    Showing: <b>{fmtInt(pages.length)}</b>
                  </span>
                </div>
              </div>

              {pages.length ? (
                <div className="a11y-tablewrap">
                  <table className="a11y-table" aria-label="Accessibility page audits table">
                    <thead>
                      <tr>
                        <th>Path</th>
                        <th className="t-right">Alt</th>
                        <th className="t-right">Names</th>
                        <th className="t-right">Labels</th>
                        <th className="t-right">Lang</th>
                        <th className="t-right">Headings</th>
                        <th className="t-right">Contrast</th>
                        <th className="t-right">Focus</th>
                        <th>Signals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pages.map((p, i) => {
                        const sigs = issueChips(p);
                        return (
                          <tr key={`${p.urlPath || "p"}-${i}`}>
                            <td className="mono">{p.urlPath || "—"}</td>
                            <td className="t-right">{fmtInt(p.missingAltCount)}</td>
                            <td className="t-right">{fmtInt(p.unlabeledControlCount)}</td>
                            <td className="t-right">{fmtInt(p.missingFormLabelCount)}</td>
                            <td className="t-right">{fmtInt(p.missingLangCount)}</td>
                            <td className="t-right">{fmtInt((p.headingSkipCount ?? 0) + (p.multipleH1Count ?? 0) || null)}</td>
                            <td className="t-right">{fmtInt(p.contrastFailCount)}</td>
                            <td className="t-right">{fmtInt(p.focusFailCount)}</td>
                            <td>
                              <div className="a11y-chips">
                                {sigs.length ? (
                                  sigs.map((s, idx) => (
                                    <span key={idx} className="a11y-chip-mini">
                                      {s}
                                    </span>
                                  ))
                                ) : (
                                  <span className="a11y-chip-mini tone-good">Clean</span>
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
                <div className="a11y-empty">
                  <div className="a11y-empty-title">No page rows available yet.</div>
                  <div className="a11y-empty-sub">
                    Once CavBot is ingesting real page views for this target, this table will populate with audited pages and findings.
                  </div>
                </div>
              )}
            </section>

            <CavAiRouteRecommendations
              panelId="a11y"
              snapshot={summary}
              origin={activeSite.url || ""}
              pagesScanned={a11y.pagesObserved ?? pages.length ?? 1}
              title="CavBot Accessibility Priorities"
              subtitle="Deterministic, evidence-linked accessibility actions for this target."
              pillars={["accessibility", "ux", "reliability"]}
            />
          </main>

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
          <Script id="cb-a11y-live-time" strategy="afterInteractive">
            {`
(function(){
  try{
    if(window.__cbA11yLiveTimeInt) clearInterval(window.__cbA11yLiveTimeInt);
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
  window.__cbA11yLiveTimeInt = setInterval(tick, 10000);
})();`}
          </Script>

          {/* Tools wiring (guarded) */}
          <Script id="cb-a11y-tools-wire" strategy="afterInteractive">
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

  // Hard safety: never start with tools modal visible on route entry.
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
      next.set("module", "a11y");
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

  // Rewire-safe handlers for client transitions.
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
    if(window.__cbA11yToolsEscHandler){
      document.removeEventListener("keydown", window.__cbA11yToolsEscHandler);
    }
    window.__cbA11yToolsEscHandler = function(e){ try{ if(e.key === "Escape") close(); }catch(_e){} };
    document.addEventListener("keydown", window.__cbA11yToolsEscHandler);
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
