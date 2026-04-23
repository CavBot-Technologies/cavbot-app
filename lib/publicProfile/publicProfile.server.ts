import "server-only";

import { unstable_cache } from "next/cache";
import {
  findAccountById,
  findActiveProjectByIdForAccount,
  findMembershipsForUser,
  findPublicProfileUserByUsername,
  getAuthPool,
  pickPrimaryMembership,
} from "@/lib/authDb";
import { prisma } from "@/lib/prisma";
import { getTenantProjectSummary } from "@/lib/projectSummary.server";
import { resolvePlanIdFromTier, hasModule } from "@/lib/plans";
import { readCustomLinkUrlFallback } from "@/lib/profile/customLinkStore.server";
import {
  DEFAULT_PUBLIC_PROFILE_SETTINGS,
  readPublicProfileSettingsFallback,
  type PublicProfileSettings,
} from "@/lib/publicProfile/publicProfileSettingsStore.server";
import { getPublicArtifactViewCountsByPath } from "@/lib/publicProfile/publicArtifactViews.server";
import { isPublicStatusMode } from "@/lib/publicProfile/publicStatus";
import { buildOperationalHistoryViewModel, type OperationalHistoryVM } from "@/lib/publicProfile/operationalHistory.server";

type Tone = "good" | "ok" | "bad" | "neutral";

type RawDb = {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...params: unknown[]) => Promise<T>;
};

function tierDisplayNameFromTier(rawTier: unknown): string | null {
  const s = String(rawTier ?? "").trim();
  if (!s) return null;
  const planId = resolvePlanIdFromTier(s);
  if (planId === "free") return "CavTower";
  if (planId === "premium") return "CavControl";
  return "CavElite"; // premium_plus
}

function decodeCustomLinkUrls(raw: unknown): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  try {
    if (s.startsWith("[")) {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        const out = parsed
          .map((x) => String(x ?? "").trim())
          .filter(Boolean);
        return Array.from(new Set(out)).slice(0, 6);
      }
    }
  } catch {}
  return [s];
}

type PublicUserRow = {
  id: string;
  username: string | null;
  email?: string | null;
  displayName: string | null;
  fullName: string | null;
  bio: string | null;
  companySubcategory?: string | null;
  country?: string | null;
  region?: string | null;
  githubUrl?: string | null;
  instagramUrl?: string | null;
  linkedinUrl?: string | null;
  customLinkUrl?: string | null;
  showCavbotProfileLink?: boolean | null;
  avatarTone: string | null;
  avatarImage: string | null;
  publicProfileEnabled?: boolean | null;
  publicShowReadme?: boolean | null;
  publicShowWorkspaceSnapshot?: boolean | null;
  publicShowHealthOverview?: boolean | null;
  publicShowCapabilities?: boolean | null;
  publicShowArtifacts?: boolean | null;
  publicShowPlanTier?: boolean | null;
  publicShowBio?: boolean | null;
  publicShowIdentityLinks?: boolean | null;
  publicShowIdentityLocation?: boolean | null;
  publicShowIdentityEmail?: boolean | null;
  publicWorkspaceId?: string | number | null;

  publicStatusEnabled?: boolean | null;
  publicStatusMode?: string | null;
  publicStatusNote?: string | null;
  publicStatusUpdatedAt?: Date | string | null;

  showStatusOnPublicProfile?: boolean | null;
  userStatus?: string | null;
  userStatusNote?: string | null;
  userStatusUpdatedAt?: Date | string | null;
};

function publicProfileSettingsFromUserRow(row: PublicUserRow | null): PublicProfileSettings {
  return {
    publicProfileEnabled: typeof row?.publicProfileEnabled === "boolean" ? Boolean(row.publicProfileEnabled) : true,
    publicShowReadme:
      typeof (row as { publicShowReadme?: unknown } | null)?.publicShowReadme === "boolean"
        ? Boolean((row as { publicShowReadme?: unknown }).publicShowReadme)
        : true,
    publicShowWorkspaceSnapshot:
      typeof row?.publicShowWorkspaceSnapshot === "boolean" ? Boolean(row.publicShowWorkspaceSnapshot) : true,
    publicShowHealthOverview:
      typeof row?.publicShowHealthOverview === "boolean" ? Boolean(row.publicShowHealthOverview) : true,
    publicShowCapabilities:
      typeof row?.publicShowCapabilities === "boolean" ? Boolean(row.publicShowCapabilities) : true,
    publicShowArtifacts:
      typeof row?.publicShowArtifacts === "boolean" ? Boolean(row.publicShowArtifacts) : true,
    publicShowPlanTier:
      typeof row?.publicShowPlanTier === "boolean" ? Boolean(row.publicShowPlanTier) : true,
    publicShowBio: typeof row?.publicShowBio === "boolean" ? Boolean(row.publicShowBio) : true,
    publicShowIdentityLinks:
      typeof row?.publicShowIdentityLinks === "boolean" ? Boolean(row.publicShowIdentityLinks) : true,
    publicShowIdentityLocation:
      typeof row?.publicShowIdentityLocation === "boolean" ? Boolean(row.publicShowIdentityLocation) : true,
    publicShowIdentityEmail:
      typeof row?.publicShowIdentityEmail === "boolean" ? Boolean(row.publicShowIdentityEmail) : false,
    publicWorkspaceId: row?.publicWorkspaceId != null ? String(row.publicWorkspaceId) : null,
  };
}

export type PublicProfilePosture = {
  label: string;
  tone: Tone;
};

export type PublicCapabilityItem = {
  id: string;
  label: string;
  description: string;
  stateLabel: string;
  tone: Tone;
};

export type PublicArtifactRow = {
  id: string;
  title: string;
  type: string;
  publishedAtISO: string;
  viewCount: number;
};

type PublicProfileDetailKind = "cavbot" | "github" | "instagram" | "linkedin" | "link" | "location" | "email";

export type PublicProfileDetailRow = {
  kind: PublicProfileDetailKind;
  label: string;
  value: string;
  href: string | null;
};

export type PublicProfileVisibility = "public" | "private";

export type PublicProfileConfig = {
  showReadme: boolean;
  showWorkspaceSnapshot: boolean;
  showHealthOverview: boolean;
  showCapabilities: boolean;
  showArtifacts: boolean;
  showPlanTier: boolean;
  showBio: boolean;
  showIdentityLinks: boolean;
  showIdentityLocation: boolean;
  showIdentityEmail: boolean;
};

