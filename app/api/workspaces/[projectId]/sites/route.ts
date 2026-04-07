// app/api/workspaces/[projectId]/sites/route.ts

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";

// Plan system enforcement
import { resolvePlanIdFromTier, getPlanLimits } from "@/lib/plans";
import { readSanitizedJson } from "@/lib/security/userInput";

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

function parseProjectId(raw: string): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// Next 15+ params can be a Promise — always await it safely
async function getParams(ctx: unknown): Promise<{ projectId?: string }> {
  if (typeof ctx === "object" && ctx !== null) {
    const params = (ctx as { params?: { projectId?: string } }).params;
    return Promise.resolve(params ?? {});
  }
  return Promise.resolve({});
}

/**
 * Canonical origin rules (important for slug + duplicates):
 * - default https:// if no protocol
 * - lowercase hostname
 * - strip leading www.
 * - reject credentials
 * - keep scheme + host (+ port only if non-default)
 */
function normalizeOrigin(input: string): string {
  const raw = (input || "").trim();
  if (!raw) throw new Error("Enter a domain or origin.");

  const withProto = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;

  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    throw new Error("That doesn’t look like a valid domain/origin.");
  }

  if (!u.hostname || u.hostname.includes("..")) throw new Error("That domain/origin is invalid.");
  if (u.username || u.password) throw new Error("Origins may not include credentials.");

  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const isDefaultPort =
    (u.protocol === "https:" && (u.port === "" || u.port === "443")) ||
    (u.protocol === "http:" && (u.port === "" || u.port === "80"));

  const portPart = isDefaultPort ? "" : `:${u.port}`;
  const scheme = u.protocol === "http:" ? "http:" : "https:"; // force only http/https

  return `${scheme}//${host}${portPart}`;
}

function hostLabel(origin: string) {
  return new URL(origin).hostname.replace(/^www\./, "");
}

function baseSlugFromOrigin(origin: string) {
  const host = new URL(origin).hostname.replace(/^www\./, "").toLowerCase();
  return host
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function makeUniqueSlug(tx: Prisma.TransactionClient, projectId: number, base: string): Promise<string> {
  // quick path
  const existing = await tx.site.findFirst({
    where: { projectId, slug: base },
    select: { id: true },
  });
  if (!existing) return base;

  // try numeric suffixes first (clean + predictable)
  for (let i = 2; i <= 25; i++) {
    const candidate = `${base}-${i}`.slice(0, 80);
    const hit = await tx.site.findFirst({
      where: { projectId, slug: candidate },
      select: { id: true },
    });
    if (!hit) return candidate;
  }

  // fallback: short random suffix (race-safe)
  const suffix = randomBytes(3).toString("hex"); // 6 chars
  return `${base}-${suffix}`.slice(0, 80);
}

type CreatedSite = {
  id: string;
  origin: string;
  label: string;
  createdAt: Date;
};

export async function GET(req: Request, ctx: unknown) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const params = await getParams(ctx);
    const projectId = parseProjectId(params?.projectId || "");
    if (!projectId) return json({ error: "BAD_PROJECT" }, 400);

    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: sess.accountId },
      select: { id: true, topSiteId: true },
    });
    if (!project) return json({ error: "NOT_FOUND" }, 404);

    const sites = await prisma.site.findMany({
      where: { projectId: project.id, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, origin: true, createdAt: true },
    });

    return json({ topSiteId: project.topSiteId, sites }, 200);
  } catch (e) {
    if (isApiAuthError(e)) return json({ error: e.code }, e.status);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}

