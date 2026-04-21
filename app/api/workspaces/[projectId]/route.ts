// app/api/workspaces/[projectId]/route.ts
import { NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";
import { requireWorkspaceSession } from "@/lib/workspaceAuth.server";
import { getAuthPool } from "@/lib/authDb";
import { createProjectNoticeEntry, findActiveWorkspaceSite, findOwnedWorkspaceProjectForSites } from "@/lib/workspaceSites.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function PATCH(req: Request, ctx: { params: { projectId: string } }) {
  try {
    const sess = await requireWorkspaceSession(req);

    const projectId = parseProjectId(ctx.params.projectId);
    if (!projectId) return json({ error: "BAD_PROJECT" }, 400);

    const body = (await readSanitizedJson(req, null)) as null | { topSiteId?: string };
    const topSiteId = (body?.topSiteId || "").trim();
    if (!topSiteId) return json({ error: "BAD_TOP_SITE" }, 400);

    const project = await findOwnedWorkspaceProjectForSites(sess.accountId!, projectId);
    if (!project) return json({ error: "NOT_FOUND" }, 404);

    const site = await findActiveWorkspaceSite(project.id, topSiteId);
    if (!site) return json({ error: "SITE_NOT_FOUND" }, 404);

    await getAuthPool().query(
      `UPDATE "Project"
       SET "topSiteId" = $2,
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      [project.id, site.id]
    );

    await createProjectNoticeEntry({
      projectId: project.id,
      tone: "GOOD",
      title: "Top site updated",
      body: `${site.origin} is now the pinned origin for this workspace.`,
    });

    return json({ ok: true, topSiteId: site.id }, 200);
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ error: e.code }, e.status);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}