export type PublicProfileViewModel = {
  visibility: PublicProfileVisibility;
  config: PublicProfileConfig;
  username: string;
  displayName: string;
  isPremiumPlus: boolean;
  bio: string | null;
  avatar: { tone: string | null; image: string | null; initials: string };

  status:
    | null
    | {
        mode: string;
        note: string | null;
        updatedAtISO: string | null;
        updatedRelative: string;
      };

  readme:
    | null
    | {
        markdown: string;
        updatedAtISO: string | null;
        isDefault: boolean;
        revision: number;
      };

  cta: { href: string; label: string } | null;

  identity: {
    details: PublicProfileDetailRow[];
    descriptor: string | null;
  };

	  sections: {
	    workspaceSnapshot:
	      | null
	      | {
	          workspaceName: string;
	          monitoredSitesCount: number | null;
	          planTierLabel: string | null;
	          status: PublicProfilePosture;
	        };
	    healthOverview:
	      | null
	      | {
	          entitlements: {
	            insights: boolean;
	            errors: boolean;
	            seo: boolean;
	            a11y: boolean;
	          };
	          guardian: PublicProfilePosture;
	          guardianScore: number | null;
	          coverage: PublicProfilePosture;
	          performance: PublicProfilePosture;
	          accessibility: PublicProfilePosture;
	          routing: PublicProfilePosture;
	          reliability: PublicProfilePosture;
	          errors: PublicProfilePosture;
	          seo: PublicProfilePosture;
	          updatedRelative: string;
	        };
	    operationalHistory: null | OperationalHistoryVM;
	    capabilities:
	      | null
	      | {
	          activeCount: number;
	          totalCount: number;
	          modules: PublicCapabilityItem[];
	        };
	    artifacts: null | { items: PublicArtifactRow[] };
	  };

  trust: {
    lastVerifiedRelative: string;
  };
};

type MaybeRecord = Record<string, unknown>;

function isRecord(v: unknown): v is MaybeRecord {
  return typeof v === "object" && v !== null;
}

function childRecord(obj: unknown, key: string): MaybeRecord | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return isRecord(v) ? v : null;
}

function firstRecord(...candidates: unknown[]): MaybeRecord | null {
  for (const c of candidates) {
    if (isRecord(c)) return c;
  }
  return null;
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = String(path || "")
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  let cur: unknown = obj;
  for (const k of parts) {
    if (!isRecord(cur)) return undefined;
    cur = (cur as MaybeRecord)[k];
  }
  return cur;
}

function pickNumber(summary: unknown, paths: string[]): number | null {
  for (const p of paths) {
    const v = getByPath(summary, p);
    const n = nOrNull(v);
    if (n != null) return n;
  }
  return null;
}

function nOrNull(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function parseWorkspaceProjectId(raw: unknown): number | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  if (!/^[0-9]{1,10}$/.test(v)) return null;
  const id = Number.parseInt(v, 10);
  if (!Number.isFinite(id)) return null;
  return id;
}

