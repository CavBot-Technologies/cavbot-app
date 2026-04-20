// app/api/workspaces/[projectId]/sites/[siteId]/restore/route.ts
import "server-only";

import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  requireLowRiskWriteSession,
  requireAccountContext,
  requireAccountRole,
  isApiAuthError,
} from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import {
  createProjectNoticeEntry,
  findOwnedWorkspaceProjectForSites,
  restoreWorkspaceSite,
} from "@/lib/workspaceSites.server";
import { isPermissionDeniedError, isSchemaMismatchError } from "@/lib/dbSchemaGuard";

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

function parseProjectId(raw: unknown) {
  const s = String(raw || "").trim();
  if (!/^\d+$/.test(s)) throw new Error("BAD_PROJECT_ID");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error("BAD_PROJECT_ID");
  return n;
}

function isRestoreSchemaOutOfDate(error: unknown) {
  return isSchemaMismatchError(error, {
    tables: ["Site", "SiteDeletion", "Project", "ProjectNotice"],
    columns: ["isActive", "status", "purgeScheduledAt", "metaJson"],
  });
}

function isRestorePermissionDenied(error: unknown) {
  return isPermissionDeniedError(error, ["Site", "SiteDeletion", "Project", "ProjectNotice"]);
}

function logRestoreFailure(args: {
  requestId: string;
  accountId?: string | null;
  projectId?: number | null;
  siteId?: string | null;
  origin?: string | null;
  errorCode: string;
  error: unknown;
}) {
  console.error("[workspace-site-restore]", {
    requestId: args.requestId,
    accountId: args.accountId || null,
    projectId: args.projectId || null,
    siteId: args.siteId || null,
    origin: args.origin || null,
    errorCode: args.errorCode,
    detail: args.error instanceof Error ? args.error.message : String(args.error),
  });
}

export async function POST(
  req: Request,
  ctx: { params: { projectId: string; siteId: string } }
) {
  const rid = requestIdFrom(req);

  try {
    const sess = await requireLowRiskWriteSession(req);
    requireAccountContext(sess);
    requireAccountRole(sess, ["OWNER", "ADMIN"]);

    const projectId = parseProjectId(ctx.params.projectId);
    const siteId = String(ctx.params.siteId || "").trim();

    if (!siteId) {
      return json({ error: "BAD_SITE_ID", requestId: rid }, 400, rid);
    }

    const project = await findOwnedWorkspaceProjectForSites(sess.accountId, projectId);
    if (!project) {
      return json({ error: "PROJECT_NOT_FOUND", requestId: rid }, 404, rid);
    }

    const restored = await restoreWorkspaceSite({
      projectId,
      accountId: sess.accountId,
      siteId,
    });

    await createProjectNoticeEntry({
      projectId,
      tone: "GOOD",
      title: "Website restored",
      body: `${restored.origin} was restored to this workspace.`,
    }).catch((error) => {
      logRestoreFailure({
        requestId: rid,
        accountId: sess.accountId,
        projectId,
        siteId,
        origin: restored.origin,
        errorCode: "PROJECT_NOTICE_WRITE_FAILED",
        error,
      });
    });

    await auditLogWrite({
      request: req,
      action: "SITE_RESTORED",
      accountId: sess.accountId,
      operatorUserId: sess.sub || null,
      targetType: "site",
      targetId: siteId,
      targetLabel: restored.origin,
      metaJson: {
        origin: restored.origin,
        restoredAt: restored.restoredAt.toISOString(),
      },
    }).catch((error) => {
      logRestoreFailure({
        requestId: rid,
        accountId: sess.accountId,
        projectId,
        siteId,
        origin: restored.origin,
        errorCode: "AUDIT_WRITE_FAILED",
        error,
      });
    });

    return json({ ok: true, requestId: rid }, 200, rid);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ error: error.code, requestId: rid }, error.status, rid);

    const message = String((error as { message?: string })?.message || "");
    if (message === "BAD_PROJECT_ID") return json({ error: "BAD_PROJECT_ID", requestId: rid }, 400, rid);
    if (message === "PROJECT_NOT_FOUND") return json({ error: "PROJECT_NOT_FOUND", requestId: rid }, 404, rid);
    if (message === "SITE_NOT_FOUND" || message === "DELETION_NOT_FOUND") {
      return json({ error: "NOT_FOUND", requestId: rid }, 404, rid);
    }

    if (isRestoreSchemaOutOfDate(error)) {
      return json(
        {
          error: "DB_SCHEMA_OUT_OF_DATE",
          message: "Website restore is temporarily unavailable while workspace schema updates finish.",
          requestId: rid,
        },
        409,
        rid
      );
    }

    if (isRestorePermissionDenied(error)) {
      return json(
        {
          error: "DB_PERMISSION_DENIED",
          message: "Website restore is temporarily unavailable while workspace permissions are being repaired.",
          requestId: rid,
        },
        503,
        rid
      );
    }

    return json(
      { error: "SITE_RESTORE_FAILED", message: message || "Failed to restore site.", requestId: rid },
      500,
      rid
    );
  }
}
