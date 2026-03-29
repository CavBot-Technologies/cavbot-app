// app/api/workspaces/[projectId]/notices/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";

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
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const projectId = parseProjectId(ctx.params.projectId);
    if (!projectId) return json({ error: "BAD_PROJECT" }, 400);

    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: sess.accountId },
      select: { id: true },
    });
    if (!project) return json({ error: "NOT_FOUND" }, 404);

    const notices = await prisma.projectNotice.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, tone: true, title: true, body: true, createdAt: true },
    });

    return json({ notices }, 200);
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ error: e.code }, e.status);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}
