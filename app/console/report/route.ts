import "server-only";

import { NextResponse } from "next/server";

import { requireAccountContext, requireSession } from "@/lib/apiAuth";
import { getProjectSummaryForTenant, type SummaryRange } from "@/lib/cavbotApi.server";
import { resolveProjectAnalyticsAuth } from "@/lib/projectAnalyticsKey.server";
import type { ProjectSummary } from "@/lib/cavbotTypes";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReportModule =
  | "dashboard"
  | "console"
  | "insights"
  | "seo"
  | "a11y"
  | "errors"
  | "routes"
  | "control_room";

type MetricRow = { label: string; value: string };

type ResolvedProject = {
  id: number;
  slug: string;
  name: string | null;
  topSiteId: string | null;
  serverKeyEnc: string | null;
  serverKeyEncIv: string | null;
};

type ResolvedSite = {
  id: string;
  label: string;
  origin: string;
};

const REPORT_MODULES: Record<ReportModule, { label: string; subtitle: string }> = {
  dashboard: {
    label: "Workspace Dashboard",
    subtitle: "Workspace-level health posture and core operational metrics.",
  },
  console: {
    label: "Workspace Command Center",
    subtitle: "Overall CavBot command-center intelligence across diagnostics pillars.",
  },
  insights: {
    label: "Insights Intelligence",
    subtitle: "Cross-pillar intelligence across SEO, reliability, performance, and accessibility.",
  },
  seo: {
    label: "SEO Intelligence",
    subtitle: "Search posture, indexability, metadata quality, and vitals readiness.",
  },
  a11y: {
    label: "A11y Snapshot",
    subtitle: "Accessibility posture, coverage integrity, and interaction readiness.",
  },
  errors: {
    label: "Error Intelligence",
    subtitle: "Runtime failures, API instability, and not-found pressure analysis.",
  },
  routes: {
    label: "Routes Intelligence",
    subtitle: "Route-level traffic, route quality, performance friction, and fault signals.",
  },
  control_room: {
    label: "404 Control Room",
    subtitle: "Recovery-surface intelligence for broken-route flow and routing resilience.",
  },
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value: string): string {
  return s(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "report";
}

function normalizeRange(value: string | null): SummaryRange {
  const raw = s(value).toLowerCase();
  if (raw === "24h" || raw === "7d" || raw === "14d" || raw === "30d") return raw;
  return "7d";
}

function normalizeModule(value: string | null): ReportModule {
  const raw = s(value).toLowerCase();
  if (raw === "dashboard") return "dashboard";
  if (raw === "console") return "console";
  if (raw === "insights") return "insights";
  if (raw === "seo") return "seo";
  if (raw === "a11y") return "a11y";
  if (raw === "errors") return "errors";
  if (raw === "routes") return "routes";
  if (raw === "control_room" || raw === "control-room" || raw === "404-control-room") return "control_room";
  return "console";
}

function parseProjectId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function parseNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOrigin(value: string): string {
  const raw = s(value);
  if (!raw) return "";
  const withProto = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  try {
    const url = new URL(withProto);
    if (!url.hostname || url.hostname.includes("..")) return "";
    if (url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function getPathValue(input: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = input;
  for (const part of parts) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function pickNumber(input: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = parseNumber(getPathValue(input, path));
    if (value != null) return value;
  }
  return null;
}

function pickString(input: unknown, paths: string[]): string {
  for (const path of paths) {
    const value = s(getPathValue(input, path));
    if (value) return value;
  }
  return "";
}

function fmtInt(value: number | null): string {
  if (value == null) return "n/a";
  return Math.round(value).toLocaleString("en-US");
}

function fmtFloat(value: number | null, digits = 2): string {
  if (value == null) return "n/a";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtMs(value: number | null): string {
  if (value == null) return "n/a";
  return `${Math.round(value).toLocaleString("en-US")} ms`;
}

function fmtPct(value: number | null): string {
  if (value == null) return "n/a";
  const normalized = value >= 0 && value <= 1 ? value * 100 : value;
  return `${normalized.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function metricRowsForModule(module: ReportModule, summary: ProjectSummary): MetricRow[] {
  const rows: MetricRow[] = [];

  const add = (label: string, value: string) => {
    if (!value || value === "n/a") return;
    rows.push({ label, value });
  };

  if (module === "seo") {
    add("Pages observed", fmtInt(pickNumber(summary, ["metrics.seo.pagesObserved", "diagnostics.seo.rollup.pagesObserved"])));
    add("SEO score", fmtFloat(pickNumber(summary, ["metrics.seo.siteSeoScore", "metrics.seo.score", "seo.siteSeoScore"]), 1));
    add("Title coverage", fmtPct(pickNumber(summary, ["metrics.seo.titleCoveragePct", "diagnostics.seo.rollup.titleCoveragePct"])));
    add("Description coverage", fmtPct(pickNumber(summary, ["metrics.seo.descriptionCoveragePct", "diagnostics.seo.rollup.descriptionCoveragePct"])));
    add("Canonical coverage", fmtPct(pickNumber(summary, ["metrics.seo.canonicalCoveragePct", "diagnostics.seo.rollup.canonicalCoveragePct"])));
    add("Noindex pages", fmtPct(pickNumber(summary, ["metrics.seo.noindexPct", "diagnostics.seo.rollup.noindexPct"])));
    add("Missing H1", fmtPct(pickNumber(summary, ["metrics.seo.missingH1Pct", "diagnostics.seo.rollup.missingH1Pct"])));
  } else if (module === "a11y") {
    add("A11y score", fmtFloat(pickNumber(summary, ["metrics.a11y.a11yScore", "diagnostics.a11y.rollup.a11yScore"]), 1));
    add("Audits", fmtInt(pickNumber(summary, ["metrics.a11y.audits", "diagnostics.a11y.rollup.audits"])));
    add("Alt text coverage", fmtPct(pickNumber(summary, ["metrics.a11y.altTextCoveragePct", "diagnostics.a11y.rollup.altTextCoveragePct"])));
    add("ARIA name coverage", fmtPct(pickNumber(summary, ["metrics.a11y.ariaNameCoveragePct", "diagnostics.a11y.rollup.ariaNameCoveragePct"])));
    add("Form label coverage", fmtPct(pickNumber(summary, ["metrics.a11y.formLabelCoveragePct", "diagnostics.a11y.rollup.formLabelCoveragePct"])));
    add("Contrast failures", fmtPct(pickNumber(summary, ["metrics.a11y.contrastFailPct", "diagnostics.a11y.rollup.contrastFailPct"])));
    add("Focus failures", fmtPct(pickNumber(summary, ["metrics.a11y.focusFailPct", "diagnostics.a11y.rollup.focusFailPct"])));
  } else if (module === "errors") {
    add("JavaScript errors", fmtInt(pickNumber(summary, ["metrics.errors.totals.jsErrors", "diagnostics.errors.totals.jsErrors", "metrics.jsErrors"])));
    add("API errors", fmtInt(pickNumber(summary, ["metrics.errors.totals.apiErrors", "diagnostics.errors.totals.apiErrors", "metrics.apiErrors"])));
    add("404 views", fmtInt(pickNumber(summary, ["metrics.errors.totals.views404", "diagnostics.errors.totals.views404", "metrics.views404"])));
    add("Crash-free sessions", fmtPct(pickNumber(summary, ["metrics.errors.totals.crashFreeSessionsPct", "diagnostics.errors.totals.crashFreeSessionsPct"])));
    add("Detection p95", fmtMs(pickNumber(summary, ["metrics.errors.totals.p95DetectMs", "diagnostics.errors.totals.p95DetectMs"])));
    add("Error groups", fmtInt(pickNumber(summary, ["metrics.errors.groupCount", "diagnostics.errors.groupCount"])));
  } else if (module === "routes") {
    add("Routes observed", fmtInt(pickNumber(summary, ["metrics.routes.routesObserved", "diagnostics.routes.routesObserved"])));
    add("Unique routes", fmtInt(pickNumber(summary, ["metrics.routes.uniqueRoutes", "diagnostics.routes.uniqueRoutes"])));
    add("Page views", fmtInt(pickNumber(summary, ["metrics.routes.pageViews", "diagnostics.routes.pageViews", "metrics.pageViews"])));
    add("Route changes", fmtInt(pickNumber(summary, ["metrics.routes.routeChanges", "diagnostics.routes.routeChanges", "metrics.routes.spaNavigations"])));
    add("404 route rate", fmtPct(pickNumber(summary, ["metrics.routes.views404Pct", "diagnostics.routes.views404Pct"])));
    add("Slow routes", fmtPct(pickNumber(summary, ["metrics.routes.slowRoutePct", "diagnostics.routes.slowRoutePct"])));
  } else if (module === "control_room") {
    add("404 views total", fmtInt(pickNumber(summary, ["metrics.controlRoom.views404Total", "diagnostics.controlRoom.views404Total", "metrics.views404"])));
    add("Unique broken routes", fmtInt(pickNumber(summary, ["metrics.controlRoom.unique404Routes", "diagnostics.controlRoom.unique404Routes"])));
    add("404 rate", fmtPct(pickNumber(summary, ["metrics.controlRoom.views404RatePct", "diagnostics.controlRoom.views404RatePct", "metrics.rate404Pct"])));
    add("Arcade sessions", fmtInt(pickNumber(summary, ["metrics.controlRoom.arcadeSessions", "diagnostics.controlRoom.arcadeSessions"])));
    add("Arcade completions", fmtInt(pickNumber(summary, ["metrics.controlRoom.arcadeCompletions", "diagnostics.controlRoom.arcadeCompletions"])));
  } else {
    add("Guardian score", fmtFloat(pickNumber(summary, ["metrics.guardianScore", "guardian.score"]), 1));
    add("Sessions", fmtInt(pickNumber(summary, ["metrics.sessions", "metrics.totalSessions"])));
    add("Page views", fmtInt(pickNumber(summary, ["metrics.pageViews", "metrics.views"])));
    add("404 views", fmtInt(pickNumber(summary, ["metrics.views404", "metrics.errors.totals.views404"])));
    add("JavaScript errors", fmtInt(pickNumber(summary, ["metrics.jsErrors", "metrics.errors.totals.jsErrors"])));
    add("API errors", fmtInt(pickNumber(summary, ["metrics.apiErrors", "metrics.errors.totals.apiErrors"])));
    add("LCP p75", fmtMs(pickNumber(summary, ["metrics.webVitals.lcpP75Ms", "metrics.lcpP75Ms"])));
    add("INP p75", fmtMs(pickNumber(summary, ["metrics.webVitals.inpP75Ms", "metrics.inpP75Ms"])));
    add("CLS p75", fmtFloat(pickNumber(summary, ["metrics.webVitals.clsP75", "metrics.clsP75"]), 3));
  }

  if (!rows.length) {
    add("Project ID", pickString(summary, ["project.id", "project.projectId"]));
    add("Range", pickString(summary, ["window.range"]));
  }

  return rows;
}

function moduleSnapshot(summary: ProjectSummary, module: ReportModule): unknown {
  if (module === "seo") {
    return (
      getPathValue(summary, "metrics.seo")
      || getPathValue(summary, "diagnostics.seo")
      || getPathValue(summary, "snapshot.seo")
      || summary.metrics
    );
  }
  if (module === "a11y") {
    return (
      getPathValue(summary, "metrics.a11y")
      || getPathValue(summary, "diagnostics.a11y")
      || getPathValue(summary, "snapshot.a11y")
      || summary.metrics
    );
  }
  if (module === "errors") {
    return (
      getPathValue(summary, "metrics.errors")
      || getPathValue(summary, "diagnostics.errors")
      || getPathValue(summary, "snapshot.errors")
      || summary.metrics
    );
  }
  if (module === "routes") {
    return (
      getPathValue(summary, "metrics.routes")
      || getPathValue(summary, "diagnostics.routes")
      || getPathValue(summary, "snapshot.routes")
      || summary.metrics
    );
  }
  if (module === "control_room") {
    return (
      getPathValue(summary, "metrics.controlRoom")
      || getPathValue(summary, "diagnostics.controlRoom")
      || getPathValue(summary, "snapshot.controlRoom")
      || summary.metrics
    );
  }
  return summary.metrics;
}

function renderReportHtml(input: {
  module: ReportModule;
  range: SummaryRange;
  reportToken: string;
  project: ResolvedProject;
  site: ResolvedSite | null;
  generatedAt: string;
  rows: MetricRow[];
  focusPath: string;
  focusFingerprint: string;
  snapshot: unknown;
}): string {
  const moduleMeta = REPORT_MODULES[input.module];
  const metricsRows = input.rows.length
    ? input.rows.map((row) => `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`).join("")
    : `<tr><th>Status</th><td>No module metrics available in current summary payload.</td></tr>`;

  const focusRows = [
    input.focusPath ? `<div><span>Route path</span><strong>${escapeHtml(input.focusPath)}</strong></div>` : "",
    input.focusFingerprint ? `<div><span>Error fingerprint</span><strong>${escapeHtml(input.focusFingerprint)}</strong></div>` : "",
  ]
    .filter(Boolean)
    .join("");

  const snapshotText = JSON.stringify(input.snapshot ?? {}, null, 2);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(moduleMeta.label)} Report</title>
    <style>
      :root {
        --ink: #0a0a0a;
        --line: #dddddd;
        --soft: #666666;
        --paper: #ffffff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--paper);
        color: var(--ink);
        font-family: "Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif;
        line-height: 1.45;
      }
      .page {
        max-width: 980px;
        margin: 0 auto;
        padding: 36px 28px 48px;
      }
      .brand {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        border-bottom: 2px solid var(--ink);
        padding-bottom: 14px;
        margin-bottom: 24px;
      }
      .brand h1 {
        margin: 0;
        font-size: 28px;
        letter-spacing: 0.02em;
      }
      .brand .token {
        font-size: 12px;
        color: var(--soft);
      }
      .subtitle {
        margin: 0 0 22px;
        color: var(--soft);
        font-size: 15px;
      }
      .meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 20px;
        margin-bottom: 24px;
      }
      .meta div {
        border: 1px solid var(--line);
        padding: 10px 12px;
      }
      .meta span {
        display: block;
        font-size: 11px;
        color: var(--soft);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .meta strong {
        display: block;
        margin-top: 4px;
        font-size: 15px;
      }
      h2 {
        margin: 28px 0 10px;
        font-size: 18px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border: 1px solid var(--line);
        padding: 9px 11px;
        font-size: 14px;
        vertical-align: top;
      }
      th {
        width: 38%;
        text-align: left;
        background: #f8f8f8;
      }
      .focus {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .focus div {
        border: 1px solid var(--line);
        padding: 10px 12px;
      }
      .focus span {
        display: block;
        color: var(--soft);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .focus strong {
        display: block;
        margin-top: 4px;
      }
      pre {
        margin: 10px 0 0;
        border: 1px solid var(--line);
        padding: 14px;
        background: #fafafa;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
      }
      .foot {
        margin-top: 28px;
        padding-top: 16px;
        border-top: 1px solid var(--line);
        color: var(--soft);
        font-size: 12px;
      }
      @media print {
        body { background: #fff; }
        .page { max-width: none; padding: 14mm; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="brand">
        <h1>CavBot Intelligence Report</h1>
        <div class="token">Report ID: ${escapeHtml(input.reportToken)}</div>
      </header>

      <p class="subtitle">${escapeHtml(moduleMeta.label)} · ${escapeHtml(moduleMeta.subtitle)}</p>

      <section class="meta" aria-label="Report metadata">
        <div><span>Generated At</span><strong>${escapeHtml(input.generatedAt)}</strong></div>
        <div><span>Range</span><strong>${escapeHtml(input.range)}</strong></div>
        <div><span>Project</span><strong>#${escapeHtml(String(input.project.id))}${input.project.name ? ` · ${escapeHtml(input.project.name)}` : ""}</strong></div>
        <div><span>Site</span><strong>${input.site ? `${escapeHtml(input.site.label)} (${escapeHtml(input.site.origin)})` : "All sites in project"}</strong></div>
      </section>

      <section aria-label="Key metrics">
        <h2>Key Metrics</h2>
        <table>${metricsRows}</table>
      </section>

      ${focusRows ? `<section aria-label="Focus context"><h2>Focus Context</h2><div class="focus">${focusRows}</div></section>` : ""}

      <section aria-label="Raw module snapshot">
        <h2>Module Snapshot</h2>
        <pre>${escapeHtml(snapshotText.slice(0, 120000))}</pre>
      </section>

      <footer class="foot">
        Generated from authenticated workspace context with account-scoped project and site resolution.
      </footer>
    </main>
  </body>
</html>`;
}

async function resolveProject(accountId: string, rawProjectHint: string): Promise<ResolvedProject | null> {
  const projectId = parseProjectId(rawProjectHint);
  if (projectId != null) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId, isActive: true },
      select: { id: true, slug: true, name: true, topSiteId: true, serverKeyEnc: true, serverKeyEncIv: true },
    });
    if (project) return project;
  }
  return prisma.project.findFirst({
    where: { accountId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, name: true, topSiteId: true, serverKeyEnc: true, serverKeyEncIv: true },
  });
}

async function resolveSite(projectId: number, input: {
  siteIdHint: string;
  siteHint: string;
  originHint: string;
  topSiteId: string | null;
}): Promise<ResolvedSite | null> {
  const asOriginFromSite = normalizeOrigin(input.siteHint);
  const origin = normalizeOrigin(input.originHint || asOriginFromSite);
  const siteIdCandidate = input.siteIdHint || (asOriginFromSite ? "" : input.siteHint);

  if (siteIdCandidate) {
    const siteById = await prisma.site.findFirst({
      where: { id: siteIdCandidate, projectId, isActive: true },
      select: { id: true, label: true, origin: true },
    });
    if (siteById) return siteById;
  }

  if (origin) {
    const siteByOrigin = await prisma.site.findFirst({
      where: { origin, projectId, isActive: true },
      select: { id: true, label: true, origin: true },
    });
    if (siteByOrigin) return siteByOrigin;
  }

  if (input.topSiteId) {
    const topSite = await prisma.site.findFirst({
      where: { id: input.topSiteId, projectId, isActive: true },
      select: { id: true, label: true, origin: true },
    });
    if (topSite) return topSite;
  }

  return null;
}

function toHttpError(error: unknown): { status: number; payload: Record<string, unknown> } {
  const message = s((error as { message?: unknown })?.message || error).toUpperCase();
  if (message === "UNAUTHORIZED" || message === "NO_SESSION" || message === "UNAUTHENTICATED") {
    return { status: 401, payload: { ok: false, error: "UNAUTHENTICATED" } };
  }
  if (message === "FORBIDDEN") {
    return { status: 403, payload: { ok: false, error: "FORBIDDEN" } };
  }
  if (message === "PROJECT_KEY_MISSING") {
    return { status: 409, payload: { ok: false, error: "PROJECT_KEY_MISSING" } };
  }
  if (message === "PROJECT_KEY_DECRYPT_FAILED") {
    return { status: 502, payload: { ok: false, error: "PROJECT_KEY_DECRYPT_FAILED" } };
  }
  return { status: 500, payload: { ok: false, error: "REPORT_BUILD_FAILED" } };
}

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const accountId = s(session.accountId);
    if (!accountId) {
      return NextResponse.json({ ok: false, error: "ACCOUNT_CONTEXT_REQUIRED" }, { status: 401 });
    }

    const url = new URL(req.url);
    const search = url.searchParams;

    const moduleKey = normalizeModule(search.get("module") || search.get("panel"));
    const range = normalizeRange(search.get("range"));
    const rawProjectHint = s(search.get("projectId") || search.get("project"));
    const rawSiteIdHint = s(search.get("siteId"));
    const rawSiteHint = s(search.get("site"));
    const rawOriginHint = s(search.get("origin") || search.get("siteOrigin"));
    const focusFingerprint = s(search.get("fp"));
    const focusPath = s(search.get("path"));

    const project = await resolveProject(accountId, rawProjectHint);
    if (!project) {
      return NextResponse.json({ ok: false, error: "PROJECT_NOT_FOUND" }, { status: 404 });
    }

    const site = await resolveSite(project.id, {
      siteIdHint: rawSiteIdHint,
      siteHint: rawSiteHint,
      originHint: rawOriginHint,
      topSiteId: project.topSiteId,
    });

    const analyticsAuth = await resolveProjectAnalyticsAuth(project);

    const summary = await getProjectSummaryForTenant({
      projectId: project.id,
      range,
      siteId: site?.id || undefined,
      siteOrigin: site?.origin || undefined,
      projectKey: analyticsAuth.projectKey,
      adminToken: analyticsAuth.adminToken,
      requestId: `console_report_${project.id}`,
    });

    const rows = metricRowsForModule(moduleKey, summary);
    const snapshot = moduleSnapshot(summary, moduleKey);
    const reportToken = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `rpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    const generatedAt = new Date().toISOString();
    const html = renderReportHtml({
      module: moduleKey,
      range,
      reportToken,
      project,
      site,
      generatedAt,
      rows,
      focusPath,
      focusFingerprint,
      snapshot,
    });

    const moduleMeta = REPORT_MODULES[moduleKey];
    const dateTag = generatedAt.slice(0, 10);
    const sitePart = site ? `site-${slugify(site.label || site.id)}` : "all-sites";
    const filename = `cavbot-${slugify(moduleMeta.label)}-project-${project.id}-${sitePart}-${range}-${dateTag}.html`;

    try {
      await prisma.auditLog.create({
        data: {
          accountId,
          operatorUserId: session.systemRole === "user" ? s(session.sub) || null : null,
          action: "SCAN_REPORT_DOWNLOADED",
          actionLabel: `${moduleMeta.label} report downloaded`,
          category: "system",
          severity: "info",
          targetType: "report",
          targetId: reportToken,
          targetLabel: moduleMeta.label,
          metaJson: {
            reportToken,
            module: moduleKey,
            moduleLabel: moduleMeta.label,
            range,
            projectId: project.id,
            projectSlug: project.slug,
            siteId: site?.id || null,
            siteOrigin: site?.origin || null,
            focusPath: focusPath || null,
            focusFingerprint: focusFingerprint || null,
            generatedAtISO: generatedAt,
            format: "text/html",
          },
          ip: s(req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip")) || null,
          userAgent: s(req.headers.get("user-agent")) || null,
        },
      });
    } catch {
      // Report generation should still succeed even if audit persistence fails.
    }

    return new NextResponse(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store, max-age=0",
        pragma: "no-cache",
        expires: "0",
        vary: "Cookie",
      },
    });
  } catch (error: unknown) {
    const { status, payload } = toHttpError(error);
    return NextResponse.json(payload, { status });
  }
}
