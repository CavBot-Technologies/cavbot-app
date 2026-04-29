import "server-only";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  getAppOrigin,
  isApiAuthError,
  requireAccountContext,
  requireSession,
  type CavbotAccountSession,
} from "@/lib/apiAuth";
import {
  CavBotApiError,
  getProjectSummaryForTenant,
  type SummaryRange,
} from "@/lib/cavbotApi.server";
import { resolveProjectAnalyticsAuth } from "@/lib/projectAnalyticsKey.server";
import { readWorkspace, type WorkspacePayload } from "@/lib/workspaceStore.server";
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

function pickActiveSite(args: {
  searchParams?: Record<string, string | string[] | undefined> | null;
  sites: AnalyticsConsoleSite[];
  workspace: WorkspacePayload | null;
}) {
  const { searchParams, sites, workspace } = args;
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
  const topSiteId = String(workspace?.topSiteId || "").trim();

  return (
    (requestedSite ? sites.find((site) => site.id === requestedSite) : null) ||
    (requestedSiteOrigin ? sites.find((site) => site.origin === requestedSiteOrigin) : null) ||
    (requestedOrigin ? sites.find((site) => site.origin === requestedOrigin) : null) ||
    (workspaceSiteId ? sites.find((site) => site.id === workspaceSiteId) : null) ||
    (workspaceOrigin ? sites.find((site) => site.origin === workspaceOrigin) : null) ||
    (topSiteId ? sites.find((site) => site.id === topSiteId) : null) ||
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

  let session: CavbotAccountSession | null = null;
  try {
    const req = await buildRequestFromHeaders(pathname);
    const rawSession = await requireSession(req);
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
    workspace = await readWorkspace({ accountId: session.accountId });
  } catch (error) {
    safeLog("workspace_read_failed", {
      requestId: rid,
      accountId: session.accountId,
      code: publicAnalyticsError(error),
    });
  }

  const requestedProjectId =
    parseProjectId(readSearchParam(args?.searchParams, "projectId")) ||
    parseProjectId(readSearchParam(args?.searchParams, "project")) ||
    parseProjectId(workspace?.projectId);
  const requestedProjectSlug = readSearchParam(args?.searchParams, "projectSlug");

  const project = requestedProjectId
    ? await prisma.project.findFirst({
        where: { id: requestedProjectId, accountId: session.accountId, isActive: true },
        select: {
          id: true,
          slug: true,
          name: true,
          serverKeyEnc: true,
          serverKeyEncIv: true,
        },
      })
    : requestedProjectSlug
      ? await prisma.project.findFirst({
          where: { slug: requestedProjectSlug, accountId: session.accountId, isActive: true },
          select: {
            id: true,
            slug: true,
            name: true,
            serverKeyEnc: true,
            serverKeyEncIv: true,
          },
        })
      : await prisma.project.findFirst({
          where: { accountId: session.accountId, isActive: true },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            slug: true,
            name: true,
            serverKeyEnc: true,
            serverKeyEncIv: true,
          },
        });

  if (!project) {
    return {
      requestId: rid,
      session,
      workspace,
      project: null,
      projectId: "",
      projectLabel: "No project selected",
      range,
      sites: [],
      activeSite: EMPTY_SITE,
      summary: null,
      summaryError: new Error("PROJECT_NOT_FOUND"),
      authError: null,
    };
  }

  const dbSites = await prisma.site.findMany({
    where: { projectId: project.id, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, origin: true },
  });
  const sites = dbSites.map(toSiteRow).filter((site): site is AnalyticsConsoleSite => Boolean(site));
  const activeSite = pickActiveSite({ searchParams: args?.searchParams, sites, workspace });

  let summary: ProjectSummary | null = null;
  let summaryError: unknown = null;

  if (args?.loadSummary !== false) {
    try {
      const analyticsAuth = await resolveProjectAnalyticsAuth(project);

      summary = await getProjectSummaryForTenant({
        projectId: project.id,
        range: range as SummaryRange,
        siteOrigin: activeSite.origin || undefined,
        projectKey: analyticsAuth.projectKey,
        adminToken: analyticsAuth.adminToken,
        requestId: `summary_${project.id}_${rid}`,
      });
    } catch (error) {
      summaryError = error;
      safeLog("summary_failed", {
        requestId: rid,
        accountId: session.accountId,
        projectId: project.id,
        siteOrigin: activeSite.origin || null,
        code: publicAnalyticsError(error),
      });
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
