// app/api/sites/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { SiteAllowedOriginMatchType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireAccountRole, requireSession } from "@/lib/apiAuth";
import { registerWorkerSite } from "@/lib/cavbotApi.server";
import { getCavbotAppOrigins } from "@/lib/security/embedAppOrigins";
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

// Launch-grade: never leak verification secrets to the browser
const SAFE_SITE_SELECT = {
  id: true,
  projectId: true,
  slug: true,
  label: true,
  origin: true,
  status: true,
  isActive: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type SafeSite = Prisma.SiteGetPayload<{ select: typeof SAFE_SITE_SELECT }>;

function parseProjectId(raw: string | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isValidSlug(slug: string) {
  return /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug);
}

function normalizeOrigin(input: string) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("origin_required");

  const withProto =
    raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;

  const u = new URL(withProto);

  if (!u.hostname || u.hostname.includes("..")) throw new Error("origin_invalid");
  if (u.username || u.password) throw new Error("origin_invalid");

  return u.origin;
}

function asHttpError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e ?? "");

  if (msg === "UNAUTHORIZED" || msg === "NO_SESSION" || msg === "UNAUTHENTICATED") {
    return { status: 401, payload: { error: "UNAUTHENTICATED" } };
  }
  if (msg === "FORBIDDEN") return { status: 403, payload: { error: "FORBIDDEN" } };

  return { status: 500, payload: { error: "SITES_FAILED", message: msg } };
}

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const { searchParams } = new URL(req.url);

    const pid = parseProjectId(searchParams.get("projectId"));
    const projectSlug = String(searchParams.get("projectSlug") ?? "").trim();

    let projectIds: number[] = [];

    if (pid) {
      const p = await prisma.project.findFirst({
        where: { id: pid, accountId: session.accountId!, isActive: true },
        select: { id: true },
      });
      if (!p) return json({ error: "PROJECT_NOT_FOUND" }, 404);
      projectIds = [p.id];
    } else if (projectSlug) {
      const p = await prisma.project.findFirst({
        where: { slug: projectSlug, accountId: session.accountId!, isActive: true },
        select: { id: true },
      });
      if (!p) return json({ error: "PROJECT_NOT_FOUND" }, 404);
      projectIds = [p.id];
    } else {
      const projects = await prisma.project.findMany({
        where: { accountId: session.accountId!, isActive: true },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      projectIds = projects.map((p) => p.id);
    }

    if (projectIds.length === 0) return json({ sites: [] }, 200);

    const sites = await prisma.site.findMany({
      where: { projectId: { in: projectIds }, isActive: true },
      orderBy: { createdAt: "asc" },
      select: SAFE_SITE_SELECT,
    });

    return json({ sites }, 200);
  } catch (e: unknown) {
    const { status, payload } = asHttpError(e);
    return json(payload, status);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireAccountRole(session, ["OWNER", "ADMIN"]);

    const { searchParams } = new URL(req.url);
    const pidQ = parseProjectId(searchParams.get("projectId"));
    const projectSlugQ = String(searchParams.get("projectSlug") ?? "").trim();

    const body = (await readSanitizedJson(req, ({} as Record<string, unknown>))) as Record<string, unknown>;

    const slug = String(body.slug ?? "").trim();
    const label = String(body.label ?? "").trim();
    const originRaw = String(body.origin ?? "").trim();

    const pidB = parseProjectId(body.projectId != null ? String(body.projectId) : null);
    const projectSlugB = String(body.projectSlug ?? "").trim();

    const pid = pidB ?? pidQ ?? null;
    const projectSlug = projectSlugB || projectSlugQ;

    if (!slug || !label || !originRaw) {
      return json({ error: "MISSING_FIELDS", message: "slug, label, origin are required" }, 400);
    }
    if (!isValidSlug(slug)) {
      return json(
        { error: "BAD_SLUG", message: "slug must be lowercase letters/numbers with hyphens (3-64 chars)" },
        400
      );
    }

    const project = pid
      ? await prisma.project.findFirst({
          where: { id: pid, accountId: session.accountId!, isActive: true },
          select: { id: true },
        })
      : projectSlug
      ? await prisma.project.findFirst({
          where: { slug: projectSlug, accountId: session.accountId!, isActive: true },
          select: { id: true },
        })
      : null;

    if (!project) {
      return json({ error: "BAD_PROJECT", message: "projectId or projectSlug is required (and must belong to your account)" }, 400);
    }

    let origin: string;
    try {
      origin = normalizeOrigin(originRaw);
    } catch {
      return json({ error: "BAD_ORIGIN", message: "origin must be a valid URL or domain" }, 400);
    }

    // Create in DB first. Handle uniqueness by catching Prisma (race-safe).
    let site: SafeSite | null = null;
    try {
      site = await prisma.site.create({
        data: { projectId: project.id, slug, label, origin, isActive: true },
        select: SAFE_SITE_SELECT,
      });
    } catch (e: unknown) {
      const code =
        e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code ?? "") : "";
      if (code === "P2002") {
        return json({ error: "SITE_CONFLICT" }, 409);
      }
      throw e;
    }

    if (site) {
      const autoOrigins = new Set<string>();
      autoOrigins.add(site.origin);
      for (const originEntry of getCavbotAppOrigins()) {
        autoOrigins.add(originEntry);
      }
      const createPayload = Array.from(autoOrigins).map((originValue) => ({
        siteId: site.id,
        origin: originValue,
        matchType: SiteAllowedOriginMatchType.EXACT,
      }));
      if (createPayload.length) {
        await prisma.siteAllowedOrigin.createMany({ data: createPayload });
      }
    }

    // Register in Worker/D1. If this fails, rollback DB insert to prevent drift.
    try {
      await registerWorkerSite(project.id, origin, label);
    } catch (e: unknown) {
      if (site) {
        await prisma.site.delete({ where: { id: site.id } }).catch(() => {});
      }
      throw e;
    }

    return json({ site }, 201);
  } catch (e: unknown) {
    const { status, payload } = asHttpError(e);
    return json(payload, status);
  }
}
