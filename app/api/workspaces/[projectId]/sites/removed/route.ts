// app/api/workspaces/[projectId]/sites/removed/route.ts

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";

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

function parseProjectId(raw: unknown) {
  const s = String(raw || "").trim();
  if (!/^\d+$/.test(s)) throw new Error("BAD_PROJECT_ID");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error("BAD_PROJECT_ID");
  return n;
}

export async function GET(
  req: Request,
  ctx: { params: { projectId: string } }
) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const projectId = parseProjectId(ctx.params.projectId);

    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: sess.accountId },
      select: { id: true },
    });
    if (!project) return json({ error: "NOT_FOUND" }, 404);

    const now = new Date();
    const deletions = await prisma.siteDeletion.findMany({
      where: {
        projectId,
        status: "SCHEDULED",
        purgeScheduledAt: { gt: now },
      },
      orderBy: { purgeScheduledAt: "asc" },
      select: {
        siteId: true,
        origin: true,
        requestedAt: true,
        purgeScheduledAt: true,
      },
    });

    return json({
      sites: deletions.map((record) => ({
        siteId: record.siteId,
        origin: record.origin || "",
        removedAt: record.requestedAt?.toISOString() || new Date().toISOString(),
        purgeAt: record.purgeScheduledAt?.toISOString() || new Date().toISOString(),
      })),
    });
  } catch (e: unknown) {
    if (isApiAuthError(e)) {
      return json({ error: e.code }, e.status);
    }
    return json({ error: "SERVER_ERROR" }, 500);
  }
}
