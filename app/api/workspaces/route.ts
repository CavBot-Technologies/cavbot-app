// app/api/workspaces/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  classifyWorkspaceBootstrapError,
  listAccountWorkspaceProjects,
  resolveAccountWorkspaceProject,
} from "@/lib/workspaceProjects.server";
import { requireWorkspaceResilientSession } from "@/lib/workspaceAuth.server";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

const WORKSPACES_ROUTE_TIMEOUT_MS = 3_000;
const WORKSPACES_SESSION_TIMEOUT_MS = 1_500;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type ListWorkspacesBody = { includeInactive?: boolean };

type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "SERVER_ERROR"
  | "METHOD_NOT_ALLOWED";

class WorkspaceBootstrapStageError extends Error {
  stage: "resolve_active_project" | "list_projects";
  cause: unknown;

  constructor(stage: "resolve_active_project" | "list_projects", cause: unknown) {
    super(`Workspace bootstrap failed during ${stage}.`);
    this.name = "WorkspaceBootstrapStageError";
    this.stage = stage;
    this.cause = cause;
  }
}

function requestIdFrom(req: NextRequest) {
  // Prefer upstream-provided id (load balancer / proxy), else generate.
  const incoming =
    req.headers.get("x-request-id") ||
    req.headers.get("x-vercel-id") ||
    req.headers.get("cf-ray");
  return (incoming && incoming.trim()) || crypto.randomUUID();
}

function withBaseHeaders(headers?: HeadersInit, rid?: string) {
  const base: Record<string, string> = { ...NO_STORE_HEADERS };
  if (rid) base["x-cavbot-request-id"] = rid;
  return { ...(headers || {}), ...base };
}

function json(data: unknown, init?: number | ResponseInit, rid?: string) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: withBaseHeaders(resInit.headers, rid),
  });
}

async function withWorkspacesDeadline<T>(
  promise: Promise<T>,
  timeoutMs = WORKSPACES_ROUTE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("WORKSPACES_ROUTE_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fallbackProjectIdFromReq(req: NextRequest) {
  return (
    parseProjectId(req.cookies.get("cb_active_project_id")?.value) ??
    parseProjectId(req.cookies.get("cb_pid")?.value)
  );
}

function degradedProjectsFallback(req: NextRequest, rid: string) {
  const fallbackProjectId = fallbackProjectIdFromReq(req);
  if (!fallbackProjectId) return null;

  return json(
    {
      projects: [
        {
          id: fallbackProjectId,
          name: "Default Project",
          slug: "default",
          region: "US-WEST",
          retentionDays: 30,
          topSiteId: null,
          createdAt: new Date(0).toISOString(),
        },
      ],
      activeProjectId: fallbackProjectId,
      degraded: true,
      requestId: rid,
    },
    200,
    rid,
  );
}

function boolFromString(v: string | null): boolean | null {
  if (v == null) return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return null;
}

function includeInactiveFromQuery(req: NextRequest): boolean {
  const b = boolFromString(req.nextUrl.searchParams.get("includeInactive"));
  return b === true;
}

async function safeJsonBody<T>(req: NextRequest): Promise<T | null> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    return (await readSanitizedJson(req, null)) as T | null;
  } catch {
    return null;
  }
}

function parseProjectId(v: string | undefined | null): number | null {
  if (!v) return null;
  const n = Number(String(v).trim());
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (n <= 0) return null;
  return n;
}

async function listWorkspaces(
  req: NextRequest,
  accountId: string,
  includeInactive: boolean
) {
  let activeProject: { id: number } | null = null;
  try {
    activeProject = await resolveAccountWorkspaceProject({
      accountId,
      select: { id: true },
      requestedProjectId: parseProjectId(req.cookies.get("cb_active_project_id")?.value),
      fallbackProjectId: parseProjectId(req.cookies.get("cb_pid")?.value),
      includeInactive: false,
      ensureActive: true,
    });
  } catch (error) {
    throw new WorkspaceBootstrapStageError("resolve_active_project", error);
  }
  const activeProjectId = activeProject?.id ?? null;

  let projects: Array<{
    id: number;
    name: string | null;
    slug: string;
    region: string;
    retentionDays: number;
    topSiteId: string | null;
    createdAt: Date;
  }> = [];
  try {
    // Keep workspace bootstrap flat and minimal.
    // Route/site metadata is loaded on follow-up reads after the active project is known.
    projects = await listAccountWorkspaceProjects(accountId, includeInactive);
  } catch (error) {
    throw new WorkspaceBootstrapStageError("list_projects", error);
  }

  // Return JSON-safe timestamps (clean client hydration)
  const out = projects.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    region: p.region,
    retentionDays: p.retentionDays,
    topSiteId: p.topSiteId,
    createdAt: p.createdAt.toISOString(),
  }));

  return { projects: out, activeProjectId: activeProjectId ?? null };
}