function safeISO(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function relativeAgeFromISO(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const diff = Math.max(0, Date.now() - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function computeInitials(name: string): string {
  const s = String(name || "").trim();
  if (!s) return "";
  const parts = s.split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] || "").toUpperCase();
  const b = (parts[1]?.[0] || "").toUpperCase();
  const c = (parts[2]?.[0] || "").toUpperCase();
  return (a + b + c).slice(0, 3);
}

function posture(label: string, tone: Tone): PublicProfilePosture {
  return { label, tone };
}

const DEFAULT_PROFILE_README_MAX_BYTES = 64 * 1024;

function clampUtf8Bytes(input: string, maxBytes: number) {
  const s = String(input ?? "");
  const bytes = Buffer.byteLength(s, "utf8");
  if (bytes <= maxBytes) return s;

  // Cheap truncation. This should only happen for abusive inputs.
  let end = s.length;
  while (end > 0 && Buffer.byteLength(s.slice(0, end), "utf8") > maxBytes) end = Math.floor(end * 0.9);
  while (end > 0 && Buffer.byteLength(s.slice(0, end), "utf8") > maxBytes) end--;
  return s.slice(0, end);
}

export function buildDefaultPublicProfileReadme(opts: {
  displayName: string;
  monitoredSitesCount: number | null;
  updatedRelative: string | null;
}) {
  const displayName = String(opts.displayName || "CavBot").trim() || "CavBot";
  const sites =
    typeof opts.monitoredSitesCount === "number" && Number.isFinite(opts.monitoredSitesCount)
      ? String(Math.max(0, Math.floor(opts.monitoredSitesCount)))
      : "—";
  const updated = String(opts.updatedRelative || "").trim() || "—";

  const md = [
    `# ${displayName}`,
    ``,
    `CavBot workspace profile.`,
    ``,
    `## Overview`,
    `This workspace is used to monitor, analyze, and improve website reliability and performance.`,
    ``,
    `## Capabilities`,
    `- Route monitoring`,
    `- Error tracking and stability analysis`,
    `- SEO analysis`,
    `- 404 recovery and interaction tracking`,
    ``,
    `## Workspace`,
    `- Monitored sites: ${sites}`,
    `- Last data update: ${updated}`,
    ``,
    `This profile reflects live data from CavBot monitoring.`,
    `Only verified data is displayed.`,
    ``,
  ].join("\n");

  return clampUtf8Bytes(md, DEFAULT_PROFILE_README_MAX_BYTES);
}

type ReadmeRow = { markdown: string; updatedAt: Date | null; revision: number } | null;

async function readPublicProfileReadmeByUserId(userId: string): Promise<ReadmeRow> {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  try {
    const rows = await prisma.$queryRaw<Array<{ markdown: string | null; updatedAt: Date | null; revision: number | null }>>`
      SELECT "markdown", "updatedAt", "revision"
      FROM "PublicProfileReadme"
      WHERE "userId" = ${uid}
      LIMIT 1
    `;
    const r = rows?.[0];
    const md = String(r?.markdown ?? "").trim();
    if (!md) return null;
    const revisionRaw = Number(r?.revision);
    const revision =
      Number.isFinite(revisionRaw) && Number.isInteger(revisionRaw) && revisionRaw >= 0
        ? Math.trunc(revisionRaw)
        : 0;
    return { markdown: md, updatedAt: r?.updatedAt ?? null, revision };
  } catch {
    return null;
  }
}

function hasSeo(summary: unknown) {
  const r = isRecord(summary) ? summary : null;
  if (!r) return false;
  const metrics = childRecord(r, "metrics");
  return Boolean(
    r.seo ||
      r.seoIntelligence ||
      r.seoPosture ||
      childRecord(r.diagnostics, "seo") ||
      childRecord(r.guardian, "seo") ||
      childRecord(metrics, "seo") ||
      childRecord(metrics, "webVitals") ||
      childRecord(metrics, "vitals")
  );
}

function hasErrors(summary: unknown) {
  const r = isRecord(summary) ? summary : null;
  if (!r) return false;
  const metrics = childRecord(r, "metrics");
  return Boolean(
    r.errors ||
      r.errorIntelligence ||
      childRecord(r.diagnostics, "errors") ||
      childRecord(metrics, "errors") ||
      metrics?.jsErrors ||
      metrics?.apiErrors ||
      metrics?.views404
  );
}

function hasRoutes(summary: unknown) {
  const r = isRecord(summary) ? summary : null;
  if (!r) return false;
  const metrics = childRecord(r, "metrics");
  return Boolean(
    r.routes ||
      r.routesIntelligence ||
      childRecord(r.diagnostics, "routes") ||
      childRecord(r.guardian, "routes") ||
      childRecord(metrics, "routes") ||
      metrics?.routesMonitored ||
      metrics?.rate404Pct
  );
}

function hasA11y(summary: unknown) {
  const r = isRecord(summary) ? summary : null;
  if (!r) return false;
  const metrics = childRecord(r, "metrics");
  return (
    pickNumber(summary, [
      "a11y.issues",
      "a11y.totalIssues",
      "accessibility.issues",
      "diagnostics.a11y.issues",
      "metrics.a11yIssues30d",
      "metrics.a11yIssues",
    ]) != null ||
    Boolean(r.a11y || r.accessibility || childRecord(r.diagnostics, "a11y") || childRecord(metrics, "a11y"))
  );
}

function extractUpdatedAtISO(summary: unknown): string | null {
  const r = isRecord(summary) ? summary : null;
  if (!r) return null;
  const meta = childRecord(r, "meta");
  const metrics = childRecord(r, "metrics");
  return (
    safeISO(r.updatedAtISO) ||
    safeISO(r.updatedAt) ||
    safeISO(meta?.updatedAtISO) ||
    safeISO(meta?.updatedAt) ||
    safeISO(metrics?.updatedAtISO) ||
    safeISO(metrics?.updatedAt) ||
    null
  );
}

function normalizeSeoRollup(summary: unknown): {
  titleCoveragePct: number | null;
  descriptionCoveragePct: number | null;
  canonicalCoveragePct: number | null;
  noindexPct: number | null;
  missingH1Pct: number | null;
  thinContentPct: number | null;
} {
  const r = isRecord(summary) ? summary : null;
  const diag = firstRecord(r?.diagnostics, null);
  const guard = firstRecord(r?.guardian, null);
  const snap = firstRecord(r?.snapshot, null);
  const metrics = firstRecord(r?.metrics, null);

  const seo = firstRecord(
    r?.seo,
    r?.seoIntelligence,
    r?.seoPosture,
    diag?.seo,
    guard?.seo,
    snap?.seo,
    metrics?.seo,
    metrics?.seoPosture,
    null
  );
  const rollup = firstRecord(seo?.rollup, seo?.summary, seo?.totals, seo?.counts, seo, null);

  return {
    titleCoveragePct: nOrNull(rollup?.titleCoveragePct ?? rollup?.title_coverage_pct ?? rollup?.titleCoverage),
    descriptionCoveragePct: nOrNull(
      rollup?.descriptionCoveragePct ?? rollup?.description_coverage_pct ?? rollup?.metaDescriptionCoveragePct
    ),
    canonicalCoveragePct: nOrNull(rollup?.canonicalCoveragePct ?? rollup?.canonical_coverage_pct ?? rollup?.canonicalCoverage),
    noindexPct: nOrNull(rollup?.noindexPct ?? rollup?.noindex_pct ?? rollup?.noIndexPct),
    missingH1Pct: nOrNull(rollup?.missingH1Pct ?? rollup?.missing_h1_pct ?? rollup?.missingH1),
    thinContentPct: nOrNull(rollup?.thinContentPct ?? rollup?.thin_content_pct ?? rollup?.thinContent),
  };
}

function seoPosture(summary: unknown): PublicProfilePosture {
  const seo = normalizeSeoRollup(summary);
  const cov = seo.titleCoveragePct ?? 0;
  const desc = seo.descriptionCoveragePct ?? 0;
  const canon = seo.canonicalCoveragePct ?? 0;
  const noindex = seo.noindexPct ?? 0;
  const missingH1 = seo.missingH1Pct ?? 0;
  const thin = seo.thinContentPct ?? 0;

  const hasSignal =
    seo.titleCoveragePct != null ||
    seo.descriptionCoveragePct != null ||
    seo.canonicalCoveragePct != null ||
    seo.noindexPct != null ||
    seo.missingH1Pct != null ||
    seo.thinContentPct != null;

  if (!hasSignal) return posture("Waiting for telemetry", "neutral");

  const healthy = cov >= 85 && desc >= 80 && canon >= 80 && noindex <= 5 && missingH1 <= 5 && thin <= 10;
  if (healthy) return posture("Healthy", "good");
  const atRisk = cov >= 70 && desc >= 70 && noindex <= 10;
  if (atRisk) return posture("At Risk", "ok");
  return posture("Critical", "bad");
}

function normalizeErrorsTotals(summary: unknown): {
  jsErrors: number | null;
  apiErrors: number | null;
  views404: number | null;
  crashFreeSessionsPct: number | null;
} {
  const r = isRecord(summary) ? summary : null;
  const metrics = firstRecord(r?.metrics, null);
  const e =
    (r ? childRecord(r, "errors") : null) ||
    (r ? childRecord(r, "errorIntelligence") : null) ||
    (r ? childRecord(childRecord(r, "diagnostics"), "errors") : null) ||
    childRecord(metrics, "errors") ||
    null;

  const totals = firstRecord(e?.totals, e?.summary, e?.counts, null);
  return {
    jsErrors: nOrNull(totals?.jsErrors ?? totals?.js ?? totals?.js_error ?? totals?.js_error_count ?? metrics?.jsErrors30d ?? metrics?.jsErrors),
    apiErrors: nOrNull(totals?.apiErrors ?? totals?.api ?? totals?.api_error ?? totals?.api_error_count ?? metrics?.apiErrors30d ?? metrics?.apiErrors),
    views404: nOrNull(totals?.views404 ?? totals?.views_404 ?? totals?.notFound ?? totals?.views404Count ?? metrics?.views404_24h ?? metrics?.views40430d ?? metrics?.views404),
    crashFreeSessionsPct: nOrNull(totals?.crashFreeSessionsPct ?? totals?.crashFreePct ?? totals?.crash_free ?? metrics?.crashFreeSessionsPct),
  };
}

function reliabilityPosture(summary: unknown): PublicProfilePosture {
  const t = normalizeErrorsTotals(summary);
  const c = t.crashFreeSessionsPct;
  if (c == null) return posture("Waiting for telemetry", "neutral");
  if (c >= 99) return posture("Stable", "good");
  if (c >= 97) return posture("At Risk", "ok");
  return posture("Critical", "bad");
}

function errorsPosture(summary: unknown): PublicProfilePosture {
  const t = normalizeErrorsTotals(summary);
  const c = t.crashFreeSessionsPct;
  if (c != null) {
    if (c >= 99) return posture("Low", "good");
    if (c >= 97) return posture("Moderate", "ok");
    return posture("Elevated", "bad");
  }

  const sum = (t.jsErrors ?? 0) + (t.apiErrors ?? 0) + (t.views404 ?? 0);
  const hasCounts = t.jsErrors != null || t.apiErrors != null || t.views404 != null;
  if (!hasCounts) return posture("Waiting for telemetry", "neutral");
  if (sum <= 25) return posture("Low", "good");
  if (sum <= 150) return posture("Moderate", "ok");
  return posture("Elevated", "bad");
}

function statusPostureFromWorkspace(opts: {
  monitoredSitesCount: number | null;
  updatedAtISO: string | null;
}): PublicProfilePosture {
  const sites = opts.monitoredSitesCount ?? 0;
  if (sites <= 0) return posture("Not configured", "neutral");
  const age = opts.updatedAtISO ? Date.now() - Date.parse(opts.updatedAtISO) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(age)) return posture("Idle", "ok");
  if (age <= 6 * 60 * 60 * 1000) return posture("Active monitoring", "good");
  if (age <= 48 * 60 * 60 * 1000) return posture("Idle", "ok");
  return posture("Idle", "ok");
}

