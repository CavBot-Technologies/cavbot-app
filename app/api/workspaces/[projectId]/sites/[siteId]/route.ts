// app/api/workspaces/[projectId]/sites/[siteId]/route.ts
import "server-only";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import {
  requireAccountRole,
  isApiAuthError,
} from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { purgeCavPadNotesForSite, trashCavPadNotesForSite } from "@/lib/cavpad/server";
import { purgeSiteAnalytics } from "@/lib/siteDeletion.server";
import {
  createProjectNoticeEntry,
  findActiveWorkspaceSite,
  findOwnedWorkspaceProjectForSites,
  removeWorkspaceSite,
} from "@/lib/workspaceSites.server";
import { isPermissionDeniedError, isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { readSanitizedJson } from "@/lib/security/userInput";
import { requireLowRiskWorkspaceSession } from "@/lib/workspaceAuth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function requestIdFrom(req: Request) {
  const incoming =
    req.headers.get("x-request-id") ||
    req.headers.get("x-vercel-id") ||
    req.headers.get("cf-ray");
  return (incoming && incoming.trim()) || crypto.randomUUID();
}

function withBaseHeaders(headers?: HeadersInit, rid?: string) {
  const base: Record<string, string> = { ...NO_STORE_HEADERS };
  if (rid) base["x-cavbot-request-id"] = rid;
  return { ...(headers || {}), ...base };
}

function json(data: unknown, init?: number | ResponseInit, rid?: string) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: withBaseHeaders(resInit.headers, rid),
  });
}

function parseProjectId(raw: string) {
  const s = String(raw || "").trim();
  if (!/^\d+$/.test(s)) throw new Error("BAD_PROJECT_ID");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error("BAD_PROJECT_ID");
  return n;
}

function isDeleteSchemaOutOfDate(error: unknown) {
  return isSchemaMismatchError(error, {
    tables: ["Site", "SiteDeletion", "Project", "ProjectNotice", "ScanJob"],
    columns: ["isActive", "status", "topSiteId", "purgeScheduledAt", "retentionDays"],
  });
}

function isDeletePermissionDenied(error: unknown) {
  return isPermissionDeniedError(error, ["Site", "SiteDeletion", "Project", "ProjectNotice", "ScanJob"]);
}

function logDeleteFailure(args: {
  requestId: string;
  accountId?: string | null;
  projectId?: number | null;
  siteId?: string | null;
  origin?: string | null;
  errorCode: string;
  error: unknown;
}) {
  console.error("[workspace-site-delete]", {
    requestId: args.requestId,
    accountId: args.accountId || null,
    projectId: args.projectId || null,
    siteId: args.siteId || null,
    origin: args.origin || null,
    errorCode: args.errorCode,
    detail: args.error instanceof Error ? args.error.message : String(args.error),
  });
}

