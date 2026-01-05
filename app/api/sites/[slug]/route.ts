// app/api/sites/[slug]/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireAccountRole, requireSession } from "@/lib/apiAuth";
import { updateWorkerSite } from "@/lib/cavbotApi.server";
export const runtime = "edge";
export async function PATCH(req: Request, ctx: { params: { slug: string } }) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    // Admin write access
    requireAccountRole(session, ["OWNER", "ADMIN"]);

    const { searchParams } = new URL(req.url);

    const projectIdRaw = (searchParams.get("projectId") ?? "").trim();
    const projectSlug = (searchParams.get("projectSlug") ?? "").trim();

    let project: any = null;

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
    }

    if (!project) {
      return NextResponse.json(
        { error: "projectId or projectSlug is required (and must belong to your account)" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const slug = String(ctx.params.slug || "").trim();

    const existing = await prisma.site.findFirst({
      where: { projectId: project.id, slug },
    });

    if (!existing) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const nextLabel = body.label != null ? String(body.label).trim() : undefined;
    const nextOriginRaw = body.origin != null ? String(body.origin).trim() : undefined;
    const nextActive = body.isActive != null ? Boolean(body.isActive) : undefined;

    let nextOrigin: string | undefined = undefined;
    if (nextOriginRaw) {
      let u: URL;
      try {
        u = new URL(nextOriginRaw);
      } catch {
        return NextResponse.json({ error: "origin must be a valid URL" }, { status: 400 });
      }
      nextOrigin = `${u.protocol}//${u.host}`;
    }

    const updated = await prisma.site.updateMany({
      where: { projectId: project.id, slug },
      data: {
        label: nextLabel,
        origin: nextOrigin,
        isActive: nextActive,
      },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const site = await prisma.site.findFirst({
      where: { projectId: project.id, slug },
    });

    // Sync Worker
    await updateWorkerSite(project.id, {
      origin: existing.origin,
      newOrigin: nextOrigin,
      label: nextLabel,
      isActive: nextActive,
    });

    return NextResponse.json({ site }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg || "Server error" }, { status: 500 });
  }
}