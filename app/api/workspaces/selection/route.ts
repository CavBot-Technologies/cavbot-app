import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";

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
function json(payload: WorkspaceSelectionPayload, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
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
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const body = (await readSanitizedJson(req, ({}))) as WorkspaceSelectionBody;

    const projectId =
      parseProjectId(body?.projectId) ??
      parseProjectId(req.cookies.get(KEY_ACTIVE_PROJECT_ID)?.value) ??
      1;

    // Ensure project belongs to this account
    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: session.accountId!, isActive: true },
      select: { id: true },
    });
    if (!project) return json({ error: "PROJECT_NOT_FOUND" }, 404);

    const pidStr = String(projectId);

    // Prefer IDs; fall back to origins if ids not provided
    const activeSiteId = String(body?.activeSiteId ?? "").trim();
    const topSiteId = String(body?.topSiteId ?? "").trim();

    let activeSiteOrigin = normalizeMaybeOrigin(body?.activeSiteOrigin);
    let topSiteOrigin = normalizeMaybeOrigin(body?.topSiteOrigin);

    // Resolve origins from DB if IDs provided (this is the key fix)
    if (activeSiteId) {
      const s = await prisma.site.findFirst({
        where: { id: activeSiteId, projectId, isActive: true },
        select: { origin: true },
      });
      if (!s) return json({ error: "ACTIVE_SITE_NOT_FOUND" }, 404);
      activeSiteOrigin = s.origin;
    } else if (activeSiteOrigin) {
      // validate origin belongs to this project
      const s = await prisma.site.findFirst({
        where: { projectId, isActive: true, origin: activeSiteOrigin },
        select: { id: true },
      });
      if (!s) return json({ error: "ACTIVE_ORIGIN_NOT_FOUND" }, 404);
    }

    if (topSiteId) {
      const s = await prisma.site.findFirst({
        where: { id: topSiteId, projectId, isActive: true },
        select: { origin: true },
      });
      if (!s) return json({ error: "TOP_SITE_NOT_FOUND" }, 404);
      topSiteOrigin = s.origin;
    } else if (topSiteOrigin) {
      const s = await prisma.site.findFirst({
        where: { projectId, isActive: true, origin: topSiteOrigin },
        select: { id: true },
      });
      if (!s) return json({ error: "TOP_ORIGIN_NOT_FOUND" }, 404);
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
      },
      200
    );

    setCookie(res, KEY_ACTIVE_PROJECT_ID, pidStr);
    setCookie(res, `${KEY_ACTIVE_SITE_ID_PREFIX}${pidStr}`, activeSiteId);
    setCookie(res, `${KEY_ACTIVE_SITE_ORIGIN_PREFIX}${pidStr}`, activeSiteOrigin || "");
    setCookie(res, `${KEY_TOP_SITE_ORIGIN_PREFIX}${pidStr}`, topSiteOrigin || "");

    return res;
  } catch (e: unknown) {
    const { status, payload } = toPublicError(e);
    return json(payload, status);
  }
}
