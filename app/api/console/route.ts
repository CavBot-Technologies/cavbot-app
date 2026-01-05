// app/api/console/route.ts
import "server-only";
import type { SummaryRange } from "@/lib/cavbotApi.server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireSession } from "@/lib/apiAuth";
import { getProjectSummary } from "@/lib/cavbotApi.server";

export const dynamic = "force-dynamic";
export const runtime = "edge";
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const { searchParams } = new URL(req.url);

    const rangeParam = (searchParams.get("range") ?? "30d").trim();
    const range: SummaryRange = rangeParam === "7d" || rangeParam === "30d" ? rangeParam : "30d";

    const projectIdRaw = (searchParams.get("projectId") ?? "").trim();
    const projectSlug = (searchParams.get("projectSlug") ?? "").trim();

    let project = null as any;

    if (projectIdRaw) {
      const pid = Number(projectIdRaw);
      if (!Number.isFinite(pid)) {
        return NextResponse.json({ error: "projectId must be a number" }, { status: 400 });
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
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // IMPORTANT:
    // Your current cavbotApi.server likely expects a string identifier.
    // We pass String(project.id) to stay consistent + unambiguous in multi-tenant.
    const summary = await getProjectSummary(String(project.id), { range });

    return NextResponse.json(
      { project: { id: project.id, slug: project.slug, name: project.name }, summary },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Console summary error", msg);
    return NextResponse.json({ error: "Failed to load console metrics" }, { status: 500 });
  }
}