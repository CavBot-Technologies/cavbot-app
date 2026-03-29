// app/api/workspace/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";

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
  projectId: number;          // 0 when no project exists yet
  hasWorkspace: boolean;      // false when no project exists yet
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

function json<T>(payload: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function cookieKeyActive(projectId: number) {
  return `cb_active_site_id__${projectId}`;
}

function parseProjectId(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function asHttpError(e: unknown) {
  const msg = String((e as { message?: unknown })?.message || e);
  if (msg === "UNAUTHORIZED" || msg === "NO_SESSION" || msg === "UNAUTHENTICATED") {
    return { status: 401, payload: { ok: false, error: "UNAUTHENTICATED" } };
  }
  if (msg === "FORBIDDEN") return { status: 403, payload: { ok: false, error: "FORBIDDEN" } };
  return { status: 500, payload: { ok: false, error: "WORKSPACE_FAILED" } };
}

type WorkspaceSession = { accountId?: string | null };

async function resolveProjectId(req: NextRequest, sess: WorkspaceSession, bodyProjectId?: unknown) {
  const q = parseProjectId(req.nextUrl.searchParams.get("projectId"));
  if (q) return q;

  const b = parseProjectId(bodyProjectId != null ? String(bodyProjectId) : null);
  if (b) return b;

  const c1 = parseProjectId(req.cookies.get("cb_active_project_id")?.value || "");
  if (c1) return c1;

  const c2 = parseProjectId(req.cookies.get("cb_pid")?.value || "");
  if (c2) return c2;

  const first = await prisma.project.findFirst({
    where: { accountId: sess.accountId! },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  return first?.id ?? null;
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

export async function GET(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const requested = await resolveProjectId(req, sess);

    // No projects exist yet for this account
    if (!requested) return json(emptyPayload(), 200);

    // If cookie/query points to a missing project, fall back to first project
    let project = await prisma.project.findFirst({
      where: { id: requested, accountId: sess.accountId! },
      select: { id: true, topSiteId: true },
    });

    if (!project) {
      project = await prisma.project.findFirst({
        where: { accountId: sess.accountId! },
        select: { id: true, topSiteId: true },
        orderBy: { id: "asc" },
      });
    }

    if (!project) return json(emptyPayload(), 200);

    const rows = await prisma.site.findMany({
      where: { projectId: project.id, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, origin: true, createdAt: true },
    });

    const sites: WorkspaceSite[] = rows.map((r) => ({
      id: r.id,
      label: r.label,
      origin: r.origin,
      createdAt: r.createdAt.getTime(),
      top: project.topSiteId ? r.id === project.topSiteId : false,
    }));

    const hasSites = sites.length > 0;

    const firstId = sites[0]?.id || "";
    const topIdRaw = String(project.topSiteId || "").trim();
    const topOk = !!topIdRaw && sites.some((s) => s.id === topIdRaw);

    const cookieVal = (req.cookies.get(cookieKeyActive(project.id))?.value || "").trim();
    const activeOk = !!cookieVal && sites.some((s) => s.id === cookieVal);

    const activeSiteId = hasSites ? (activeOk ? cookieVal : topOk ? topIdRaw : firstId) : "";
    const topSiteId = hasSites ? (topOk ? topIdRaw : activeSiteId || firstId) : "";

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
      200
    );
  } catch (e: unknown) {
    const { status, payload } = asHttpError(e);
    return json(payload, status);
  }
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const body = (await readSanitizedJson(req, null)) as
      | null
      | { projectId?: number | string; activeSiteId?: string };

    const projectId = await resolveProjectId(req, sess, body?.projectId);
    if (!projectId) return json(emptyPayload(), 200);

    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: sess.accountId! },
      select: { id: true },
    });

    if (!project) return json(emptyPayload(), 200);

    const activeSiteId = String(body?.activeSiteId || "").trim();

    if (activeSiteId) {
      const site = await prisma.site.findFirst({
        where: { id: activeSiteId, projectId: project.id, isActive: true },
        select: { id: true },
      });
      if (!site) return json({ ok: false, error: "SITE_NOT_FOUND" }, 404);
    }

    const res = json({ ok: true }, 200);

    const secure = process.env.NODE_ENV === "production";

    res.cookies.set(cookieKeyActive(project.id), activeSiteId || "", {
      path: "/",
      sameSite: "lax",
      secure,
      httpOnly: true,
      maxAge: activeSiteId ? 60 * 60 * 24 * 30 : 0,
    });

    return res;
  } catch (e: unknown) {
    const { status, payload } = asHttpError(e);
    return json(payload, status);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const projectId = await resolveProjectId(req, sess);
    if (!projectId) return json({ ok: true }, 200);

    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: sess.accountId! },
      select: { id: true },
    });

    if (!project) return json({ ok: true }, 200);

    const res = json({ ok: true }, 200);

    res.cookies.set(cookieKeyActive(project.id), "", {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 0,
    });

    return res;
  } catch (e: unknown) {
    const { status, payload } = asHttpError(e);
    return json(payload, status);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET,POST,DELETE,OPTIONS" },
  });
}
