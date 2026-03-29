import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireAccountContext, requireAccountRole, requireSession, requireUser } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { approveWorkspaceAccessRequest, denyWorkspaceAccessRequest } from "@/lib/workspaceTeam.server";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";
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

type RespondAccessRequestBody = {
  requestId?: unknown;
  decision?: unknown;
  role?: unknown;
};

function parseInviteRole(raw: unknown): "MEMBER" | "ADMIN" | null {
  const value = s(raw).toUpperCase();
  if (!value) return null;
  if (value === "MEMBER" || value === "ADMIN") return value;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return json(
        { ok: false, error: "BAD_CSRF", message: "Missing request integrity token." },
        403,
      );
    }

    const session = await requireSession(req);
    requireUser(session);
    requireAccountContext(session);
    await requireAccountRole(session, ["OWNER"]);

    const rate = consumeInMemoryRateLimit({
      key: `access-request-respond:${session.sub}`,
      limit: 80,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return json(
        { ok: false, error: "RATE_LIMITED", message: "Too many access-request responses. Please retry shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
      );
    }

    const body = (await readSanitizedJson(req, null)) as RespondAccessRequestBody | null;
    const requestId = s(body?.requestId);
    const decision = s(body?.decision).toUpperCase();
    const role = parseInviteRole(body?.role);
    if (!requestId) {
      return json({ ok: false, error: "BAD_REQUEST_ID", message: "Request id is required." }, 400);
    }
    if (decision !== "APPROVE" && decision !== "DENY") {
      return json({ ok: false, error: "BAD_DECISION", message: "Decision must be APPROVE or DENY." }, 400);
    }
    if (decision === "APPROVE" && body && body.role !== undefined && body.role !== null && !role) {
      return json(
        { ok: false, error: "FORBIDDEN", message: "Role must be member or admin." },
        403,
      );
    }

    const result = decision === "APPROVE"
      ? await approveWorkspaceAccessRequest({
          requestId,
          operatorUserId: session.sub,
          role: role || "MEMBER",
        })
      : await denyWorkspaceAccessRequest({
          requestId,
          operatorUserId: session.sub,
        });

    if (!result.ok) {
      const status =
        result.error === "REQUEST_NOT_FOUND"
          ? 404
          : result.error === "FORBIDDEN"
            ? 403
            : result.error === "PLAN_SEAT_LIMIT" ||
                result.error === "REQUEST_ALREADY_DENIED" ||
                result.error === "REQUEST_ALREADY_APPROVED" ||
                result.error === "REQUEST_APPROVED_MEMBERSHIP_MISSING"
              ? 409
              : 400;
      return json(result, status);
    }

    await auditLogWrite({
      request: req,
      accountId: result.accountId,
      operatorUserId: session.sub,
      action: "PROJECT_UPDATED",
      actionLabel: decision === "APPROVE" ? "ACCESS_REQUEST_APPROVED" : "ACCESS_REQUEST_DENIED",
      targetType: "workspace_access_request",
      targetId: result.requestId,
      targetLabel: result.workspaceName || result.accountId,
      metaJson: {
        event: decision === "APPROVE" ? "ACCESS_REQUEST_APPROVED" : "ACCESS_REQUEST_DENIED",
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
        requestId: result.requestId,
        accountId: result.accountId,
        workspaceName: result.workspaceName,
        status: result.status,
        membershipId: result.membershipId,
        alreadyHandled: result.alreadyHandled,
        alreadyMember: result.alreadyMember,
        grantedRole: result.grantedRole,
        refreshSession: decision === "APPROVE",
        refreshWorkspace: decision === "APPROVE",
      },
      200,
    );
  } catch (error) {
    if (isApiAuthError(error)) {
      const guardPayload = buildGuardDecisionPayload({
        status: error.status,
        errorCode: error.code,
      });
      return json({ ok: false, error: error.code, ...(guardPayload || {}) }, error.status);
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