const GUARDIAN_SCORE_PATHS = [
  "guardianScore",
  "metrics.guardianScore",
  "guardian.score",
  "guardian.summary.score",
  "snapshot.guardianScore",
  "diagnostics.guardianScore",
];

function guardianScore(summary: unknown): number | null {
  const score = pickNumber(summary, GUARDIAN_SCORE_PATHS);
  if (score == null) return null;
  return Math.max(0, Math.min(100, score));
}

function guardianPosture(summary: unknown): PublicProfilePosture {
  const score = guardianScore(summary);
  if (score == null) return posture("Waiting for telemetry", "neutral");
  if (score >= 85) return posture("Strong", "good");
  if (score >= 70) return posture("At Risk", "ok");
  return posture("Critical", "bad");
}

function coveragePosture(summary: unknown): PublicProfilePosture {
  const pct = pickNumber(summary, [
    "aggregationCoveragePercent",
    "metrics.aggregationCoveragePercent",
    "diagnostics.aggregationCoveragePercent",
    "snapshot.aggregationCoveragePercent",
  ]);
  if (pct == null) return posture("Waiting for telemetry", "neutral");
  if (pct >= 90) return posture("High", "good");
  if (pct >= 70) return posture("Moderate", "ok");
  return posture("Low", "bad");
}

function performancePosture(summary: unknown): PublicProfilePosture {
  const lcpP75Ms = pickNumber(summary, [
    "webVitals.rollup.lcpP75Ms",
    "vitals.rollup.lcpP75Ms",
    "performance.vitals.lcpP75Ms",
    "webVitals.lcpP75Ms",
    "metrics.lcpP75Ms",
    "metrics.avgLcpMs",
  ]);
  const inpP75Ms = pickNumber(summary, [
    "webVitals.rollup.inpP75Ms",
    "vitals.rollup.inpP75Ms",
    "performance.vitals.inpP75Ms",
    "webVitals.inpP75Ms",
    "metrics.inpP75Ms",
  ]);
  const clsP75 = pickNumber(summary, [
    "webVitals.rollup.clsP75",
    "vitals.rollup.clsP75",
    "performance.vitals.clsP75",
    "webVitals.clsP75",
    "metrics.clsP75",
    "metrics.globalCls",
  ]);

  const hasSignal = lcpP75Ms != null || inpP75Ms != null || clsP75 != null;
  if (!hasSignal) return posture("Waiting for telemetry", "neutral");

  const toneFor = (t: "good" | "ok" | "bad") => t;
  const lcpTone = lcpP75Ms == null ? null : lcpP75Ms <= 2500 ? toneFor("good") : lcpP75Ms <= 4000 ? toneFor("ok") : toneFor("bad");
  const inpTone = inpP75Ms == null ? null : inpP75Ms <= 200 ? toneFor("good") : inpP75Ms <= 500 ? toneFor("ok") : toneFor("bad");
  const clsTone = clsP75 == null ? null : clsP75 <= 0.1 ? toneFor("good") : clsP75 <= 0.25 ? toneFor("ok") : toneFor("bad");

  const tones = [lcpTone, inpTone, clsTone].filter((x): x is "good" | "ok" | "bad" => Boolean(x));
  if (!tones.length) return posture("Waiting for telemetry", "neutral");
  if (tones.includes("bad")) return posture("Critical", "bad");
  if (tones.includes("ok")) return posture("At Risk", "ok");
  return posture("Healthy", "good");
}

function accessibilityPosture(summary: unknown): PublicProfilePosture {
  const issues = pickNumber(summary, [
    "a11y.issues",
    "a11y.totalIssues",
    "accessibility.issues",
    "diagnostics.a11y.issues",
    "metrics.a11yIssues30d",
    "metrics.a11yIssues",
  ]);
  if (issues == null) return posture("Waiting for telemetry", "neutral");
  if (issues <= 0) return posture("Healthy", "good");
  if (issues <= 10) return posture("At Risk", "ok");
  return posture("Critical", "bad");
}

function routingPosture(summary: unknown): PublicProfilePosture {
  const rate404Pct = pickNumber(summary, [
    "rate404Pct",
    "metrics.rate404Pct",
    "diagnostics.rate404Pct",
    "snapshot.rate404Pct",
  ]);
  if (rate404Pct == null) return posture("Waiting for telemetry", "neutral");
  if (rate404Pct <= 1) return posture("Healthy", "good");
  if (rate404Pct <= 5) return posture("At Risk", "ok");
  return posture("Critical", "bad");
}

