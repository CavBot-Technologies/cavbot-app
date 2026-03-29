// app/api/sites/[slug]/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireAccountRole, requireSession } from "@/lib/apiAuth";
import { updateWorkerSite } from "@/lib/cavbotApi.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type SitePayload = { [key: string]: unknown };
function json(payload: SitePayload, init?: number | ResponseInit) {
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

function parseProjectId(raw: string | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
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
  const msg =
    typeof e === "object" && e !== null && "message" in e
      ? String((e as { message?: string }).message)
      : String(e ?? "");

  if (msg === "UNAUTHORIZED" || msg === "NO_SESSION" || msg === "UNAUTHENTICATED") {
    return { status: 401, payload: { error: "UNAUTHENTICATED" } };
  }
  if (msg === "FORBIDDEN") return { status: 403, payload: { error: "FORBIDDEN" } };

  return { status: 500, payload: { error: "SITE_UPDATE_FAILED", message: msg } };
}

export async function PATCH(req: Request, ctx: { params: { slug: string } }) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireAccountRole(session, ["OWNER", "ADMIN"]);

    const { searchParams } = new URL(req.url);

    const pid = parseProjectId(searchParams.get("projectId"));
    const projectSlug = String(searchParams.get("projectSlug") ?? "").trim();

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
      return json(
        { error: "BAD_PROJECT", message: "projectId or projectSlug is required (and must belong to your account)" },
        400
      );
    }

    const slug = String(ctx.params.slug || "").trim();
    if (!slug) return json({ error: "BAD_SLUG" }, 400);

    const existing = await prisma.site.findFirst({
      where: { projectId: project.id, slug },
      select: { id: true, origin: true, label: true, isActive: true },
    });

    if (!existing) return json({ error: "SITE_NOT_FOUND" }, 404);

    const body = (await readSanitizedJson(req, ({}))) as SitePayload;

    const nextLabel = body?.label != null ? String(body.label).trim().slice(0, 64) : undefined;

    const nextActive =
      body?.isActive != null && typeof body.isActive === "boolean" ? body.isActive : undefined;

    const nextOriginRaw = body?.origin != null ? String(body.origin).trim() : undefined;

    let nextOrigin: string | undefined;
    if (nextOriginRaw) {
      try {
        nextOrigin = normalizeOrigin(nextOriginRaw);
      } catch {
        return json({ error: "BAD_ORIGIN", message: "origin must be a valid URL or domain" }, 400);
      }

      // Prevent origin duplicates within project
      const dupe = await prisma.site.findFirst({
        where: { projectId: project.id, origin: nextOrigin, id: { not: existing.id } },
        select: { id: true },
      });
      if (dupe) return json({ error: "ORIGIN_CONFLICT" }, 409);
    }

    // Update DB (by id)
    const updated = await prisma.site.update({
      where: { id: existing.id },
      data: {
        label: nextLabel,
        origin: nextOrigin,
        isActive: nextActive,
      },
      select: SAFE_SITE_SELECT,
    });

    // Sync worker; rollback DB if sync fails
    try {
      await updateWorkerSite(project.id, {
        origin: existing.origin,
        newOrigin: nextOrigin,
        label: nextLabel,
        isActive: nextActive,
      });
    } catch (e: unknown) {
      await prisma.site.update({
        where: { id: existing.id },
        data: {
          label: existing.label,
          origin: existing.origin,
          isActive: existing.isActive,
        },
      });
      throw e;
    }

    return json({ site: updated }, 200);
  } catch (error: unknown) {
    const { status, payload } = asHttpError(error);
    return json(payload, status);
  }
}
