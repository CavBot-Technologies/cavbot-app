import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireSession, requireUser } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { denyWorkspaceAccessRequest, isWorkspaceAccessRequestSchemaMismatch } from "@/lib/workspaceTeam.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function s(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(req: NextRequest, ctx: { params: { id?: string } }) {
  try {
    const session = await requireSession(req);
    requireUser(session);

    const requestId = s(ctx?.params?.id);
    if (!requestId) {
      return json({ ok: false, error: "BAD_REQUEST_ID", message: "Request id is required." }, 400);
    }

    const result = await denyWorkspaceAccessRequest({
      requestId,
      operatorUserId: session.sub,
    });

    if (!result.ok) {
      const status =
        result.error === "REQUEST_NOT_FOUND"
          ? 404
          : result.error === "FORBIDDEN"
            ? 403
            : result.error === "REQUEST_ALREADY_APPROVED"
              ? 409
              : 400;
      return json(result, status);
    }

    await auditLogWrite({
      request: req,
      accountId: result.accountId,
      operatorUserId: session.sub,
      action: "PROJECT_UPDATED",
      actionLabel: "ACCESS_REQUEST_DENIED",
      targetType: "workspace_access_request",
      targetId: result.requestId,
      targetLabel: result.workspaceName || result.accountId,
      metaJson: {
        event: "ACCESS_REQUEST_DENIED",
        alreadyHandled: result.alreadyHandled,
        actorUserId: session.sub,
        subjectUserId: result.subjectUserId,
        subjectUsername: result.subjectUsername,
        workspaceId: result.accountId,
        workspaceName: result.workspaceName,
      },
    });

    return json(
      {
        ok: true,
        requestId: result.requestId,
        accountId: result.accountId,
        workspaceName: result.workspaceName,
        status: result.status,
        grantedRole: result.grantedRole,
        alreadyHandled: result.alreadyHandled,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    if (isWorkspaceAccessRequestSchemaMismatch(error)) {
      return json(
        {
          ok: false,
          error: "FEATURE_UNAVAILABLE",
          message: "Workspace access requests are temporarily unavailable.",
        },
        503,
      );
    }
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}
