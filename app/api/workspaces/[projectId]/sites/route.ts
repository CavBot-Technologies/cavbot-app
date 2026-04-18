// app/api/workspaces/[projectId]/sites/route.ts

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma, SiteAllowedOriginMatchType } from "@prisma/client";
import { randomBytes } from "crypto";
import { requireSession, requireAccountContext, requireAccountRole, isApiAuthError } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { registerWorkerSite } from "@/lib/cavbotApi.server";

// Plan system enforcement
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { resolvePlanIdFromTier, getPlanLimits } from "@/lib/plans";
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

function normalizeNotes(input: string) {
  const notes = String(input || "").trim().slice(0, 160);
  return notes || null;
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

function isWorkspaceSiteSchemaOutOfDate(error: unknown) {
  return isSchemaMismatchError(error, {
    tables: ["Site", "SiteAllowedOrigin", "ProjectNotice", "Project"],
    columns: ["notes", "topSiteId", "origin", "slug", "projectId", "siteId"],
    fields: ["siteAllowedOrigin", "projectNotice"],
  });
}

async function createDefaultAllowedOrigins(siteId: string, origin: string) {
  const allowedOrigins = new Set<string>([origin]);
  for (const appOrigin of getCavbotAppOrigins()) {
    allowedOrigins.add(appOrigin);
  }

  await prisma.siteAllowedOrigin.createMany({
    data: Array.from(allowedOrigins).map((allowedOrigin) => ({
      siteId,
      origin: allowedOrigin,
      matchType: SiteAllowedOriginMatchType.EXACT,
    })),
    skipDuplicates: true,
  });
}

async function rollbackCreatedSiteSetup(args: {
  projectId: number;
  siteId: string;
  autoPinned: boolean;
}) {
  await prisma.$transaction(async (tx) => {
    if (args.autoPinned) {
      await tx.project.updateMany({
        where: {
          id: args.projectId,
          topSiteId: args.siteId,
        },
        data: { topSiteId: null },
      });
    }

    await tx.site.delete({
      where: { id: args.siteId },
    });
  }).catch(() => null);
}

async function createProjectNoticeBestEffort(projectId: number, origin: string) {
  try {
    await prisma.projectNotice.create({
      data: {
        projectId,
        tone: "GOOD",
        title: "Website added",
        body: `${origin} is now under this workspace.`,
      },
    });
  } catch (error) {
    if (!isWorkspaceSiteSchemaOutOfDate(error)) {
      console.error("[workspace-sites] project notice write failed", error);
    }
  }
}

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
    requireAccountRole(sess, ["OWNER", "ADMIN"]);

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

    const planId = resolvePlanIdFromTier(account?.tier || "FREE");
    const limits = getPlanLimits(planId);

    const body = (await readSanitizedJson(req, null)) as null | {
      origin?: string;
      label?: string;
      notes?: string;
    };

    const originRaw = (body?.origin || "").trim();
    const labelRaw = (body?.label || "").trim();
    const notes = normalizeNotes(body?.notes || "");

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

        const replacingPinnedInactiveSite = Boolean(existingByOrigin && !existingByOrigin.isActive && project.topSiteId === existingByOrigin.id);

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
            data: { projectId: project.id, origin, label, slug, notes },
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
              data: { projectId: project.id, origin, label, slug: retrySlug.slice(0, 80), notes },
              select: { id: true, origin: true, label: true, createdAt: true },
            });
          } else {
            throw e;
          }
        }

        // 5) Pin first site automatically
        const shouldAutoPin = !project.topSiteId || replacingPinnedInactiveSite;
        const pinned = shouldAutoPin ? site.id : project.topSiteId;
        if (shouldAutoPin) {
          await tx.project.update({
            where: { id: project.id },
            data: { topSiteId: site.id },
          });
        }

        return { conflict: false as const, site, topSiteId: pinned, autoPinned: shouldAutoPin };
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

      try {
        await createDefaultAllowedOrigins(result.site.id, result.site.origin);
        await registerWorkerSite(project.id, result.site.origin, result.site.label);
      } catch (error) {
        await rollbackCreatedSiteSetup({
          projectId: project.id,
          siteId: result.site.id,
          autoPinned: result.autoPinned,
        });

        if (isWorkspaceSiteSchemaOutOfDate(error)) {
          return json(
            {
              error: "DB_SCHEMA_OUT_OF_DATE",
              message: "Website setup is temporarily unavailable while workspace schema updates finish.",
            },
            409
          );
        }

        const status = Number((error as { status?: unknown })?.status);
        return json(
          {
            error: "SITE_WIRING_FAILED",
            message: "CavBot could not finish wiring this website for tracking. Please try again in a moment.",
            detail: error instanceof Error ? error.message : undefined,
          },
          Number.isFinite(status) && status >= 400 && status < 600 ? status : 502
        );
      }

      await createProjectNoticeBestEffort(project.id, result.site.origin);

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

      if (isWorkspaceSiteSchemaOutOfDate(e)) {
        return json(
          {
            error: "DB_SCHEMA_OUT_OF_DATE",
            message: "Website setup is temporarily unavailable while workspace schema updates finish.",
          },
          409
        );
      }

      return json(
        {
          error: "SITE_CREATE_FAILED",
          message: "CavBot could not add this website right now. Please try again.",
        },
        500
      );
    }
  } catch (e) {
    if (isApiAuthError(e)) return json({ error: e.code }, e.status);
    if (isWorkspaceSiteSchemaOutOfDate(e)) {
      return json(
        {
          error: "DB_SCHEMA_OUT_OF_DATE",
          message: "Website setup is temporarily unavailable while workspace schema updates finish.",
        },
        409
      );
    }
    return json(
      {
        error: "SITE_CREATE_FAILED",
        message: "CavBot could not add this website right now. Please try again.",
      },
      500
    );
  }
}
