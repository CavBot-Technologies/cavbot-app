// app/api/workspaces/[projectId]/notices/route.ts
import { NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireWorkspaceSession } from "@/lib/workspaceAuth.server";
import { getAuthPool } from "@/lib/authDb";
import { findOwnedWorkspaceProjectForSites } from "@/lib/workspaceSites.server";

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

export async function GET(req: Request, ctx: { params: { projectId: string } }) {
  try {
    const sess = await requireWorkspaceSession(req);

    const projectId = parseProjectId(ctx.params.projectId);
    if (!projectId) return json({ error: "BAD_PROJECT" }, 400);

    const project = await findOwnedWorkspaceProjectForSites(sess.accountId!, projectId);
    if (!project) return json({ error: "NOT_FOUND" }, 404);

    const noticeResult = await getAuthPool().query<{
      id: string;
      tone: string;
      title: string;
      body: string;
      createdAt: Date | string;
    }>(
      `SELECT "id", "tone", "title", "body", "createdAt"
       FROM "ProjectNotice"
       WHERE "projectId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 20`,
      [project.id]
    );

    return json(
      {
        notices: noticeResult.rows.map((notice) => ({
          id: notice.id,
          tone: notice.tone,
          title: notice.title,
          body: notice.body,
          createdAt: notice.createdAt instanceof Date ? notice.createdAt : new Date(notice.createdAt),
        })),
      },
      200
    );
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ error: e.code }, e.status);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}