export async function POST(req: Request, ctx: unknown) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const params = await getParams(ctx);
    const projectId = parseProjectId(params?.projectId || "");
    if (!projectId) return json({ error: "BAD_PROJECT" }, 400);

    // Load project
    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: sess.accountId },
      select: { id: true, topSiteId: true },
    });
    if (!project) return json({ error: "NOT_FOUND" }, 404);

    // Load account tier (Plan enforcement source)
    const account = await prisma.account.findFirst({
      where: { id: sess.accountId },
      select: { tier: true },
    });

    const plan = await getEffectiveAccountPlanContext(sess.accountId!).catch(() => null);
    const planId = plan?.planId ?? resolvePlanIdFromTier(account?.tier || "FREE");
    const limits = getPlanLimits(planId);

    const body = (await readSanitizedJson(req, null)) as null | {
      origin?: string;
      label?: string;
      notes?: string;
    };

    const originRaw = (body?.origin || "").trim();
    const labelRaw = (body?.label || "").trim();

    let origin: string;
    try {
      origin = normalizeOrigin(originRaw);
    } catch (err) {
      return json(
        { error: "BAD_ORIGIN", message: err instanceof Error ? err.message : "Invalid origin." },
        400
      );
    }

    const label = (labelRaw || hostLabel(origin)).slice(0, 48);
    const baseSlug = baseSlugFromOrigin(origin);

    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1) If a row exists for this exact origin (even if inactive), handle it
        const existingByOrigin = await tx.site.findFirst({
          where: { projectId: project.id, origin },
          select: { id: true, origin: true, label: true, isActive: true },
        });

        if (existingByOrigin?.isActive) {
          // It genuinely exists
          return { conflict: true as const, site: existingByOrigin };
        }

        // 2) ENFORCE PLAN WEBSITE LIMIT (only when creating a *new* active site)
        // IMPORTANT: this is inside the transaction so it’s race-safe.
        if (limits.websites !== "unlimited") {
          const activeCount = await tx.site.count({
            where: { projectId: project.id, isActive: true },
          });

          if (activeCount >= limits.websites) {
            return {
              limitBlocked: true as const,
              current: activeCount,
              limit: limits.websites,
            };
          }
        }

        if (existingByOrigin && !existingByOrigin.isActive) {
          // You previously soft-deleted it somewhere — purge it for real (privacy)
          if (project.topSiteId === existingByOrigin.id) {
            await tx.project.update({
              where: { id: project.id },
              data: { topSiteId: null },
            });
          }

          await tx.apiKey.deleteMany({ where: { siteId: existingByOrigin.id } });
          await tx.scanJob.deleteMany({ where: { siteId: existingByOrigin.id } });
          await tx.site.delete({ where: { id: existingByOrigin.id } });
        }

        // 3) Compute a slug that won't collide
        const slug = await makeUniqueSlug(tx, project.id, baseSlug);

        // 4) Create site (retry once if a race hits P2002 on slug)
        let site: CreatedSite;
        try {
          site = await tx.site.create({
            data: { projectId: project.id, origin, label, slug },
            select: { id: true, origin: true, label: true, createdAt: true },
          });
        } catch (e: unknown) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            const retrySlug = await makeUniqueSlug(
              tx,
              project.id,
              `${baseSlug}-${randomBytes(2).toString("hex")}`
            );
            site = await tx.site.create({
              data: { projectId: project.id, origin, label, slug: retrySlug.slice(0, 80) },
              select: { id: true, origin: true, label: true, createdAt: true },
            });
          } else {
            throw e;
          }
        }

        // 5) Pin first site automatically
        const pinned = project.topSiteId || site.id;
        if (!project.topSiteId) {
          await tx.project.update({
            where: { id: project.id },
            data: { topSiteId: site.id },
          });
        }

        await tx.projectNotice.create({
          data: {
            projectId: project.id,
            tone: "GOOD",
            title: "Website added",
            body: `${origin} is now under this workspace.`,
          },
        });

        return { conflict: false as const, site, topSiteId: pinned };
      });

      if ("limitBlocked" in result && result.limitBlocked) {
        return json(
          {
            error: "PLAN_SITE_LIMIT",
            message:
              planId === "free"
                ? "Free Tier allows 1 website. Upgrade to add more."
                : "You’ve reached the website limit for this plan.",
            planId,
            current: result.current,
            limit: result.limit,
          },
          403
        );
      }

      // conflict path
      if ("conflict" in result && result.conflict) {
        return json({ error: "SITE_EXISTS", site: result.site }, 409);
      }

      if (sess.accountId) {
        await auditLogWrite({
          request: req,
          action: "SITE_ADDED",
          accountId: sess.accountId,
          operatorUserId: sess.sub,
          targetType: "site",
          targetId: result.site.id,
          targetLabel: result.site.origin,
          metaJson: {
            origin: result.site.origin,
            label: result.site.label,
            projectId,
          },
        });
      }

      return json({ site: result.site, topSiteId: result.topSiteId }, 201);
    } catch (e: unknown) {
      // If you still get P2002, return a correct message about what collided
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const target = (e.meta as Record<string, unknown> | undefined)?.target;
        return json(
          {
            error: "UNIQUE_CONSTRAINT",
            target: target || null,
            message:
              Array.isArray(target) && target.includes("slug")
                ? "Slug collision (projectId+slug). A site with a similar hostname slug already exists."
                : "This site already exists in this workspace.",
          },
          409
        );
      }

      return json({ error: "SERVER_ERROR" }, 500);
    }
  } catch (e) {
    if (isApiAuthError(e)) return json({ error: e.code }, e.status);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}
