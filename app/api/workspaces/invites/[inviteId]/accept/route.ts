import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireSession, requireUser } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { acceptWorkspaceInvite } from "@/lib/workspaceTeam.server";
import { readSanitizedJson } from "@/lib/security/userInput";

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

function parseInviteRole(raw: unknown): "MEMBER" | "ADMIN" | null {
  const value = s(raw).toUpperCase();
  if (!value) return null;
  if (value === "MEMBER" || value === "ADMIN") return value;
  return null;
}

export async function POST(req: NextRequest, ctx: { params: { inviteId?: string } }) {
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return json(
        { ok: false, error: "BAD_CSRF", message: "Missing request integrity token." },
        403,
      );
    }

    const session = await requireSession(req);
    requireUser(session);

    const inviteId = s(ctx?.params?.inviteId);
    if (!inviteId) {
      return json({ ok: false, error: "BAD_INVITE_ID", message: "Invite id is required." }, 400);
    }

    const payload = (await readSanitizedJson(req, null)) as { role?: unknown } | null;
    const role = parseInviteRole(payload?.role);
    if (payload && payload.role !== undefined && payload.role !== null && !role) {
      return json(
        { ok: false, error: "FORBIDDEN", message: "Role must be member or admin." },
        403,
      );
    }

    const result = await acceptWorkspaceInvite({
      inviteId,
      operatorUserId: session.sub,
      role: role || null,
    });

    if (!result.ok) {
      const status =
        result.error === "INVITE_NOT_FOUND"
          ? 404
          : result.error === "INVITE_FORBIDDEN" || result.error === "FORBIDDEN"
            ? 403
          : result.error === "INVITE_ACCEPTED_MEMBERSHIP_MISSING"
              ? 409
              : result.error === "INVITE_REVOKED" || result.error === "INVITE_EXPIRED" || result.error === "INVITE_DECLINED"
                ? 409
                : 400;
      return json(result, status);
    }

    await auditLogWrite({
      request: req,
      accountId: result.accountId,
      operatorUserId: session.sub,
      action: "PROJECT_UPDATED",
      actionLabel: "Workspace invite accepted",
      targetType: "invite",
      targetId: result.inviteId,
      targetLabel: result.workspaceName || result.accountId,
      metaJson: {
        membershipId: result.membershipId,
        alreadyHandled: result.alreadyHandled,
        alreadyMember: result.alreadyMember,
        actorUserId: session.sub,
        subjectUserId: result.subjectUserId,
        subjectUsername: result.subjectUsername,
        grantedRole: result.grantedRole,
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
        membershipId: result.membershipId,
        alreadyHandled: result.alreadyHandled,
        alreadyMember: result.alreadyMember,
        grantedRole: result.grantedRole,
        refreshSession: true,
        refreshWorkspace: true,
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
