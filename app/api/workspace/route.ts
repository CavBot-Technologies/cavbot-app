// app/api/workspace/route.ts
import "server-only";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  classifyWorkspaceBootstrapError,
  findAccountWorkspaceProject,
  resolveAccountWorkspaceProject,
} from "@/lib/workspaceProjects.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkspaceSite = {
  id: string;
  label: string;
  origin: string;
  createdAt: number;
  top?: boolean;
};

type WorkspacePayload = {
  ok: true;
  projectId: number;
  hasWorkspace: boolean;
  hasSites: boolean;
  sites: WorkspaceSite[];
  topSiteId: string;
  activeSiteId: string;
};

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

const PROJECT_SUMMARY_SELECT = {
  id: true,
  topSiteId: true,
} as const;

type WorkspaceSession = { accountId?: string | null };

function requestIdFrom(req: NextRequest) {
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

function json<T>(payload: T, init?: number | ResponseInit, rid?: string) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: withBaseHeaders(resInit.headers, rid),
  });
}

function cookieKeyActive(projectId: number) {
  return `cb_active_site_id__${projectId}`;
}

function parseProjectId(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseRequestedProjectId(req: NextRequest, bodyProjectId?: unknown) {
  return (
    parseProjectId(req.nextUrl.searchParams.get("projectId")) ??
    parseProjectId(bodyProjectId != null ? String(bodyProjectId) : null)
  );
}

function parseFallbackProjectId(req: NextRequest) {
  return (
    parseProjectId(req.cookies.get("cb_active_project_id")?.value || "") ??
    parseProjectId(req.cookies.get("cb_pid")?.value || "")
  );
}

function emptyPayload(): WorkspacePayload {
  return {
    ok: true,
    projectId: 0,
    hasWorkspace: false,
    hasSites: false,
    sites: [],
    topSiteId: "",
    activeSiteId: "",
  };
}

function mapAuthError(e: unknown): { status: number; payload: Record<string, unknown> } {
  if (isApiAuthError(e)) {
    const status = e.status || 401;
    const code = e.code || "UNAUTHORIZED";
    if (status === 403) return { status, payload: { ok: false, error: "FORBIDDEN" } };
    return { status, payload: { ok: false, error: code === "UNAUTHORIZED" ? "UNAUTHENTICATED" : code } };
  }

  return { status: 500, payload: { ok: false, error: "WORKSPACE_FAILED" } };
}

function workspaceBootstrapFailureResponse(
  rid: string,
  accountId: string | null | undefined,
  error: unknown
) {
  const classified = classifyWorkspaceBootstrapError(error);
  console.error("[workspace-bootstrap]", {
    route: "/api/workspace",
    requestId: rid,
    accountId: accountId || null,
    errorCode: classified.error,
    detail: error instanceof Error ? error.message : String(error),
  });
  return json(
    {
      ok: false,
      error: classified.error,
      requestId: rid,
      retryable: classified.retryable,
    },
    classified.status,
    rid
  );
}

async function resolveWorkspaceProjectForRead(req: NextRequest, sess: WorkspaceSession) {
  return resolveAccountWorkspaceProject({
    accountId: sess.accountId!,
    select: PROJECT_SUMMARY_SELECT,
    requestedProjectId: parseRequestedProjectId(req),
    fallbackProjectId: parseFallbackProjectId(req),
    ensureActive: true,
  });
}

async function resolveWorkspaceProjectForMutation(
  req: NextRequest,
  sess: WorkspaceSession,
  bodyProjectId?: unknown
) {
  const requestedProjectId = parseRequestedProjectId(req, bodyProjectId);
  if (requestedProjectId) {
    return findAccountWorkspaceProject({
      accountId: sess.accountId!,
      projectId: requestedProjectId,
      select: PROJECT_SUMMARY_SELECT,
    });
  }

  return resolveAccountWorkspaceProject({
    accountId: sess.accountId!,
    select: PROJECT_SUMMARY_SELECT,
    fallbackProjectId: parseFallbackProjectId(req),
    ensureActive: true,
  });
}

export async function GET(req: NextRequest) {
  const rid = requestIdFrom(req);
  let accountId: string | null = null;

  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    accountId = sess.accountId || null;

    const project = await resolveWorkspaceProjectForRead(req, sess);
    if (!project) return json(emptyPayload(), 200, rid);

    const rows = await prisma.site.findMany({
      where: { projectId: project.id, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, origin: true, createdAt: true },
    });

    const sites: WorkspaceSite[] = rows.map((row) => ({
      id: row.id,
      label: row.label,
      origin: row.origin,
      createdAt: row.createdAt.getTime(),
      top: project.topSiteId ? row.id === project.topSiteId : false,
    }));

    const hasSites = sites.length > 0;
    const firstId = sites[0]?.id || "";
    const topSiteIdRaw = String(project.topSiteId || "").trim();
    const hasTopSite = !!topSiteIdRaw && sites.some((site) => site.id === topSiteIdRaw);

    const activeCookie = String(req.cookies.get(cookieKeyActive(project.id))?.value || "").trim();
    const hasActiveCookie = !!activeCookie && sites.some((site) => site.id === activeCookie);

    const activeSiteId = hasSites ? (hasActiveCookie ? activeCookie : hasTopSite ? topSiteIdRaw : firstId) : "";
    const topSiteId = hasSites ? (hasTopSite ? topSiteIdRaw : activeSiteId || firstId) : "";

    return json(
      {
        ok: true,
        projectId: project.id,
        hasWorkspace: true,
        hasSites,
        sites,
        topSiteId,
        activeSiteId,
      } satisfies WorkspacePayload,
      200,
      rid
    );
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      const { status, payload } = mapAuthError(error);
      return json({ ...payload, requestId: rid }, status, rid);
    }
    return workspaceBootstrapFailureResponse(rid, accountId, error);
  }
}

