import "server-only";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  getAppOrigin,
  isApiAuthError,
  requireAccountContext,
  type CavbotAccountSession,
} from "@/lib/apiAuth";
import {
  CavBotApiError,
  getProjectSummaryForTenant,
  type SummaryRange,
} from "@/lib/cavbotApi.server";
import { resolveProjectAnalyticsAuth } from "@/lib/projectAnalyticsKey.server";
import { readWorkspace, type WorkspacePayload } from "@/lib/workspaceStore.server";
import { requireWorkspaceResilientSession } from "@/lib/workspaceAuth.server";
import type { ProjectSummary } from "@/lib/cavbotTypes";

export type AnalyticsRangeKey = "24h" | "7d" | "14d" | "30d";

export type AnalyticsConsoleSite = {
  id: string;
  label: string;
  origin: string;
  url: string;
};

export type AnalyticsConsoleProject = {
  id: number;
  slug: string;
  name: string | null;
  topSiteId: string | null;
  serverKeyEnc: string | null;
  serverKeyEncIv: string | null;
};

export type AnalyticsConsoleContext = {
  requestId: string;
  session: CavbotAccountSession | null;
  workspace: WorkspacePayload | null;
  project: AnalyticsConsoleProject | null;
  projectId: string;
  projectLabel: string;
  range: AnalyticsRangeKey;
  sites: AnalyticsConsoleSite[];
  activeSite: AnalyticsConsoleSite;
  summary: ProjectSummary | null;
  summaryError: unknown;
  authError: string | null;
};

const EMPTY_SITE: AnalyticsConsoleSite = {
  id: "none",
  label: "No site selected",
  origin: "",
  url: "",
};

function readSearchParam(
  searchParams: Record<string, string | string[] | undefined> | null | undefined,
  key: string,
) {
  const value = searchParams?.[key];
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").trim();
}

function normalizeRange(input: unknown, fallback: AnalyticsRangeKey = "7d"): AnalyticsRangeKey {
  const value = String(input ?? "").trim();
  if (value === "24h" || value === "7d" || value === "14d" || value === "30d") return value;
  return fallback;
}

