// app/api/sites/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireAccountRole, requireSession } from "@/lib/apiAuth";
import { registerWorkerSite } from "@/lib/cavbotApi.server";

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    // Viewer access is allowed (MEMBER can read sites)
    // If you want to lock read access to OWNER/ADMIN only, uncomment:
    // requireAccountRole(session, ["OWNER", "ADMIN"]);

    const { searchParams } = new URL(req.url);
    const projectIdRaw = (searchParams.get("projectId") ?? "").trim();
    const projectSlug = (searchParams.get("projectSlug") ?? "").trim();

    let projects: { id: number }[] = [];

    if (projectIdRaw) {
      const pid = Number(projectIdRaw);
      if (!Number.isFinite(pid)) {
        return NextResponse.json({ error: "projectId must be a number" }, { status: 400 });
      }
      const p = await prisma.project.findFirst({
        where: { id: pid, accountId: session.accountId!, isActive: true },
        select: { id: true },
      });
      if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      projects = [p];
    } else if (projectSlug) {
      const p = await prisma.project.findFirst({
        where: { slug: projectSlug, accountId: session.accountId!, isActive: true },
        select: { id: true },
      });
      if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      projects = [p];
    } else {
      projects = await prisma.project.findMany({
        where: { accountId: session.accountId!, isActive: true },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
    }

    const projectIds = projects.map((p) => p.id);
    if (projectIds.length === 0) {
      return NextResponse.json({ sites: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const sites = await prisma.site.findMany({
      where: { projectId: { in: projectIds }, isActive: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ sites }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg || "Server error" }, { status: 500 });
  }
}
export const runtime = "edge";
export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    // Admin write access (multi-tenant)
    requireAccountRole(session, ["OWNER", "ADMIN"]);

    const { searchParams } = new URL(req.url);
    const projectIdRawQ = (searchParams.get("projectId") ?? "").trim();
    const projectSlugQ = (searchParams.get("projectSlug") ?? "").trim();

    const body = await req.json().catch(() => ({}));

    const slug = String(body.slug || "").trim();
    const label = String(body.label || "").trim();
    const origin = String(body.origin || "").trim();

    const projectIdRawB = body.projectId != null ? String(body.projectId).trim() : "";
    const projectSlugB = body.projectSlug != null ? String(body.projectSlug).trim() : "";

    const projectIdRaw = projectIdRawB || projectIdRawQ;
    const projectSlug = projectSlugB || projectSlugQ;

    if (!slug || !label || !origin) {
      return NextResponse.json({ error: "slug, label, origin are required" }, { status: 400 });
    }

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

    let u: URL;
    try {
      u = new URL(origin);
    } catch {
      return NextResponse.json({ error: "origin must be a valid URL" }, { status: 400 });
    }

    // Normalize origin to protocol + host (prevents dupes from path differences)
    const normalizedOrigin = `${u.protocol}//${u.host}`;

    const site = await prisma.site.create({
      data: { projectId: project.id, slug, label, origin: normalizedOrigin, isActive: true },
    });

    // Register in Worker/D1 (runtime enforcement)
    await registerWorkerSite(project.id, normalizedOrigin, label);

    return NextResponse.json({ site }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg || "Server error" }, { status: 500 });
  }
}