async function buildPublicProfileUncached(username: string): Promise<PublicProfileViewModel | null> {
  let user: PublicUserRow | null = null;
  let settings: PublicProfileSettings = { ...DEFAULT_PUBLIC_PROFILE_SETTINGS };
  const authPool = (() => {
    try {
      return getAuthPool();
    } catch {
      return null;
    }
  })();
  const readUserWithPublicSettings = async (opts: { includeLinkedin: boolean; includeCustomLink: boolean }) => {
    // NOTE: keep this `select` non-literal to avoid TS breakage if Prisma types are stale.
    const select: Record<string, boolean> = {
      id: true,
      username: true,
      email: true,
      displayName: true,
      fullName: true,
      bio: true,
      companySubcategory: true,
      country: true,
      region: true,
      githubUrl: true,
      instagramUrl: true,
      showCavbotProfileLink: true,
      avatarTone: true,
      avatarImage: true,

      publicProfileEnabled: true,
      publicShowReadme: true,
      publicShowWorkspaceSnapshot: true,
      publicShowHealthOverview: true,
      publicShowCapabilities: true,
      publicShowArtifacts: true,
      publicShowPlanTier: true,
      publicShowBio: true,
      publicShowIdentityLinks: true,
      publicShowIdentityLocation: true,
      publicShowIdentityEmail: true,
      publicWorkspaceId: true,

      showStatusOnPublicProfile: true,
      userStatus: true,
      userStatusNote: true,
      userStatusUpdatedAt: true,

      publicStatusEnabled: true,
      publicStatusMode: true,
      publicStatusNote: true,
      publicStatusUpdatedAt: true,
    };
    if (opts.includeLinkedin) select.linkedinUrl = true;
    if (opts.includeCustomLink) select.customLinkUrl = true;

    const row = (await prisma.user.findUnique({
      where: { username },
      select,
    })) as unknown as PublicUserRow | null;
    return { row, settings: publicProfileSettingsFromUserRow(row) };
  };

  if (authPool) {
    const authUser = await findPublicProfileUserByUsername(authPool, username).catch(() => null);
    if (authUser?.id && authUser.username) {
      user = authUser as unknown as PublicUserRow;
      settings = publicProfileSettingsFromUserRow(user);
    }
  }

  if (!user?.id || !user.username) {
    try {
      const res = await readUserWithPublicSettings({ includeLinkedin: true, includeCustomLink: true });
      user = res.row;
      settings = res.settings;
    } catch {
      // Migration safety: if the DB is missing one of the optional columns, retry without it.
      try {
        const res = await readUserWithPublicSettings({ includeLinkedin: true, includeCustomLink: false });
        user = res.row;
        settings = res.settings;
      } catch {
        try {
          const res = await readUserWithPublicSettings({ includeLinkedin: false, includeCustomLink: true });
          user = res.row;
          settings = res.settings;
        } catch {
          try {
            const res = await readUserWithPublicSettings({ includeLinkedin: false, includeCustomLink: false });
            user = res.row;
            settings = res.settings;
          } catch {
            // Dev bootstrap: DB public profile columns may not exist yet. Read settings from fallback store.
            const basicSelect: Record<string, boolean> = {
              id: true,
              username: true,
              email: true,
              displayName: true,
              fullName: true,
              bio: true,
              companySubcategory: true,
              country: true,
              region: true,
              githubUrl: true,
              instagramUrl: true,
              showCavbotProfileLink: true,
              avatarTone: true,
              avatarImage: true,
            };

            const basicSelectWithLinkedin: Record<string, boolean> = { ...basicSelect, linkedinUrl: true };

            const basicWithLinkedin = await prisma.user
              .findUnique({
                where: { username },
                select: basicSelectWithLinkedin,
              })
              .catch(() => null);

            const basic = (basicWithLinkedin ??
              (await prisma.user
                .findUnique({
                  where: { username },
                  select: basicSelect,
                })
                .catch(() => null))) as unknown as PublicUserRow | null;

            if (!basic?.id || !basic.username) return null;

            settings = await readPublicProfileSettingsFallback(prisma as unknown as RawDb, String(basic.id));
            user = basic as unknown as PublicUserRow;
          }
        }
      }
    }
  }

  if (!user?.id || !user.username) return null;

  const displayNameRaw = String(user.displayName || user.fullName || "").trim();
  const displayName = displayNameRaw || "CavBot Operator";
  // Keep avatar initials tied to actual profile identity, not the display fallback label.
  const initialsSource = String(user.displayName || user.fullName || user.username || "").trim();
  const initials = computeInitials(initialsSource) || computeInitials(user.username) || "CB";

  // Resolve the workspace account backing this profile snapshot.
  // Prefer the explicitly selected public workspace project when it exists.
  const preferredProjectId = parseWorkspaceProjectId(settings.publicWorkspaceId);
  let accountId =
    preferredProjectId != null
      ? (await prisma.project
          .findFirst({
            where: {
              id: preferredProjectId,
              isActive: true,
              account: {
                members: {
                  some: {
                    userId: user.id,
                  },
                },
              },
            },
            select: { accountId: true },
          })
          .then((row) => String(row?.accountId || "").trim())
          .catch(() => ""))
      : "";
  if (!accountId) {
    const membership = await prisma.membership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { accountId: true },
    }).catch(() => null);
    accountId = String(membership?.accountId || "").trim();
  }

  if (!accountId && authPool) {
    const memberships = await findMembershipsForUser(authPool, user.id).catch(() => []);

    if (preferredProjectId != null) {
      for (const membership of memberships) {
        const project = await findActiveProjectByIdForAccount(authPool, membership.accountId, preferredProjectId).catch(() => null);
        if (project?.id) {
          accountId = membership.accountId;
          break;
        }
      }
    }

    if (!accountId) {
      const ownerMembership = memberships
        .filter((membership) => membership.role === "OWNER")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
      const primaryMembership = pickPrimaryMembership(memberships);
      accountId = String(ownerMembership?.accountId || primaryMembership?.accountId || "").trim();
    }
  }

  let account: { name: string; tier: string } | null = null;
  let subscriptionTier: string | null = null;
  if (accountId) {
    account = await prisma.account
      .findUnique({
        where: { id: String(accountId) },
        select: { name: true, tier: true },
      })
      .catch(() => null);
    subscriptionTier =
      (await prisma.subscription
        .findFirst({
          where: {
            accountId: String(accountId),
            status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
          },
          orderBy: { updatedAt: "desc" },
          select: { tier: true },
        })
        .then((row) => {
          const tier = String(row?.tier || "").trim();
          return tier || null;
        })
        .catch(() => null)) || null;
  }
  if (!account && accountId && authPool) {
    const authAccount = await findAccountById(authPool, accountId).catch(() => null);
    if (authAccount) {
      account = {
        name: authAccount.name,
        tier: authAccount.tier,
      };
    }
  }
  const planTierToken = String(subscriptionTier || account?.tier || "FREE").trim() || "FREE";
  const planId = resolvePlanIdFromTier(planTierToken);
  const isPremiumPlus = planId === "premium_plus";

  // Private mode: profile exists, but no data is shared publicly.
  if (!settings.publicProfileEnabled) {
    const vm: PublicProfileViewModel = {
      visibility: "private",
      config: {
        showReadme: false,
        showWorkspaceSnapshot: false,
        showHealthOverview: false,
        showCapabilities: false,
        showArtifacts: false,
        showPlanTier: false,
        showBio: false,
        showIdentityLinks: false,
        showIdentityLocation: false,
        showIdentityEmail: false,
      },
      username: user.username,
      displayName,
      isPremiumPlus,
      bio: null,
      avatar: { tone: user.avatarTone, image: user.avatarImage, initials },
      status: null,
      readme: null,
      cta: null,
      identity: { details: [], descriptor: null },
      sections: { workspaceSnapshot: null, healthOverview: null, operationalHistory: null, capabilities: null, artifacts: null },
      trust: { lastVerifiedRelative: "—" },
    };
    return vm;
  }

  const config: PublicProfileConfig = {
    showReadme: settings.publicShowReadme !== false,
    showWorkspaceSnapshot: Boolean(settings.publicShowWorkspaceSnapshot),
    showHealthOverview: Boolean(settings.publicShowHealthOverview),
    showCapabilities: Boolean(settings.publicShowCapabilities),
    showArtifacts: Boolean(settings.publicShowArtifacts),
    showPlanTier: Boolean(settings.publicShowPlanTier),
    showBio: settings.publicShowBio !== false,
    showIdentityLinks: Boolean(settings.publicShowIdentityLinks),
    showIdentityLocation: Boolean(settings.publicShowIdentityLocation),
    showIdentityEmail: Boolean(settings.publicShowIdentityEmail),
  };

  const effectiveCustomLinkUrl = await (async () => {
    // Prefer fallback store (can hold multiple URLs and survives column lag).
    const fallback = await readCustomLinkUrlFallback(prisma as unknown as RawDb, String(user.id));
    if (fallback) return fallback;
    const s = typeof user.customLinkUrl === "string" ? user.customLinkUrl.trim() : "";
    return s ? s : null;
  })();

  const bio =
    config.showBio && user.bio && String(user.bio).trim()
      ? String(user.bio).trim()
      : null;

  const descriptorRaw = String(user.companySubcategory || "").trim();
  const descriptor = descriptorRaw ? descriptorRaw.slice(0, 96) : null;

  const status = (() => {
    const show =
      typeof user.showStatusOnPublicProfile === "boolean"
        ? Boolean(user.showStatusOnPublicProfile)
        : Boolean(user.publicStatusEnabled);
    if (!show) return null;

    const modeRaw = String(user.userStatus ?? user.publicStatusMode ?? "").trim();
    const mode = isPublicStatusMode(modeRaw) ? modeRaw : null;
    if (!mode) return null;

    const noteRaw = String(user.userStatusNote ?? user.publicStatusNote ?? "").trim();
    const note = noteRaw ? noteRaw.slice(0, 64) : null;

    const updatedAtISO = safeISO(user.userStatusUpdatedAt ?? user.publicStatusUpdatedAt) || null;
    const updatedRelative = updatedAtISO ? relativeAgeFromISO(updatedAtISO) : "—";
    return { mode, note, updatedAtISO, updatedRelative };
  })();

  const formatHref = (raw: string) => {
    const s = String(raw || "").trim();
    if (!s) return "";
    return /^https?:\/\//i.test(s) ? s : `https://${s}`;
  };
  const displayUrl = (raw: string) => String(raw || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");

  const identityDetails: PublicProfileDetailRow[] = [];
  if (config.showIdentityLinks) {
    const u = String(user.username || "").trim().toLowerCase();
    if (u) {
      identityDetails.push({
        kind: "cavbot",
        label: "CavBot",
        value: `app.cavbot.io/${u}`,
        href: `https://app.cavbot.io/${u}`,
      });
    }
    const gh = String(user.githubUrl || "").trim();
    if (gh) {
      identityDetails.push({
        kind: "github",
        label: "GitHub",
        value: displayUrl(gh),
        href: formatHref(gh),
      });
    }
    const ig = String(user.instagramUrl || "").trim();
    if (ig) {
      identityDetails.push({
        kind: "instagram",
        label: "Instagram",
        value: displayUrl(ig),
        href: formatHref(ig),
      });
    }
    const li = String(user.linkedinUrl || "").trim();
    if (li) {
      identityDetails.push({
        kind: "linkedin",
        label: "LinkedIn",
        value: displayUrl(li),
        href: formatHref(li),
      });
    }
    const urls = decodeCustomLinkUrls(effectiveCustomLinkUrl);
    urls.forEach((raw) => {
      const v = String(raw || "").trim();
      if (!v) return;
      identityDetails.push({
        kind: "link",
        label: "Website",
        value: displayUrl(v),
        href: formatHref(v),
      });
    });
  }
  if (config.showIdentityLocation) {
    const region = String(user.region || "").trim();
    const country = String(user.country || "").trim();
    const value = region || country;
    if (value) {
      identityDetails.push({
        kind: "location",
        label: "Location",
        value,
        href: null,
      });
    }
  }
  if (config.showIdentityEmail) {
    const em = String(user.email || "").trim();
    if (em) {
      identityDetails.push({
        kind: "email",
        label: "Email",
        value: em,
        href: `mailto:${em}`,
      });
    }
  }

  // Resolve project in the same tenant (never leak cross-tenant).
  let project: { id: number } | null = null;
  let monitoredSitesCount: number | null = null;
  let arcadeEnabled = false;

  if (accountId) {
    // Public profile needs the projectId even if encrypted keys aren't available on this environment.
    const projectRow = await prisma.project
      .findFirst({
        where: preferredProjectId
          ? { id: preferredProjectId, accountId: String(accountId), isActive: true }
          : { accountId: String(accountId), isActive: true },
        orderBy: preferredProjectId ? undefined : { createdAt: "asc" },
        select: { id: true, serverKeyEnc: true, serverKeyEncIv: true },
      })
      .catch(() => null);

    if (projectRow?.id != null) {
      project = {
        id: projectRow.id,
      };

      monitoredSitesCount = await prisma.site
        .count({
          where: { projectId: projectRow.id, isActive: true },
        })
        .catch(() => null);

      const arcade = await prisma.siteArcadeConfig
        .findFirst({
          where: { enabled: true, site: { projectId: projectRow.id, isActive: true } },
          select: { siteId: true },
        })
        .catch(() => null);
      arcadeEnabled = Boolean(arcade?.siteId);
    }
  }

  // Load summary (safe aggregates only). Fail closed and render "Waiting for telemetry" without inventing numbers.
  let summary: unknown = null;
  if (project && accountId) {
    try {
      summary = (await getTenantProjectSummary({
        accountId,
        projectId: project.id,
        range: "7d",
      })).summary;
    } catch {
      summary = null;
    }
  }

  // Operational history wants a longer memory window to decay entries naturally.
  let summary30d: unknown = null;
  if (project && accountId) {
    try {
      summary30d = (await getTenantProjectSummary({
        accountId,
        projectId: project.id,
        range: "30d",
      })).summary;
    } catch {
      summary30d = null;
    }
  }

  const updatedAtISO = extractUpdatedAtISO(summary);
  const updatedRelative = updatedAtISO ? relativeAgeFromISO(updatedAtISO) : "Waiting for telemetry";

  const allowErrors = hasModule(planId, "errors");
  const allowSeo = hasModule(planId, "seo");
  const allowA11y = hasModule(planId, "a11y");
  const allowInsights = hasModule(planId, "insights");
  const allowControlRoom = planId === "premium_plus" || arcadeEnabled;

  type CapabilityEntitlement = "always" | "control-room" | "errors" | "seo" | "a11y" | "insights";
  type CapabilityCatalogEntry = {
    id: string;
    label: string;
    description: string;
    entitlement: CapabilityEntitlement;
  };

  // Single source-of-truth for workspace module cards and entitlement gates.
  const CAPABILITY_CATALOG = [
    {
      id: "routes",
      label: "Routes Intelligence",
      description: "Route topology, crawl reliability, and 404 pressure across monitored paths.",
      entitlement: "always",
    },
    {
      id: "reliability",
      label: "Reliability Monitoring",
      description: "Crash-free session posture and live stability rollups for monitored surfaces.",
      entitlement: "always",
    },
    {
      id: "control-room",
      label: "404 Control Room",
      description: "Operational 404 remediation surface and redirect recovery command layer.",
      entitlement: "control-room",
    },
    {
      id: "errors",
      label: "Error Intelligence",
      description: "JS/API/404 fault classification, trend rollups, and incident surfacing.",
      entitlement: "errors",
    },
    {
      id: "seo",
      label: "SEO Intelligence",
      description: "Indexability, metadata coverage, canonical integrity, and content posture.",
      entitlement: "seo",
    },
    {
      id: "a11y",
      label: "Accessibility Intelligence",
      description: "Accessibility issue tracking and remediation posture for monitored experiences.",
      entitlement: "a11y",
    },
    {
      id: "insights",
      label: "Guardian Insights",
      description: "Weighted cross-signal posture from performance, routing, reliability, and SEO.",
      entitlement: "insights",
    },
    {
      id: "telemetry-stream",
      label: "Telemetry Stream",
      description: "Live ingest stream that powers capability posture and public health rollups.",
      entitlement: "always",
    },
  ] as const satisfies readonly CapabilityCatalogEntry[];

  const isEntitledForCapability = (entitlement: CapabilityEntitlement): boolean => {
    if (entitlement === "always") return true;
    if (entitlement === "control-room") return allowControlRoom;
    if (entitlement === "errors") return allowErrors;
    if (entitlement === "seo") return allowSeo;
    if (entitlement === "a11y") return allowA11y;
    return allowInsights;
  };

  const stateForCapability = (moduleId: string): { stateLabel: string; tone: Tone } => {
    if (moduleId === "routes") {
      if (summary && hasRoutes(summary)) return { stateLabel: "Active", tone: "good" };
      return { stateLabel: summary ? "Enabled" : "Waiting for telemetry", tone: summary ? "ok" : "neutral" };
    }
    if (moduleId === "reliability") {
      if (summary) return { stateLabel: "Active", tone: "good" };
      return { stateLabel: "Waiting for telemetry", tone: "neutral" };
    }
    if (moduleId === "control-room") return { stateLabel: "Active", tone: "good" };
    if (moduleId === "errors") {
      if (summary && hasErrors(summary)) return { stateLabel: "Active", tone: "good" };
      return { stateLabel: summary ? "Enabled" : "Waiting for telemetry", tone: summary ? "ok" : "neutral" };
    }
    if (moduleId === "seo") {
      if (summary && hasSeo(summary)) return { stateLabel: "Active", tone: "good" };
      return { stateLabel: summary ? "Enabled" : "Waiting for telemetry", tone: summary ? "ok" : "neutral" };
    }
    if (moduleId === "a11y") {
      if (summary && hasA11y(summary)) return { stateLabel: "Active", tone: "good" };
      return { stateLabel: summary ? "Enabled" : "Waiting for telemetry", tone: summary ? "ok" : "neutral" };
    }
    if (moduleId === "insights") {
      if (summary && guardianScore(summary) != null) return { stateLabel: "Active", tone: "good" };
      return { stateLabel: summary ? "Enabled" : "Waiting for telemetry", tone: summary ? "ok" : "neutral" };
    }
    if (summary && updatedAtISO) return { stateLabel: "Active", tone: "good" };
    if (summary) return { stateLabel: "Enabled", tone: "ok" };
    return { stateLabel: "Waiting for telemetry", tone: "neutral" };
  };

  const capabilityModules: PublicCapabilityItem[] = CAPABILITY_CATALOG
    .filter((entry) => isEntitledForCapability(entry.entitlement))
    .map((entry) => {
      const state = stateForCapability(entry.id);
      return {
        id: entry.id,
        label: entry.label,
        description: entry.description,
        stateLabel: state.stateLabel,
        tone: state.tone,
      };
    });

  const capabilitiesActiveCount = capabilityModules.reduce(
    (count, module) => count + (module.stateLabel === "Active" ? 1 : 0),
    0
  );

  type ArtifactSelectRow = {
    id: string;
    displayTitle: string;
    type: string;
    sourcePath: string | null;
    publishedAt: Date | null;
  };
  const artifacts: ArtifactSelectRow[] = config.showArtifacts
    ? await prisma.publicArtifact
        .findMany({
          where: {
            userId: user.id,
            visibility: "PUBLIC_PROFILE",
            publishedAt: { not: null },
          },
          orderBy: { publishedAt: "desc" },
          select: { id: true, displayTitle: true, type: true, sourcePath: true, publishedAt: true },
          take: 12,
        })
        .catch(() => [] as ArtifactSelectRow[])
    : [];

  const artifactViewCountById = await (async () => {
    const normalizePath = (raw: string) => {
      const input = String(raw || "").trim();
      if (!input) return "/";
      const withLeadingSlash = input.startsWith("/") ? input : `/${input}`;
      const collapsed = withLeadingSlash.replace(/\/+/g, "/");
      if (collapsed.length > 1 && collapsed.endsWith("/")) return collapsed.slice(0, -1);
      return collapsed || "/";
    };
    const out = new Map<string, number>();
    for (const artifact of artifacts) {
      const artifactId = String(artifact.id || "").trim();
      if (!artifactId) continue;
      const sourcePath = normalizePath(String(artifact.sourcePath || "").trim() || "/");
      const counts = await getPublicArtifactViewCountsByPath({
        artifactId,
        itemPaths: [sourcePath],
      }).catch(() => new Map<string, number>());
      out.set(artifactId, Math.max(0, Math.trunc(Number(counts.get(sourcePath) || 0))));
    }
    return out;
  })();

  const artifactRows: PublicArtifactRow[] = artifacts
    .map((a): PublicArtifactRow | null => {
      const iso = a.publishedAt ? new Date(a.publishedAt).toISOString() : "";
      if (!iso) return null;
      // Never expose storage keys in the public profile DOM; links resolve via /p/{username}/artifact/{id}.
      return {
        id: String(a.id),
        title: String(a.displayTitle || "").trim().slice(0, 140) || "Artifact",
        type: String(a.type || "").trim().slice(0, 32) || "Artifact",
        publishedAtISO: iso,
        viewCount: Math.max(0, Math.trunc(Number(artifactViewCountById.get(String(a.id || "").trim()) || 0))),
      };
    })
    .filter((x): x is PublicArtifactRow => x !== null);

  const readme = await (async () => {
    if (!config.showReadme) return null;
    const readmeRow = await readPublicProfileReadmeByUserId(user.id);
    if (readmeRow) {
      return {
        markdown: readmeRow.markdown,
        updatedAtISO: readmeRow.updatedAt ? new Date(readmeRow.updatedAt).toISOString() : null,
        isDefault: false,
        revision: Math.max(0, Math.trunc(Number(readmeRow.revision || 0))),
      };
    }
    const defaultReadme = buildDefaultPublicProfileReadme({
      displayName,
      monitoredSitesCount,
      updatedRelative: updatedAtISO ? relativeAgeFromISO(updatedAtISO) : null,
    });
    return { markdown: defaultReadme, updatedAtISO: null, isDefault: true, revision: 0 };
  })();

  const vm: PublicProfileViewModel = {
    visibility: "public",
    config,
    username: user.username,
    displayName,
    isPremiumPlus,
    bio,
    avatar: {
      tone: user.avatarTone,
      image: user.avatarImage,
      initials,
    },
    status,
    readme,
    cta: null,
    identity: {
      details: identityDetails,
      descriptor,
    },
    sections: {
      workspaceSnapshot:
        config.showWorkspaceSnapshot
          ? {
              // Never surface internal/dev seed account naming on public pages.
              workspaceName: (() => {
                const name = account?.name?.trim() ? String(account.name).trim() : "Workspace";
                return /^cavbot admin$/i.test(name) ? "Workspace" : name;
              })(),
              monitoredSitesCount,
              planTierLabel: config.showPlanTier ? tierDisplayNameFromTier(planTierToken) : null,
              status: statusPostureFromWorkspace({ monitoredSitesCount, updatedAtISO }),
            }
          : null,

		      healthOverview:
		        config.showHealthOverview
		          ? {
		              entitlements: {
		                insights: allowInsights,
		                errors: allowErrors,
		                seo: allowSeo,
		                a11y: allowA11y,
		              },
		              guardian: allowInsights ? (summary ? guardianPosture(summary) : posture("Waiting for telemetry", "neutral")) : posture("Locked by tier", "neutral"),
		              guardianScore: allowInsights && summary ? guardianScore(summary) : null,
		              coverage: summary ? coveragePosture(summary) : posture("Waiting for telemetry", "neutral"),
		              performance: summary ? performancePosture(summary) : posture("Waiting for telemetry", "neutral"),
		              accessibility: allowA11y ? (summary ? accessibilityPosture(summary) : posture("Waiting for telemetry", "neutral")) : posture("Locked by tier", "neutral"),
		              routing: summary ? routingPosture(summary) : posture("Waiting for telemetry", "neutral"),
		              reliability: summary ? reliabilityPosture(summary) : posture("Waiting for telemetry", "neutral"),
	              errors: allowErrors ? (summary ? errorsPosture(summary) : posture("Waiting for telemetry", "neutral")) : posture("Locked by tier", "neutral"),
	              seo: allowSeo ? (summary ? seoPosture(summary) : posture("Waiting for telemetry", "neutral")) : posture("Locked by tier", "neutral"),
	              updatedRelative,
	            }
	          : null,

      operationalHistory: buildOperationalHistoryViewModel({
        username: user.username,
        workspaceKey: project?.id != null ? String(project.id) : String(user.id || user.username),
        summary30d: summary30d ?? summary,
        allowErrors,
        allowSeo,
        arcadeEnabled,
      }),

      capabilities: config.showCapabilities
        ? {
            activeCount: capabilitiesActiveCount,
            totalCount: capabilityModules.length,
            modules: capabilityModules,
          }
        : null,
      artifacts: config.showArtifacts ? { items: artifactRows } : null,
    },
    trust: {
      lastVerifiedRelative: updatedRelative,
    },
  };

  return vm;
}

const buildPublicProfileCached = unstable_cache(
  async (username: string) => buildPublicProfileUncached(username),
  ["cb-public-profile-v1"],
  { revalidate: process.env.NODE_ENV === "production" ? 8 : 1, tags: ["cb-public-profile-v1"] }
);

export async function buildPublicProfileViewModel(username: string): Promise<PublicProfileViewModel | null> {
  const u = String(username || "").trim().toLowerCase();
  if (!u) return null;
  return buildPublicProfileCached(u);
}
