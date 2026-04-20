import "server-only";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireLowRiskWriteSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  findActiveWorkspaceSite,
  findActiveWorkspaceSiteByOrigin,
} from "@/lib/workspaceSites.server";
import { findAccountWorkspaceProject, resolveAccountWorkspaceProject } from "@/lib/workspaceProjects.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

const KEY_ACTIVE_PROJECT_ID = "cb_active_project_id";
const KEY_ACTIVE_SITE_ORIGIN_PREFIX = "cb_active_site_origin__";
const KEY_TOP_SITE_ORIGIN_PREFIX = "cb_top_site_origin__";
const KEY_ACTIVE_SITE_ID_PREFIX = "cb_active_site_id__";

type WorkspaceSelectionPayload = Record<string, unknown>;
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

function json(payload: WorkspaceSelectionPayload, init?: number | ResponseInit, rid?: string) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: withBaseHeaders(resInit.headers, rid),
  });
}

function parseProjectId(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeMaybeOrigin(input: unknown): string | undefined {
  const raw = String(input ?? "").trim();
  if (!raw) return undefined;

  const withProto =
    raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;

  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    throw new Error("BAD_ORIGIN");
  }

  if (!u.hostname || u.hostname.includes("..")) throw new Error("BAD_ORIGIN");
  if (u.username || u.password) throw new Error("BAD_ORIGIN");

  return u.origin;
}

function setCookie(res: NextResponse, key: string, value: string) {
  const v = String(value ?? "").trim();
  if (!v) {
    res.cookies.delete(key);
    return;
  }

  // Store as encoded so origins are safe
  res.cookies.set(key, encodeURIComponent(v), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30d
  });
}

function toPublicError(e: unknown) {
  if (isApiAuthError(e)) {
    const status = e.status ?? 401;
    const code = String(e.code || "UNAUTHORIZED");
    if (code === "BAD_ORIGIN") return { status: 403, payload: { error: "BAD_ORIGIN" } };
    if (status === 403) return { status: 403, payload: { error: "FORBIDDEN" } };
    return { status: 401, payload: { error: "UNAUTHENTICATED" } };
  }
  const msg = String((e as { message?: unknown })?.message ?? e);
  if (msg === "BAD_ORIGIN") {
    return { status: 400, payload: { error: "BAD_ORIGIN" } };
  }
  return { status: 500, payload: { error: "WORKSPACE_SELECTION_SYNC_FAILED" } };
}

type WorkspaceSelectionBody = {
  projectId?: unknown;
  activeSiteId?: unknown;
  topSiteId?: unknown;
  activeSiteOrigin?: unknown;
  topSiteOrigin?: unknown;
};

export async function POST(req: NextRequest) {
  const rid = requestIdFrom(req);

  try {
    const session = await requireLowRiskWriteSession(req);
    requireAccountContext(session);

    const body = (await readSanitizedJson(req, ({}))) as WorkspaceSelectionBody;

    const requestedProjectId = parseProjectId(body?.projectId);
    const project = requestedProjectId
      ? await findAccountWorkspaceProject({
          accountId: session.accountId!,
          projectId: requestedProjectId,
          select: { id: true },
        })
      : await resolveAccountWorkspaceProject({
          accountId: session.accountId!,
          select: { id: true },
          requestedProjectId: parseProjectId(req.cookies.get(KEY_ACTIVE_PROJECT_ID)?.value),
          fallbackProjectId: parseProjectId(req.cookies.get("cb_pid")?.value),
          ensureActive: true,
        });

    if (!project) {
      return json({ error: "PROJECT_NOT_FOUND", requestId: rid }, 404, rid);
    }

    const projectId = project.id;

    const pidStr = String(projectId);

    // Prefer IDs; fall back to origins if ids not provided
    const activeSiteId = String(body?.activeSiteId ?? "").trim();
    const topSiteId = String(body?.topSiteId ?? "").trim();

    let activeSiteOrigin = normalizeMaybeOrigin(body?.activeSiteOrigin);
    let topSiteOrigin = normalizeMaybeOrigin(body?.topSiteOrigin);

    // Resolve origins from DB if IDs provided (this is the key fix)
    if (activeSiteId) {
      const s = await findActiveWorkspaceSite(projectId, activeSiteId);
      if (!s) return json({ error: "ACTIVE_SITE_NOT_FOUND", requestId: rid }, 404, rid);
      activeSiteOrigin = s.origin;
    } else if (activeSiteOrigin) {
      // validate origin belongs to this project
      const s = await findActiveWorkspaceSiteByOrigin(projectId, activeSiteOrigin);
      if (!s) return json({ error: "ACTIVE_ORIGIN_NOT_FOUND", requestId: rid }, 404, rid);
    }

    if (topSiteId) {
      const s = await findActiveWorkspaceSite(projectId, topSiteId);
      if (!s) return json({ error: "TOP_SITE_NOT_FOUND", requestId: rid }, 404, rid);
      topSiteOrigin = s.origin;
    } else if (topSiteOrigin) {
      const s = await findActiveWorkspaceSiteByOrigin(projectId, topSiteOrigin);
      if (!s) return json({ error: "TOP_ORIGIN_NOT_FOUND", requestId: rid }, 404, rid);
    }

    // Write cookies (Command Center -> Server context)
    const res = json(
      {
        ok: true,
        projectId,
        activeSiteId: activeSiteId || undefined,
        activeSiteOrigin: activeSiteOrigin || undefined,
        topSiteId: topSiteId || undefined,
        topSiteOrigin: topSiteOrigin || undefined,
        requestId: rid,
      },
      200,
      rid
    );

    setCookie(res, KEY_ACTIVE_PROJECT_ID, pidStr);
    setCookie(res, `${KEY_ACTIVE_SITE_ID_PREFIX}${pidStr}`, activeSiteId);
    setCookie(res, `${KEY_ACTIVE_SITE_ORIGIN_PREFIX}${pidStr}`, activeSiteOrigin || "");
    setCookie(res, `${KEY_TOP_SITE_ORIGIN_PREFIX}${pidStr}`, topSiteOrigin || "");

    return res;
  } catch (e: unknown) {
    const { status, payload } = toPublicError(e);
    return json({ ...payload, requestId: rid }, status, rid);
  }
}