async function createRemovalNoticeBestEffort(args: {
  projectId: number;
  origin: string;
  mode: "SAFE" | "DESTRUCTIVE";
  retentionDays: number;
  requestId: string;
}) {
  try {
    await createProjectNoticeEntry({
      projectId: args.projectId,
      tone: "BAD",
      title: "Website removed",
      body:
        args.mode === "SAFE"
          ? `${args.origin} was removed from this workspace. Analytics will be retained for ${args.retentionDays} days.`
          : `${args.origin} was removed and analytics were permanently deleted.`,
    });
  } catch (error) {
    logDeleteFailure({
      requestId: args.requestId,
      projectId: args.projectId,
      origin: args.origin,
      errorCode: "PROJECT_NOTICE_WRITE_FAILED",
      error,
    });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: { projectId: string; siteId: string } }
) {
  noStore();
  const rid = requestIdFrom(req);

  try {
    const projectId = parseProjectId(ctx.params.projectId);
    const siteId = String(ctx.params.siteId || "").trim();

    if (!siteId) {
      return json({ error: "BAD_SITE_ID", requestId: rid }, 400, rid);
    }

    const sess = await requireLowRiskWorkspaceSession(req);
    requireAccountRole(sess, ["OWNER", "ADMIN"]);

    const project = await findOwnedWorkspaceProjectForSites(sess.accountId, projectId);
    if (!project) {
      return json({ error: "PROJECT_NOT_FOUND", requestId: rid }, 404, rid);
    }

    const site = await findActiveWorkspaceSite(projectId, siteId);
    if (!site) {
      return json({ error: "SITE_NOT_FOUND", requestId: rid }, 404, rid);
    }

    const body = await readSanitizedJson(req, {} as Record<string, unknown>);
    const rawMode = String(body?.mode || "").trim().toLowerCase();
    const confirmedOrigin = String(body?.origin || "").trim();

    const mode = rawMode === "purge_now" ? "DESTRUCTIVE" : rawMode === "detach" ? "SAFE" : null;
    if (!mode) {
      return json({ error: "BAD_DELETION_MODE", requestId: rid }, 400, rid);
    }

    if (!confirmedOrigin || confirmedOrigin !== site.origin) {
      return json({ error: "ORIGIN_MISMATCH", requestId: rid }, 400, rid);
    }

    const result = await removeWorkspaceSite({
      projectId,
      accountId: sess.accountId,
      siteId,
      mode,
      operatorUserId: sess.sub || null,
    });

    await createRemovalNoticeBestEffort({
      projectId,
      origin: result.origin,
      mode,
      retentionDays: result.retentionDays,
      requestId: rid,
    });

    await auditLogWrite({
      request: req,
      action: mode === "DESTRUCTIVE" ? "SITE_DELETED_IMMEDIATE" : "SITE_DETACHED",
      accountId: sess.accountId,
      operatorUserId: sess.sub || null,
      targetType: "site",
      targetId: siteId,
      targetLabel: result.origin,
      metaJson: {
        mode,
        origin: result.origin,
        retentionDays: result.retentionDays,
        requestedAt: new Date().toISOString(),
      },
    }).catch((error) => {
      logDeleteFailure({
        requestId: rid,
        accountId: sess.accountId,
        projectId,
        siteId,
        origin: result.origin,
        errorCode: "AUDIT_WRITE_FAILED",
        error,
      });
    });

    if (mode === "SAFE" && result.purgeScheduledAt) {
      await auditLogWrite({
        request: req,
        action: "SITE_PURGE_SCHEDULED",
        accountId: sess.accountId,
        operatorUserId: sess.sub || null,
        targetType: "site",
        targetId: siteId,
        targetLabel: result.origin,
        metaJson: {
          mode,
          origin: result.origin,
          retentionDays: result.retentionDays,
          purgeAt: result.purgeScheduledAt.toISOString(),
        },
      }).catch((error) => {
        logDeleteFailure({
          requestId: rid,
          accountId: sess.accountId,
          projectId,
          siteId,
          origin: result.origin,
          errorCode: "AUDIT_PURGE_SCHEDULE_WRITE_FAILED",
          error,
        });
      });
    }

    let analyticsPurged = mode !== "DESTRUCTIVE";

    if (mode === "DESTRUCTIVE") {
      try {
        await purgeSiteAnalytics({ projectId, siteId, origin: result.origin, mode: "immediate" });
        analyticsPurged = true;

        await auditLogWrite({
          request: req,
          action: "SITE_PURGE_EXECUTED",
          accountId: sess.accountId,
          operatorUserId: sess.sub || null,
          targetType: "site",
          targetId: siteId,
          targetLabel: result.origin,
          metaJson: {
            mode: "immediate",
            origin: result.origin,
            purgedAt: new Date().toISOString(),
          },
        }).catch((error) => {
          logDeleteFailure({
            requestId: rid,
            accountId: sess.accountId,
            projectId,
            siteId,
            origin: result.origin,
            errorCode: "AUDIT_PURGE_EXECUTED_WRITE_FAILED",
            error,
          });
        });
      } catch (error) {
        analyticsPurged = false;
        logDeleteFailure({
          requestId: rid,
          accountId: sess.accountId,
          projectId,
          siteId,
          origin: result.origin,
          errorCode: "ANALYTICS_PURGE_FAILED",
          error,
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

    try {
      if (mode === "DESTRUCTIVE") {
        cavpadPurge = await purgeCavPadNotesForSite({
          accountId: sess.accountId,
          operatorUserId: sess.sub,
          siteId,
        });
      } else {
        cavpadRetention = await trashCavPadNotesForSite({
          accountId: sess.accountId,
          operatorUserId: sess.sub,
          siteId,
        });
      }
    } catch (error) {
      logDeleteFailure({
        requestId: rid,
        accountId: sess.accountId,
        projectId,
        siteId,
        origin: result.origin,
        errorCode: "CAVPAD_CLEANUP_FAILED",
        error,
      });
    }

    return json(
      {
        ok: true,
        requestId: rid,
        topSiteId: result.nextTopSiteId,
        analyticsPurged,
        cavpadRetention,
        cavpadPurge,
      },
      200,
      rid
    );
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ error: error.code, requestId: rid }, error.status, rid);

    const msg = String((error as { message?: string })?.message || "");
    if (msg === "BAD_PROJECT_ID") return json({ error: "BAD_PROJECT_ID", requestId: rid }, 400, rid);
    if (msg === "PROJECT_NOT_FOUND") return json({ error: "PROJECT_NOT_FOUND", requestId: rid }, 404, rid);
    if (msg === "SITE_NOT_FOUND") return json({ error: "SITE_NOT_FOUND", requestId: rid }, 404, rid);

    if (isDeleteSchemaOutOfDate(error)) {
      return json(
        {
          error: "DB_SCHEMA_OUT_OF_DATE",
          message: "Website removal is temporarily unavailable while workspace schema updates finish.",
          requestId: rid,
        },
        409,
        rid
      );
    }

    if (isDeletePermissionDenied(error)) {
      return json(
        {
          error: "DB_PERMISSION_DENIED",
          message: "Website removal is temporarily unavailable while workspace permissions are being repaired.",
          requestId: rid,
        },
        503,
        rid
      );
    }

    return json(
      { error: "SITE_DELETE_FAILED", message: msg || "Failed to delete site.", requestId: rid },
      500,
      rid
    );
  }
}
