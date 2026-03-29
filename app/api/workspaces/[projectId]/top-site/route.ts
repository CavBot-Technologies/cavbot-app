// app/api/workspaces/[projectId]/top-site/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(payload: unknown, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function parseProjectId(raw: string): number | null {
  const s = String(raw || "").trim();
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isSchemaOutOfDate(e: unknown) {
  // P2022 = column does not exist, P2021 = table does not exist
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return e.code === "P2022" || e.code === "P2021";
  }
    const msg = String((e as { message?: string })?.message || e || "");
  return msg.includes("does not exist in the current database");
}

export async function PATCH(req: NextRequest, ctx: { params: { projectId: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const projectId = parseProjectId(ctx.params.projectId);
    if (!projectId) return json({ error: "BAD_PROJECT" }, 400);

    const body = (await readSanitizedJson(req, null)) as null | { topSiteId?: string };
    const topSiteId = String(body?.topSiteId || "").trim();
    if (!topSiteId) return json({ error: "BAD_TOP_SITE" }, 400);

    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: sess.accountId! },
      select: { id: true },
    });
    if (!project) return json({ error: "NOT_FOUND" }, 404);

    const site = await prisma.site.findFirst({
      where: { id: topSiteId, projectId: project.id, isActive: true },
      select: { id: true, origin: true },
    });
    if (!site) return json({ error: "SITE_NOT_FOUND" }, 404);

    // MAIN ACTION
    await prisma.project.update({
      where: { id: project.id },
      data: { topSiteId: site.id },
    });

    // OPTIONAL NOTICE (never break the main action)
    try {
      await prisma.projectNotice.create({
        data: {
          projectId: project.id,
          tone: "GOOD",
          title: "Top site updated",
          body: `${site.origin} is now the pinned origin for this workspace.`,
        },
      });
    } catch {
      // ignore (schema may differ, notice table optional)
    }

    return json({ ok: true, topSiteId: site.id }, 200);
  } catch (e: unknown) {
    if (isSchemaOutOfDate(e)) {
      return json({ error: "DB_SCHEMA_OUT_OF_DATE" }, 409);
    }
    const msg = String((e as { message?: string })?.message || e);
    if (msg === "UNAUTHORIZED" || msg === "NO_SESSION" || msg === "UNAUTHENTICATED") {
      return json({ error: "UNAUTHENTICATED" }, 401);
    }
    if (msg === "FORBIDDEN") return json({ error: "FORBIDDEN" }, 403);
    return json({ error: "TOP_SITE_FAILED" }, 500);
  }
}
