// app/api/console/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { requireWorkspaceResilientSession } from "@/lib/workspaceAuth.server";
import type { SummaryRange } from "@/lib/cavbotApi.server";
import { CavBotApiError, getProjectSummaryForTenant } from "@/lib/cavbotApi.server";
import type { ProjectSummary } from "@/lib/cavbotTypes";
import { readApiKeyWorkspaceCookieHints, resolveApiKeyWorkspace } from "@/lib/settings/apiKeyWorkspace.server";
import { readWorkspace, type WorkspacePayload } from "@/lib/workspaceStore.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function normalizeRange(input: string | null): SummaryRange {
  const v = String(input ?? "").trim();
  if (v === "24h" || v === "7d" || v === "14d" || v === "30d") return v as SummaryRange;
  return "30d";
}

function parseProjectId(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toPublicError(e: unknown) {
  // apiAuth.ts errors (session/origin/roles)
  if (isApiAuthError(e)) {
    const status = e.status ?? 401;
    const code = e.code || "UNAUTHORIZED";
    if (code === "BAD_ORIGIN") return { status: 403, payload: { error: "BAD_ORIGIN" } };
    if (status === 403) return { status: 403, payload: { error: "FORBIDDEN" } };
    return { status: 401, payload: { error: "UNAUTHENTICATED" } };
  }

  // BAD_ORIGIN thrown by request validation
  const message =
    e instanceof Error
      ? e.message
      : typeof e === "string"
      ? e
      : undefined;
  if (message === "BAD_ORIGIN") {
    return { status: 400, payload: { error: "BAD_ORIGIN" } };
  }

  // CavBot API client errors
  if (e instanceof CavBotApiError) {
    return {
      status: e.status && e.status >= 400 && e.status <= 599 ? e.status : 502,
      payload: {
        error: "CAVBOT_API_ERROR",
        code: e.code || undefined,
        requestId: e.requestId || undefined,
      },
    };
  }

  return { status: 500, payload: { error: "CONSOLE_SUMMARY_FAILED" } };
}

function degradedSummary(
  range: SummaryRange,
  projectId = 1,
  reason = "CONSOLE_SUMMARY_DEGRADED",
): ProjectSummary & { degraded: true; error: string; code: string } {
  return {
    degraded: true,
    error: "CONSOLE_SUMMARY_DEGRADED",
    code: reason,
    project: { id: String(projectId), projectId },
    window: { range },
    sites: [],
    activeSite: { id: "none", label: "No site selected", origin: "" },
    metrics: {},
    diagnostics: { degraded: true },
  };
}

function withRouteDeadline<T>(promise: Promise<T>, label: string, timeoutMs = 6_000): Promise<T> {
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

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function workspaceFromPayload(payload: WorkspacePayload | null) {
  if (!payload?.projectId || !Array.isArray(payload.sites) || !payload.sites.length) return null;
  const topSite =
    (payload.topSiteId ? payload.sites.find((site) => site.id === payload.topSiteId) : null) ||
    (payload.activeSiteId ? payload.sites.find((site) => site.id === payload.activeSiteId) : null) ||
    payload.sites[0] ||
    null;
  return {
    projectId: payload.projectId,
    sites: payload.sites.map((site) => ({ id: site.id, origin: site.origin })),
    activeSite: topSite ? { id: topSite.id, origin: topSite.origin } : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    // MUST be NextRequest so apiAuth can reliably read cookies
    const session = await requireWorkspaceResilientSession(req);
    requireAccountContext(session);

    const { searchParams } = req.nextUrl;
    const range = normalizeRange(searchParams.get("range"));

    // Priority order:
    // 1) URL param (project / projectId)
    // 2) cookie cb_active_project_id (new)
    // 3) cookie cb_pid (legacy fallback)
    // 4) fallback to first active project in DB (for this account)
    const pidFromQuery =
      parseProjectId(searchParams.get("project")) || parseProjectId(searchParams.get("projectId"));

    const workspaceHints = readApiKeyWorkspaceCookieHints(req);
    const pidFromCookie = workspaceHints.preferredProjectId;

    const pid = pidFromQuery ?? pidFromCookie;

    const requestedSiteId = String(searchParams.get("siteId") || "").trim() || undefined;
    let workspace = await withRouteDeadline(
      resolveApiKeyWorkspace({
        accountId: session.accountId!,
        requestedSiteId,
        preferredProjectId: pid ?? workspaceHints.preferredProjectId,
        activeSiteIdHint: workspaceHints.activeSiteIdHint,
        activeSiteOriginHint: workspaceHints.activeSiteOriginHint,
      }),
      "CONSOLE_WORKSPACE",
      8_000,
    ).catch(async (error) => {
      console.error("[api/console] workspace resolve failed; using workspace payload", {
        accountId: session.accountId,
        detail: error instanceof Error ? error.message : String(error),
      });
      return workspaceFromPayload(
        await withRouteDeadline(readWorkspace({ accountId: session.accountId! }), "CONSOLE_WORKSPACE_PAYLOAD", 8_000).catch(
          () => null,
        ),
      );
    });

    if (!workspace) {
      workspace = workspaceFromPayload(
        await withRouteDeadline(readWorkspace({ accountId: session.accountId! }), "CONSOLE_WORKSPACE_PAYLOAD", 8_000).catch(
          () => null,
        ),
      );
    }

    if (!workspace?.projectId) return json({ error: "PROJECT_NOT_FOUND" }, 404);

    const siteOrigin =
      String(searchParams.get("origin") || searchParams.get("siteOrigin") || "").trim() ||
      workspace.activeSite?.origin ||
      undefined;

    const requestStamp = Date.now();
    let out;
    try {
      out = await withRouteDeadline(
        getProjectSummaryForTenant({
          projectId: workspace.projectId,
          range,
          siteOrigin,
          projectKey: env("CAVBOT_PROJECT_KEY"),
          adminToken: env("CAVBOT_ADMIN_TOKEN"),
          requestId: `console_${workspace.projectId}_${requestStamp}`,
        }),
        "CONSOLE_SITE_SUMMARY",
      );
    } catch (error) {
      if (!siteOrigin) throw error;
      console.error("[api/console] site-scoped summary failed; retrying project summary", {
        projectId: workspace.projectId,
        siteOrigin,
        detail: error instanceof Error ? error.message : String(error),
      });
      out = await withRouteDeadline(
        getProjectSummaryForTenant({
          projectId: workspace.projectId,
          range,
          projectKey: env("CAVBOT_PROJECT_KEY"),
          adminToken: env("CAVBOT_ADMIN_TOKEN"),
          requestId: `console_${workspace.projectId}_${requestStamp}_project`,
        }),
        "CONSOLE_PROJECT_SUMMARY",
      );
    }

    return json(out, 200);
  } catch (error) {
    const { status, payload } = toPublicError(error);
    if (status === 401 || status === 403 || payload.error === "BAD_ORIGIN") {
      return json(payload, status);
    }

    console.error("[api/console] degraded", error);
    const reason =
      error instanceof CavBotApiError
        ? error.code || "CAVBOT_API_ERROR"
        : error instanceof Error
          ? error.message || "CONSOLE_SUMMARY_FAILED"
          : "CONSOLE_SUMMARY_FAILED";
    return json(degradedSummary(normalizeRange(req.nextUrl.searchParams.get("range")), 1, reason), 200);
  }
}