export async function POST(req: NextRequest) {
  const rid = requestIdFrom(req);
  let accountId: string | null = null;

  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    accountId = sess.accountId || null;

    const body = (await readSanitizedJson(req, null)) as
      | null
      | { projectId?: number | string; activeSiteId?: string };

    const project = await resolveWorkspaceProjectForMutation(req, sess, body?.projectId);
    if (!project) {
      return json({ ok: false, error: "NOT_FOUND", requestId: rid }, 404, rid);
    }

    const activeSiteId = String(body?.activeSiteId || "").trim();
    if (activeSiteId) {
      const site = await prisma.site.findFirst({
        where: { id: activeSiteId, projectId: project.id, isActive: true },
        select: { id: true },
      });
      if (!site) return json({ ok: false, error: "SITE_NOT_FOUND", requestId: rid }, 404, rid);
    }

    const res = json({ ok: true, requestId: rid }, 200, rid);
    res.cookies.set(cookieKeyActive(project.id), activeSiteId || "", {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: activeSiteId ? 60 * 60 * 24 * 30 : 0,
    });

    return res;
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      const { status, payload } = mapAuthError(error);
      return json({ ...payload, requestId: rid }, status, rid);
    }
    return workspaceBootstrapFailureResponse(rid, accountId, error);
  }
}

export async function DELETE(req: NextRequest) {
  const rid = requestIdFrom(req);
  let accountId: string | null = null;

  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    accountId = sess.accountId || null;

    const project = await resolveWorkspaceProjectForMutation(req, sess);
    if (!project) return json({ ok: true, requestId: rid }, 200, rid);

    const res = json({ ok: true, requestId: rid }, 200, rid);
    res.cookies.set(cookieKeyActive(project.id), "", {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 0,
    });

    return res;
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      const { status, payload } = mapAuthError(error);
      return json({ ...payload, requestId: rid }, status, rid);
    }
    return workspaceBootstrapFailureResponse(rid, accountId, error);
  }
}

export async function OPTIONS(req: NextRequest) {
  const rid = requestIdFrom(req);
  return new NextResponse(null, {
    status: 204,
    headers: withBaseHeaders({ Allow: "GET,POST,DELETE,OPTIONS" }, rid),
  });
}
