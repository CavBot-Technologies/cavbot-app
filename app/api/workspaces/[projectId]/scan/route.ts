// app/api/workspaces/[projectId]/scan/route.ts
import { NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { requestScan, ScanRequestError } from "@/lib/scanner";
import { readSanitizedJson } from "@/lib/security/userInput";
import { findAccountWorkspaceProject } from "@/lib/workspaceProjects.server";
import { requireWorkspaceSession } from "@/lib/workspaceAuth.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(data: unknown, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function parseProjectId(raw: string): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// Next 15+ params can be Promise-like; normalize to avoid undefined project ids.
async function getParams(ctx: unknown): Promise<{ projectId?: string }> {
  if (typeof ctx === "object" && ctx !== null) {
    const params = (ctx as { params?: { projectId?: string } }).params;
    return Promise.resolve(params ?? {});
  }
  return Promise.resolve({});
}

type ScanBody = {
  siteId?: string;
  reason?: string;
};

export async function POST(req: Request, ctx: unknown) {
  try {
    const sess = await requireWorkspaceSession(req);
    const accountId = String(sess.accountId || "").trim();
    if (!accountId) return json({ error: "UNAUTHORIZED" }, 401);

    const params = await getParams(ctx);
    const projectId = parseProjectId(params.projectId || "");
    if (!projectId) return json({ error: "BAD_PROJECT" }, 400);

    const project = await findAccountWorkspaceProject({
      accountId,
      projectId,
      select: { id: true, topSiteId: true },
    });
    if (!project) return json({ error: "NOT_FOUND" }, 404);

    const body = (await readSanitizedJson(req, null)) as ScanBody | null;
    const resolvedSiteId =
      (typeof body?.siteId === "string" ? body.siteId.trim() : "") ||
      (project.topSiteId ? String(project.topSiteId).trim() : "");

    if (!resolvedSiteId) return json({ error: "NO_SITE_SELECTED" }, 400);

    const ip =
      (req.headers.get("cf-connecting-ip") ||
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("true-client-ip")) ??
      null;
    const userAgent = req.headers.get("user-agent") ?? null;

    const result = await requestScan({
      projectId: project.id,
      siteId: resolvedSiteId,
      accountId,
      operatorUserId: sess.sub,
      ip,
      userAgent,
      reason: body?.reason,
    });

    return json({ ok: true, ...result }, 201);
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ error: e.code }, e.status);
    if (e instanceof ScanRequestError) {
      return json({ error: e.code, message: e.message }, e.status);
    }
    return json({ error: "SERVER_ERROR" }, 500);
  }
}
