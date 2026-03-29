import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireSession, requireUser } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { declineWorkspaceInvite } from "@/lib/workspaceTeam.server";

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

export async function POST(req: NextRequest, ctx: { params: { inviteId?: string } }) {
  try {
    const session = await requireSession(req);
    requireUser(session);

    const inviteId = s(ctx?.params?.inviteId);
    if (!inviteId) {
      return json({ ok: false, error: "BAD_INVITE_ID", message: "Invite id is required." }, 400);
    }

    const result = await declineWorkspaceInvite({
      inviteId,
      operatorUserId: session.sub,
    });

    if (!result.ok) {
      const status =
        result.error === "INVITE_NOT_FOUND"
          ? 404
          : result.error === "INVITE_FORBIDDEN"
            ? 403
            : result.error === "INVITE_ALREADY_ACCEPTED" || result.error === "INVITE_REVOKED" || result.error === "INVITE_EXPIRED"
              ? 409
              : 400;
      return json(result, status);
    }

    await auditLogWrite({
      request: req,
      accountId: result.accountId,
      operatorUserId: session.sub,
      action: "PROJECT_UPDATED",
      actionLabel: "INVITE_DECLINED",
      targetType: "invite",
      targetId: result.inviteId,
      targetLabel: result.workspaceName || result.accountId,
      metaJson: {
        event: "INVITE_DECLINED",
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
        inviteId: result.inviteId,
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
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}