function mapError(e: unknown): { status: number; payload: Record<string, unknown> } {
  if (isApiAuthError(e)) {
    // apiAuth owns the status/code surface
    const status = e.status || 401;
    const code = e.code || "UNAUTHORIZED";
    return { status, payload: { error: code } };
  }

  // Never leak internals
  return { status: 500, payload: { error: "SERVER_ERROR" as ApiErrorCode } };
}

function methodNotAllowed(rid: string) {
  return json(
    { error: "METHOD_NOT_ALLOWED" as ApiErrorCode },
    {
      status: 405,
      headers: {
        Allow: "GET, POST, OPTIONS",
      },
    },
    rid
  );
}

function workspaceBootstrapFailureResponse(
  rid: string,
  accountId: string | null | undefined,
  error: unknown
) {
  const stage = error instanceof WorkspaceBootstrapStageError ? error.stage : null;
  const sourceError = error instanceof WorkspaceBootstrapStageError ? error.cause : error;
  const classified = classifyWorkspaceBootstrapError(sourceError);
  console.error("[workspace-bootstrap]", {
    route: "/api/workspaces",
    stage,
    requestId: rid,
    accountId: accountId || null,
    errorCode: classified.error,
    detail: sourceError instanceof Error ? sourceError.message : String(sourceError),
  });
  return json(
    {
      error: classified.error,
      requestId: rid,
      retryable: classified.retryable,
    },
    classified.status,
    rid
  );
}

/**
 * OPTIONS /api/workspaces
 * CORS/preflight friendly (even if same-origin)
 */
export async function OPTIONS(req: NextRequest) {
  const rid = requestIdFrom(req);
  return new NextResponse(null, {
    status: 204,
    headers: withBaseHeaders(
      {
        Allow: "GET, POST, OPTIONS",
      },
      rid
    ),
  });
}

/**
 * GET /api/workspaces?includeInactive=1
 * Preferred read-only list.
 */
export async function GET(req: NextRequest) {
  const rid = requestIdFrom(req);
  let accountId: string | null = null;
  try {
    const sess = await withWorkspacesDeadline(
      requireWorkspaceResilientSession(req),
      WORKSPACES_SESSION_TIMEOUT_MS,
    );
    accountId = sess.accountId || null;

    const includeInactive = includeInactiveFromQuery(req);
    const out = await withWorkspacesDeadline(listWorkspaces(req, accountId!, includeInactive));
    return json(out, 200, rid);
  } catch (e) {
    if (isApiAuthError(e)) {
      const { status, payload } = mapError(e);
      return json({ ...payload, requestId: rid }, status, rid);
    }
    const degraded = degradedProjectsFallback(req, rid);
    if (degraded) return degraded;
    return workspaceBootstrapFailureResponse(rid, accountId, e);
  }
}

/**
 * POST /api/workspaces
 * Legacy compatibility: { includeInactive?: boolean }
 * Also accepts includeInactive via querystring for flexibility.
 */
export async function POST(req: NextRequest) {
  const rid = requestIdFrom(req);
  let accountId: string | null = null;
  try {
    const sess = await withWorkspacesDeadline(
      requireWorkspaceResilientSession(req),
      WORKSPACES_SESSION_TIMEOUT_MS,
    );
    accountId = sess.accountId || null;

    const body = (await safeJsonBody<ListWorkspacesBody>(req)) || {};
    const includeInactive = Boolean(body.includeInactive) || includeInactiveFromQuery(req);

    const out = await withWorkspacesDeadline(listWorkspaces(req, accountId!, includeInactive));
    return json(out, 200, rid);
  } catch (e) {
    if (isApiAuthError(e)) {
      const { status, payload } = mapError(e);
      return json({ ...payload, requestId: rid }, status, rid);
    }
    const degraded = degradedProjectsFallback(req, rid);
    if (degraded) return degraded;
    return workspaceBootstrapFailureResponse(rid, accountId, e);
  }
}

// Safety: if something hits another method somehow (rare), return 405.
// (App Router won’t call this automatically, but keeping the intent clear.)
export async function PUT(req: NextRequest) {
  return methodNotAllowed(requestIdFrom(req));
}
export async function PATCH(req: NextRequest) {
  return methodNotAllowed(requestIdFrom(req));
}
export async function DELETE(req: NextRequest) {
  return methodNotAllowed(requestIdFrom(req));
}
