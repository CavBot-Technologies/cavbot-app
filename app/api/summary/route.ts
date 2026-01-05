// app/api/summary/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireSession } from "@/lib/apiAuth";
import { getProjectSummary } from "@/lib/cavbotApi.server";
export const runtime = "edge";
export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const { searchParams } = new URL(req.url);

    const projectIdRaw = (searchParams.get("projectId") ?? "").trim();
    const projectSlug = (searchParams.get("projectSlug") ?? "").trim();

    let project = null as any;

    if (projectIdRaw) {
      const pid = Number(projectIdRaw);
      if (!Number.isFinite(pid)) {
        return NextResponse.json({ ok: false, error: "projectId must be a number" }, { status: 400 });
      }
      project = await prisma.project.findFirst({
        where: { id: pid, accountId: session.accountId!, isActive: true },
      });
    } else if (projectSlug) {
      project = await prisma.project.findFirst({
        where: { slug: projectSlug, accountId: session.accountId!, isActive: true },
      });
    } else {
      project = await prisma.project.findFirst({
        where: { accountId: session.accountId!, isActive: true },
        orderBy: { createdAt: "asc" },
      });
    }

    if (!project) {
      return NextResponse.json({ ok: false, error: "project_not_found" }, { status: 404 });
    }

    const data = await getProjectSummary(String(project.id), { range: "30d" });

    return NextResponse.json(
      { ok: true, project: { id: project.id, slug: project.slug, name: project.name }, data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { ok: false, error: "summary_proxy_failed", message: msg },
      { status: 500 }
    );
  }
}