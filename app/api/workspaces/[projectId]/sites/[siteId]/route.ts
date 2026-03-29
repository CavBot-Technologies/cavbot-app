// app/api/workspaces/[projectId]/sites/[siteId]/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, requireAccountRole, isApiAuthError } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { purgeCavPadNotesForSite, trashCavPadNotesForSite } from "@/lib/cavpad/server";
import { purgeSiteAnalytics, SiteDeletionMode, upsertSiteDeletionRecord } from "@/lib/siteDeletion.server";
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

function parseProjectId(raw: string) {
  const s = String(raw || "").trim();
  if (!/^\d+$/.test(s)) throw new Error("BAD_PROJECT_ID");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error("BAD_PROJECT_ID");
  return n;
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: { projectId: string; siteId: string } }
) {
  noStore();

  try {
    const projectId = parseProjectId(ctx.params.projectId);
    const siteId = String(ctx.params.siteId || "").trim();

    if (!siteId) {
      return json({ error: "BAD_SITE_ID" }, 400);
    }

    // auth
    const sess = await requireSession(req);
    requireAccountContext(sess);
    await requireAccountRole(sess, ["OWNER", "ADMIN"]);

    // verify project belongs to account
    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: sess.accountId },
      select: { id: true, topSiteId: true, accountId: true, retentionDays: true },
    });

    if (!project) {
      return json({ error: "PROJECT_NOT_FOUND" }, 404);
    }

    // verify site exists in this project
    const site = await prisma.site.findFirst({
      where: { id: siteId, projectId, isActive: true },
      select: { id: true, origin: true, label: true },
    });

    if (!site) {
      return json({ error: "SITE_NOT_FOUND" }, 404);
    }

    const body = await readSanitizedJson(req, ({} as Record<string, unknown>));
    const rawMode = String(body?.mode || "").trim().toLowerCase();
    const confirmedOrigin = String(body?.origin || "").trim();

    let mode: SiteDeletionMode;
    if (rawMode === "purge_now") {
      mode = "DESTRUCTIVE";
    } else if (rawMode === "detach") {
      mode = "SAFE";
    } else {
      return json({ error: "BAD_DELETION_MODE" }, 400);
    }

    if (!confirmedOrigin || confirmedOrigin !== site.origin) {
      return json({ error: "ORIGIN_MISMATCH" }, 400);
    }

    const retentionDays = project.retentionDays ?? 30;
    const operatorUserId = sess.sub;

    const result = await prisma.$transaction(async (tx) => {
      await tx.site.update({
        where: { id: siteId },
        data: { isActive: false, status: "SUSPENDED" },
        select: { id: true },
      });

      let nextTopSiteId: string | null = project.topSiteId;

      if (project.topSiteId === siteId) {
        const nextTop = await tx.site.findFirst({
          where: { projectId, isActive: true },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });

        nextTopSiteId = nextTop?.id ?? null;

        await tx.project.update({
          where: { id: projectId },
          data: { topSiteId: nextTopSiteId },
        });
      }

      await tx.projectNotice.create({
        data: {
          projectId,
          tone: "WATCH",
          title: "Website removed",
          body:
            mode === "SAFE"
              ? `${site.origin} was removed from this workspace (analytics retained for ${retentionDays} days).`
              : `${site.origin} was removed and analytics were deleted immediately.`,
        },
      });

      const deletionRecord = await upsertSiteDeletionRecord({
        tx,
        projectId,
        siteId,
        accountId: project.accountId,
        operatorUserId,
        mode,
        origin: site.origin,
        retentionDays,
      });

      if (project.accountId) {
        await auditLogWrite({
          request: req,
          action: mode === "DESTRUCTIVE" ? "SITE_DELETED_IMMEDIATE" : "SITE_DETACHED",
          accountId: project.accountId,
          operatorUserId,
          targetType: "site",
          targetId: siteId,
          targetLabel: site.origin,
          metaJson: {
            mode,
            origin: site.origin,
            retentionDays,
            requestedAt: new Date().toISOString(),
          },
        });
      }

      return { nextTopSiteId, deletionRecord };
    });

    if (mode === "SAFE" && project.accountId && result.deletionRecord?.purgeScheduledAt) {
      await auditLogWrite({
        request: req,
        action: "SITE_PURGE_SCHEDULED",
        accountId: project.accountId,
        operatorUserId,
        targetType: "site",
        targetId: siteId,
        targetLabel: site.origin,
        metaJson: {
          mode,
          origin: site.origin,
          retentionDays,
          purgeAt: result.deletionRecord.purgeScheduledAt?.toISOString() ?? null,
        },
      });
    }

    if (mode === "DESTRUCTIVE") {
      await purgeSiteAnalytics({ projectId, siteId, origin: site.origin, mode: "immediate" });
      if (project.accountId) {
        await auditLogWrite({
          request: req,
          action: "SITE_PURGE_EXECUTED",
          accountId: project.accountId,
          operatorUserId,
          targetType: "site",
          targetId: siteId,
          targetLabel: site.origin,
          metaJson: {
            mode: "immediate",
            origin: site.origin,
            purgedAt: new Date().toISOString(),
          },
        });
      }
    }

    let cavpadRetention: {
      ok: true;
      scanned: number;
      trashedCount: number;
      failedCount: number;
      trashedAtISO: string;
    } | null = null;
    let cavpadPurge: {
      ok: true;
      scanned: number;
      purgedCount: number;
      failedCount: number;
      folderDeleted: boolean;
      folderPath: string | null;
      purgedAtISO: string;
    } | null = null;

    if (project.accountId) {
      try {
        if (mode === "DESTRUCTIVE") {
          cavpadPurge = await purgeCavPadNotesForSite({
            accountId: project.accountId,
            operatorUserId,
            siteId,
          });
        } else {
          cavpadRetention = await trashCavPadNotesForSite({
            accountId: project.accountId,
            operatorUserId,
            siteId,
          });
        }
      } catch (err) {
        console.error("[site-delete] cavpad note cleanup failed", {
          projectId,
          siteId,
          accountId: project.accountId,
          operatorUserId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return json({ ok: true, topSiteId: result.nextTopSiteId, cavpadRetention, cavpadPurge }, 200);
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ error: e.code }, e.status);

    const msg = String((e as { message?: string })?.message || "");
    if (msg === "BAD_PROJECT_ID") return json({ error: "BAD_PROJECT_ID" }, 400);

    return json(
      { error: "SITE_DELETE_FAILED", message: msg || "Failed to delete site." },
      500
    );
  }
}
