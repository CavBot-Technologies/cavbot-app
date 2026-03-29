// app/api/workspaces/[projectId]/sites/[siteId]/restore/route.ts

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, requireAccountRole, isApiAuthError } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";

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

function parseProjectId(raw: unknown) {
  const s = String(raw || "").trim();
  if (!/^\d+$/.test(s)) throw new Error("BAD_PROJECT_ID");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error("BAD_PROJECT_ID");
  return n;
}

export async function POST(
  req: Request,
  ctx: { params: { projectId: string; siteId: string } }
) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireAccountRole(sess, ["OWNER", "ADMIN"]);

    const projectId = parseProjectId(ctx.params.projectId);
    const siteId = String(ctx.params.siteId || "").trim();

    if (!siteId) {
      return json({ error: "BAD_SITE_ID" }, 400);
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: sess.accountId },
      select: { id: true, accountId: true },
    });
    if (!project) {
      return json({ error: "PROJECT_NOT_FOUND" }, 404);
    }

    const site = await prisma.site.findFirst({
      where: { id: siteId, projectId },
      select: { id: true, origin: true },
    });
    if (!site) {
      return json({ error: "SITE_NOT_FOUND" }, 404);
    }

    const now = new Date();

    const deletion = await prisma.siteDeletion.findFirst({
      where: {
        siteId,
        projectId,
        status: "SCHEDULED",
        purgeScheduledAt: { gt: now },
      },
      orderBy: { requestedAt: "desc" },
      select: { id: true },
    });

    if (!deletion) {
      return json({ error: "NOT_FOUND" }, 404);
    }

    await prisma.$transaction(async (tx) => {
      await tx.site.update({
        where: { id: siteId },
        data: { isActive: true, status: "VERIFIED" },
      });

      await tx.siteDeletion.update({
        where: { id: deletion.id },
        data: {
          status: "RESTORED",
          purgeScheduledAt: null,
          purgedAt: now,
          metaJson: { restoredAt: now.toISOString() },
        },
      });

    });

    if (project.accountId) {
      await auditLogWrite({
        request: req,
        action: "SITE_RESTORED",
        accountId: project.accountId,
        operatorUserId: sess.sub,
        targetType: "site",
        targetId: siteId,
        targetLabel: site.origin,
        metaJson: {
          origin: site.origin,
          restoredAt: now.toISOString(),
        },
      });
    }

    return json({ ok: true }, 200);
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ error: e.code }, e.status);
    const errMsg = e instanceof Error ? e.message : undefined;
    return json(
      { error: "SITE_RESTORE_FAILED", message: errMsg || "Failed to restore site." },
      500
    );
  }
}
