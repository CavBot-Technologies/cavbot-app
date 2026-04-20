// app/api/workspaces/[projectId]/sites/removed/route.ts
import "server-only";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { findOwnedWorkspaceProjectForSites, listRemovedWorkspaceSites } from "@/lib/workspaceSites.server";
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

function isRemovedListSchemaOutOfDate(error: unknown) {
  return isSchemaMismatchError(error, {
    tables: ["SiteDeletion", "Project"],
    columns: ["purgeScheduledAt", "requestedAt", "status"],
  });
}

function isRemovedListPermissionDenied(error: unknown) {
  return isPermissionDeniedError(error, ["SiteDeletion", "Project"]);
}

export async function GET(
  req: Request,
  ctx: { params: { projectId: string } }
) {
  const rid = requestIdFrom(req);

  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const projectId = parseProjectId(ctx.params.projectId);
    const project = await findOwnedWorkspaceProjectForSites(sess.accountId, projectId);
    if (!project) return json({ error: "NOT_FOUND", requestId: rid }, 404, rid);

    const deletions = await listRemovedWorkspaceSites(project.id);

    return json(
      {
        requestId: rid,
        sites: deletions.map((record) => ({
          siteId: record.siteId,
          origin: record.origin,
          removedAt: record.removedAt.toISOString(),
          purgeAt: record.purgeAt.toISOString(),
        })),
      },
      200,
      rid
    );
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      return json({ error: error.code, requestId: rid }, error.status, rid);
    }
    if (String((error as { message?: string })?.message || "") === "BAD_PROJECT_ID") {
      return json({ error: "BAD_PROJECT_ID", requestId: rid }, 400, rid);
    }
    if (isRemovedListSchemaOutOfDate(error)) {
      return json(
        {
          error: "DB_SCHEMA_OUT_OF_DATE",
          message: "Recently removed sites are temporarily unavailable while workspace schema updates finish.",
          requestId: rid,
        },
        409,
        rid
      );
    }
    if (isRemovedListPermissionDenied(error)) {
      return json(
        {
          error: "DB_PERMISSION_DENIED",
          message: "Recently removed sites are temporarily unavailable while workspace permissions are being repaired.",
          requestId: rid,
        },
        503,
        rid
      );
    }
    return json({ error: "SERVER_ERROR", requestId: rid }, 500, rid);
  }
}