function parseProjectId(input: unknown): number | null {
  const value = String(input ?? "").trim();
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function canonicalOrigin(input: unknown): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname || url.hostname.includes("..") || url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function requestId() {
  if (typeof crypto === "object" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `analytics_${Date.now()}`;
}

async function buildRequestFromHeaders(pathname: string) {
  const headerStore = await headers();
  const cookie = String(headerStore.get("cookie") || "");
  const fallbackOrigin = new URL(getAppOrigin());
  const host = String(
    headerStore.get("x-forwarded-host") ||
      headerStore.get("host") ||
      fallbackOrigin.host,
  ).trim();
  const proto = String(
    headerStore.get("x-forwarded-proto") ||
      fallbackOrigin.protocol.replace(/:$/, "") ||
      "https",
  ).trim();

  return new Request(`${proto}://${host}${pathname}`, {
    method: "GET",
    headers: {
      cookie,
      host,
      "x-forwarded-host": host,
      "x-forwarded-proto": proto,
    },
  });
}

function parseCookieHeader(cookieHeader: string) {
  const out = new Map<string, string>();
  for (const part of String(cookieHeader || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      out.set(key, decodeURIComponent(raw));
    } catch {
      out.set(key, raw);
    }
  }
  return out;
}

function parseCookieProjectId(value: unknown) {
  const parsed = parseProjectId(value);
  return parsed && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function readCommandCenterCookieHints() {
  const headerStore = await headers();
  const cookieMap = parseCookieHeader(String(headerStore.get("cookie") || ""));
  const preferredProjectId =
    parseCookieProjectId(cookieMap.get("cb_active_project_id")) ||
    parseCookieProjectId(cookieMap.get("cb_pid"));
  const projectKey = preferredProjectId ? String(preferredProjectId) : "";

  return {
    preferredProjectId,
    activeSiteId: projectKey ? String(cookieMap.get(`cb_active_site_id__${projectKey}`) || "").trim() : "",
    activeSiteOrigin: projectKey ? canonicalOrigin(cookieMap.get(`cb_active_site_origin__${projectKey}`) || "") : "",
  };
}

function toSiteRow(row: { id: string; label: string; origin: string }): AnalyticsConsoleSite | null {
  const origin = canonicalOrigin(row.origin);
  if (!row.id || !origin) return null;
  return {
    id: String(row.id),
    label: String(row.label || "").trim() || origin,
    origin,
    url: origin,
  };
}

function workspaceSiteRows(workspace: WorkspacePayload | null): AnalyticsConsoleSite[] {
  const rows = Array.isArray(workspace?.sites) ? workspace.sites : [];
  return rows
    .map((row) => toSiteRow({
      id: row.id,
      label: row.label,
      origin: row.origin,
    }))
    .filter((site): site is AnalyticsConsoleSite => Boolean(site));
}

function mergeSiteRows(
  primary: AnalyticsConsoleSite[],
  fallback: AnalyticsConsoleSite[],
): AnalyticsConsoleSite[] {
  const merged: AnalyticsConsoleSite[] = [];
  const seenIds = new Set<string>();
  const seenOrigins = new Set<string>();

  for (const site of [...primary, ...fallback]) {
    const id = String(site.id || "").trim();
    const origin = canonicalOrigin(site.origin || site.url);
    if (!id || !origin || seenIds.has(id) || seenOrigins.has(origin)) continue;
    seenIds.add(id);
    seenOrigins.add(origin);
    merged.push({ ...site, id, origin, url: origin });
  }

  return merged;
}

function pickActiveSite(args: {
  searchParams?: Record<string, string | string[] | undefined> | null;
  sites: AnalyticsConsoleSite[];
  workspace: WorkspacePayload | null;
  commandHints?: { activeSiteId?: string; activeSiteOrigin?: string } | null;
  topSiteId?: string | null;
}) {
  const { searchParams, sites, workspace, commandHints } = args;
  if (!sites.length) return EMPTY_SITE;

  const requestedSite =
    readSearchParam(searchParams, "site") ||
    readSearchParam(searchParams, "siteId") ||
    "";
  const requestedOrigin = canonicalOrigin(
    readSearchParam(searchParams, "origin") || readSearchParam(searchParams, "siteOrigin"),
  );
  const requestedSiteOrigin = canonicalOrigin(requestedSite);
  const workspaceOrigin = canonicalOrigin(
    workspace?.activeSiteOrigin || workspace?.workspace?.activeSiteOrigin || "",
  );
  const workspaceSiteId = String(workspace?.activeSiteId || "").trim();
  const commandSiteId = String(commandHints?.activeSiteId || "").trim();
  const commandOrigin = canonicalOrigin(commandHints?.activeSiteOrigin || "");
  const topSiteId = String(args.topSiteId || workspace?.topSiteId || "").trim();

  return (
    (requestedSite ? sites.find((site) => site.id === requestedSite) : null) ||
    (requestedSiteOrigin ? sites.find((site) => site.origin === requestedSiteOrigin) : null) ||
    (requestedOrigin ? sites.find((site) => site.origin === requestedOrigin) : null) ||
    (topSiteId ? sites.find((site) => site.id === topSiteId) : null) ||
    (commandSiteId ? sites.find((site) => site.id === commandSiteId) : null) ||
    (commandOrigin ? sites.find((site) => site.origin === commandOrigin) : null) ||
    (workspaceSiteId ? sites.find((site) => site.id === workspaceSiteId) : null) ||
    (workspaceOrigin ? sites.find((site) => site.origin === workspaceOrigin) : null) ||
    sites[0] ||
    EMPTY_SITE
  );
}

function publicAnalyticsError(error: unknown) {
  if (isApiAuthError(error)) return error.code;
  if (error instanceof CavBotApiError) return error.code || "CAVBOT_API_ERROR";
  if (error instanceof Error) {
    if (error.message === "PROJECT_KEY_MISSING") return "PROJECT_KEY_MISSING";
    if (error.message === "PROJECT_KEY_DECRYPT_FAILED") return "PROJECT_KEY_DECRYPT_FAILED";
    if (error.message === "PROJECT_NOT_FOUND") return "PROJECT_NOT_FOUND";
  }
  return "ANALYTICS_SUMMARY_FAILED";
}

function safeLog(event: string, payload: Record<string, unknown>) {
  try {
    console.error("[analytics-console]", JSON.stringify({ event, ...payload }));
  } catch {
    console.error("[analytics-console]", event);
  }
}

function isFatalSummaryError(error: unknown) {
  const code = publicAnalyticsError(error);
  return (
    isApiAuthError(error) ||
    code === "PROJECT_KEY_MISSING" ||
    code === "PROJECT_KEY_DECRYPT_FAILED" ||
    code === "PROJECT_NOT_FOUND" ||
    code === "config_invalid"
  );
}

function emptyProjectSummary(args: {
  project: AnalyticsConsoleProject;
  range: AnalyticsRangeKey;
  sites: AnalyticsConsoleSite[];
  activeSite: AnalyticsConsoleSite;
}): ProjectSummary {
  return {
    project: {
      id: String(args.project.id),
      name: args.project.name || args.project.slug || undefined,
      projectId: args.project.id,
    },
    window: {
      range: args.range,
    },
    sites: args.sites.map((site) => ({
      id: site.id,
      label: site.label,
      origin: site.origin,
      isActive: true,
    })),
    activeSite: args.activeSite.id === EMPTY_SITE.id ? undefined : {
      id: args.activeSite.id,
      label: args.activeSite.label,
      origin: args.activeSite.origin,
      isActive: true,
    },
    metrics: {},
    diagnostics: {
      degraded: true,
      reason: "SUMMARY_UNAVAILABLE",
    },
  };
}

function rangeDays(range: AnalyticsRangeKey) {
  if (range === "24h") return 1;
  if (range === "14d") return 14;
  if (range === "30d") return 30;
  return 7;
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function eventMetaRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function localEventKind(type: string, message: string, meta: Record<string, unknown>) {
  return String(meta.eventType || meta.event_type || message || type || "")
    .trim()
    .toLowerCase();
}

function localRoutePath(meta: Record<string, unknown>) {
  const routePath = String(meta.routePath || meta.route_path || "").trim();
  if (routePath) return routePath;
  const pageUrl = String(meta.pageUrl || meta.page_url || "").trim();
  if (!pageUrl) return "/";
  try {
    const parsed = new URL(pageUrl);
    return `${parsed.pathname || "/"}${parsed.search || ""}` || "/";
  } catch {
    return pageUrl.startsWith("/") ? pageUrl : "/";
  }
}

async function readLocalProjectSummaryFallback(args: {
  project: AnalyticsConsoleProject;
  range: AnalyticsRangeKey;
  sites: AnalyticsConsoleSite[];
  activeSite: AnalyticsConsoleSite;
}): Promise<ProjectSummary> {
  const base = emptyProjectSummary(args);
  if (!args.activeSite.id || args.activeSite.id === EMPTY_SITE.id) return base;

  const days = rangeDays(args.range);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.siteEvent.findMany({
    where: {
      siteId: args.activeSite.id,
      type: "ANALYTICS_EVENT",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "asc" },
    take: 5000,
    select: { createdAt: true, type: true, message: true, meta: true },
  });

  if (!rows.length) return base;

  const sessions = new Set<string>();
  const routes = new Map<string, number>();
  const trend = new Map<string, { day: string; sessions: number; views404: number; jsErrors: number; apiErrors: number }>();
  let pageViews24h = 0;
  let views404 = 0;
  let jsErrors = 0;
  let apiErrors = 0;

  for (let i = 0; i < days; i += 1) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = dayKey(d);
    trend.set(key, { day: key, sessions: 0, views404: 0, jsErrors: 0, apiErrors: 0 });
  }

  for (const row of rows) {
    const meta = eventMetaRecord(row.meta);
    const kind = localEventKind(row.type, row.message, meta);
    const routePath = localRoutePath(meta);
    const sessionId = String(meta.sessionId || meta.session_id || "").trim() || `${routePath}:${row.createdAt.getTime()}`;
    const day = dayKey(row.createdAt);
    const point = trend.get(day) || { day, sessions: 0, views404: 0, jsErrors: 0, apiErrors: 0 };

    sessions.add(sessionId);
    routes.set(routePath, (routes.get(routePath) || 0) + 1);
    point.sessions += 1;
    if (row.createdAt >= since24h) pageViews24h += 1;
    if (kind.includes("404") || kind.includes("not_found") || routePath.includes("404")) {
      views404 += 1;
      point.views404 += 1;
    }
    if (kind.includes("js") || kind.includes("javascript") || kind.includes("exception")) {
      jsErrors += 1;
      point.jsErrors += 1;
    }
    if (kind.includes("api") || kind.includes("request_error") || kind.includes("http_error")) {
      apiErrors += 1;
      point.apiErrors += 1;
    }
    trend.set(day, point);
  }

  const trendRows = Array.from(trend.values()).sort((a, b) => a.day.localeCompare(b.day));
  const topRoutes = Array.from(routes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([routePath, views]) => ({ routePath, views }));
  const sessionCount = rows.length;
  const crashFreeSessionsPct = sessionCount > 0
    ? Math.max(0, 100 - ((jsErrors + apiErrors) / Math.max(1, sessionCount)) * 100)
    : 100;

  return {
    ...base,
    metrics: {
      ...base.metrics,
      pageViews24h,
      sessions30d: sessionCount,
      uniqueVisitors30d: sessions.size,
      sessionsUnderGuard30d: sessionCount,
      routesMonitored: routes.size,
      views40430d: views404,
      sessions40430d: views404,
      jsErrors30d: jsErrors,
      apiErrors30d: apiErrors,
      guardianScore: jsErrors || apiErrors || views404 ? 82 : 96,
      aggregationCoveragePercent: 100,
      trend7d: trendRows.slice(-7).map(({ day, sessions: s, views404: v }) => ({ day, sessions: s, views404: v })),
      trend30d: trendRows.map(({ day, sessions: s, views404: v }) => ({ day, sessions: s, views404: v })),
      topRoutes,
    },
    diagnostics: {
      degraded: true,
      reason: "LOCAL_ANALYTICS_FALLBACK",
    },
    snapshot: {
      errors: {
        totals: {
          jsErrors,
          apiErrors,
          views404,
          crashFreeSessionsPct,
        },
        trend: trendRows.map(({ day, jsErrors: js, apiErrors: api, views404: v }) => ({
          day,
          jsErrors: js,
          apiErrors: api,
          views404: v,
        })),
      },
    },
  };
}

function withConsoleDeadline<T>(promise: Promise<T>, label: string, timeoutMs = 4_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function resolveAnalyticsConsoleContext(args?: {
  searchParams?: Record<string, string | string[] | undefined> | null;
  defaultRange?: AnalyticsRangeKey;
  pathname?: string;
  loadSummary?: boolean;
}): Promise<AnalyticsConsoleContext> {
  const rid = requestId();
  const pathname = args?.pathname || "/console";
  const defaultRange = args?.defaultRange || "7d";
  const range = normalizeRange(readSearchParam(args?.searchParams, "range"), defaultRange);
  const commandHints = await readCommandCenterCookieHints().catch(() => ({
    preferredProjectId: null,
    activeSiteId: "",
    activeSiteOrigin: "",
  }));

  let session: CavbotAccountSession | null = null;
  try {
    const req = await buildRequestFromHeaders(pathname);
    const rawSession = await withConsoleDeadline(requireWorkspaceResilientSession(req), "SESSION_READ", 2_000);
    requireAccountContext(rawSession);
    session = rawSession;
  } catch (error) {
    const authError = publicAnalyticsError(error);
    safeLog("auth_failed", { requestId: rid, code: authError });
    return {
      requestId: rid,
      session: null,
      workspace: null,
      project: null,
      projectId: "",
      projectLabel: "Project",
      range,
      sites: [],
      activeSite: EMPTY_SITE,
      summary: null,
      summaryError: error,
      authError,
    };
  }

  let workspace: WorkspacePayload | null = null;
  try {
    workspace = await withConsoleDeadline(
      readWorkspace({ accountId: session.accountId }),
      "WORKSPACE_READ",
      2_000,
    );
  } catch (error) {
    safeLog("workspace_read_failed", {
      requestId: rid,
      accountId: session.accountId,
      code: publicAnalyticsError(error),
    });
  }
  const workspaceSites = workspaceSiteRows(workspace);

  const requestedProjectId =
    parseProjectId(readSearchParam(args?.searchParams, "projectId")) ||
    parseProjectId(readSearchParam(args?.searchParams, "project")) ||
    commandHints.preferredProjectId ||
    parseProjectId(workspace?.projectId);
  const requestedProjectSlug = readSearchParam(args?.searchParams, "projectSlug");

  let project: AnalyticsConsoleProject | null = null;
  try {
    const projectPromise = requestedProjectId
      ? prisma.project.findFirst({
          where: { id: requestedProjectId, accountId: session.accountId, isActive: true },
          select: {
            id: true,
            slug: true,
            name: true,
            topSiteId: true,
            serverKeyEnc: true,
            serverKeyEncIv: true,
          },
        })
      : requestedProjectSlug
        ? prisma.project.findFirst({
            where: { slug: requestedProjectSlug, accountId: session.accountId, isActive: true },
            select: {
              id: true,
              slug: true,
              name: true,
              topSiteId: true,
              serverKeyEnc: true,
              serverKeyEncIv: true,
            },
          })
        : prisma.project.findFirst({
            where: { accountId: session.accountId, isActive: true },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              slug: true,
              name: true,
              topSiteId: true,
              serverKeyEnc: true,
              serverKeyEncIv: true,
            },
          });
    project = await withConsoleDeadline(projectPromise, "PROJECT_READ");
  } catch (error) {
    safeLog("project_read_failed", {
      requestId: rid,
      accountId: session.accountId,
      requestedProjectId,
      requestedProjectSlug: requestedProjectSlug || null,
      code: publicAnalyticsError(error),
    });
    return {
      requestId: rid,
      session,
      workspace,
      project: null,
      projectId: "",
      projectLabel: "Project unavailable",
      range,
      sites: workspaceSites,
      activeSite: pickActiveSite({
        searchParams: args?.searchParams,
        sites: workspaceSites,
        workspace,
        commandHints,
      }),
      summary: null,
      summaryError: error,
      authError: null,
    };
  }

  if (!project) {
    return {
      requestId: rid,
      session,
      workspace,
      project: null,
      projectId: "",
      projectLabel: "No project selected",
      range,
      sites: workspaceSites,
      activeSite: pickActiveSite({
        searchParams: args?.searchParams,
        sites: workspaceSites,
        workspace,
        commandHints,
      }),
      summary: null,
      summaryError: new Error("PROJECT_NOT_FOUND"),
      authError: null,
    };
  }

  let dbSites: Array<{ id: string; label: string; origin: string }> = [];
  try {
    dbSites = await withConsoleDeadline(
      prisma.site.findMany({
        where: { projectId: project.id, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, label: true, origin: true },
      }),
      "SITE_READ",
    );
  } catch (error) {
    safeLog("site_read_failed", {
      requestId: rid,
      accountId: session.accountId,
      projectId: project.id,
      code: publicAnalyticsError(error),
    });
    return {
      requestId: rid,
      session,
      workspace,
      project,
      projectId: String(project.id),
      projectLabel: project.name || project.slug || `Project #${project.id}`,
      range,
      sites: workspaceSites,
      activeSite: pickActiveSite({
        searchParams: args?.searchParams,
        sites: workspaceSites,
        workspace,
        commandHints,
        topSiteId: project.topSiteId,
      }),
      summary: null,
      summaryError: error,
      authError: null,
    };
  }
  const dbSiteRows = dbSites.map(toSiteRow).filter((site): site is AnalyticsConsoleSite => Boolean(site));
  const sites = mergeSiteRows(dbSiteRows, workspaceSites);
  const activeSite = pickActiveSite({
    searchParams: args?.searchParams,
    sites,
    workspace,
    commandHints,
    topSiteId: project.topSiteId,
  });

  let summary: ProjectSummary | null = null;
  let summaryError: unknown = null;

  if (args?.loadSummary !== false) {
    try {
      summary = await withConsoleDeadline(
        (async () => {
          const analyticsAuth = await resolveProjectAnalyticsAuth(project);

          return getProjectSummaryForTenant({
            projectId: project.id,
            range: range as SummaryRange,
            siteOrigin: activeSite.origin || undefined,
            projectKey: analyticsAuth.projectKey,
            adminToken: analyticsAuth.adminToken,
            requestId: `summary_${project.id}_${rid}`,
          });
        })(),
        "SUMMARY_READ",
        4_500,
      );
    } catch (error) {
      summaryError = error;
      safeLog("summary_failed", {
        requestId: rid,
        accountId: session.accountId,
        projectId: project.id,
        siteOrigin: activeSite.origin || null,
        code: publicAnalyticsError(error),
      });
      if (!isFatalSummaryError(error)) {
        summaryError = null;
        summary = await readLocalProjectSummaryFallback({ project, range, sites, activeSite }).catch(() =>
          emptyProjectSummary({ project, range, sites, activeSite }),
        );
      }
    }
  }

  return {
    requestId: rid,
    session,
    workspace,
    project,
    projectId: String(project.id),
    projectLabel: project.name || project.slug || `Project #${project.id}`,
    range,
    sites,
    activeSite,
    summary,
    summaryError,
    authError: null,
  };
}

export function analyticsConsoleErrorCode(error: unknown): string {
  return publicAnalyticsError(error);
}
