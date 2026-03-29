import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { getAppOrigin, isApiAuthError, requireAccountContext, requireAccountRole, requireSession } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { sendInviteEmail } from "@/lib/mailer.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { createWorkspaceInvite } from "@/lib/workspaceTeam.server";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  buildVerifyErrorPayload,
  ensureActionVerification,
  extractVerifyGrantToken,
  extractVerifySessionId,
  recordVerifyActionFailure,
  recordVerifyActionSuccess,
} from "@/lib/auth/cavbotVerify";

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

function pickOrigin(raw: string) {
  const first = String(raw || "").split(",")[0].trim();
  if (!first) return getAppOrigin();
  const withScheme = /^https?:\/\//i.test(first) ? first : `https://${first}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return getAppOrigin();
  }
}

function readClientIp(req: NextRequest): string {
  const direct =
    String(req.headers.get("cf-connecting-ip") || "").trim() ||
    String(req.headers.get("true-client-ip") || "").trim() ||
    String(req.headers.get("x-real-ip") || "").trim();
  if (direct) return direct;
  const forwarded = String(req.headers.get("x-forwarded-for") || "").trim();
  if (!forwarded) return "";
  return String(forwarded.split(",")[0] || "").trim();
}

type CreateInviteBody = {
  inviteeUserId?: unknown;
  inviteeEmail?: unknown;
  role?: unknown;
  verificationGrantToken?: unknown;
  verificationSessionId?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return json(
        { ok: false, error: "BAD_CSRF", message: "Missing request integrity token." },
        403,
      );
    }

    const session = await requireSession(req);
    requireAccountContext(session);
    await requireAccountRole(session, ["OWNER", "ADMIN"]);

    const userRate = consumeInMemoryRateLimit({
      key: `workspace-invites:user:${session.sub}`,
      limit: 24,
      windowMs: 60_000,
    });
    if (!userRate.allowed) {
      return json(
        { ok: false, error: "RATE_LIMITED", message: "Too many invite attempts. Please retry shortly." },
        { status: 429, headers: { "Retry-After": String(userRate.retryAfterSec) } },
      );
    }
    const clientIp = readClientIp(req);
    if (clientIp) {
      const ipRate = consumeInMemoryRateLimit({
        key: `workspace-invites:ip:${clientIp}`,
        limit: 80,
        windowMs: 60_000,
      });
      if (!ipRate.allowed) {
        return json(
          { ok: false, error: "RATE_LIMITED", message: "Too many invite attempts from this network." },
          { status: 429, headers: { "Retry-After": String(ipRate.retryAfterSec) } },
        );
      }
    }

    const body = (await readSanitizedJson(req, null)) as CreateInviteBody | null;
    const verificationGate = ensureActionVerification(req, {
      actionType: "invite",
      route: "/settings?section=team",
      sessionIdHint: extractVerifySessionId(req, body?.verificationSessionId),
      verificationGrantToken: extractVerifyGrantToken(req, body?.verificationGrantToken),
    });
    if (!verificationGate.ok) {
      return json(
        buildVerifyErrorPayload(verificationGate),
        verificationGate.decision === "block" ? 429 : 403,
      );
    }

    const verifySessionHint = verificationGate.sessionId;

    const result = await createWorkspaceInvite({
      accountId: session.accountId,
      inviterUserId: session.sub,
      role: s(body?.role).toUpperCase() === "ADMIN" ? "ADMIN" : "MEMBER",
      inviteeUserId: s(body?.inviteeUserId) || null,
      inviteeEmail: s(body?.inviteeEmail) || null,
    });

    if (!result.ok) {
      recordVerifyActionFailure(req, { actionType: "invite", sessionIdHint: verifySessionHint });
      const status =
        result.error === "ALREADY_MEMBER"
          ? 409
          : result.error === "PLAN_SEAT_LIMIT"
            ? 403
            : result.error === "INVITEE_NOT_FOUND"
              ? 404
              : 400;

      return json(
        {
          ok: false,
          error: result.error,
          message: result.message,
        },
        status
      );
    }

    let emailStatus: "SKIPPED" | "SENT" | "FAILED" = "SKIPPED";
    let acceptUrl: string | null = null;

    if (result.emailDelivery) {
      const appOrigin = pickOrigin(
        process.env.CAVBOT_APP_ORIGIN ||
          process.env.NEXT_PUBLIC_APP_ORIGIN ||
          getAppOrigin()
      );
      acceptUrl = `${appOrigin}/accept-invite?token=${encodeURIComponent(result.emailDelivery.token)}`;

      try {
        await sendInviteEmail({
          to: result.emailDelivery.to,
          role: result.invite.role,
          inviteToken: result.emailDelivery.token,
          origin: appOrigin,
        });
        emailStatus = "SENT";
      } catch {
        emailStatus = "FAILED";
      }
    }

    recordVerifyActionSuccess(req, { actionType: "invite", sessionIdHint: verifySessionHint });
    await auditLogWrite({
      request: req,
      accountId: session.accountId,
      operatorUserId: session.sub,
      action: "MEMBER_INVITED",
      targetType: "invite",
      targetId: result.invite.id,
      targetLabel: result.invite.invitee?.username || result.invite.inviteeEmail || null,
      metaJson: {
        role: result.invite.role,
        reused: result.reused,
        emailStatus,
      },
    });
    return json(
      {
        ok: true,
        reused: result.reused,
        invite: result.invite,
        emailStatus,
        acceptUrl: process.env.NODE_ENV !== "production" ? acceptUrl : undefined,
      },
      result.reused ? 200 : 201
    );
  } catch (error) {
    if (!(isApiAuthError(error))) {
      recordVerifyActionFailure(req, { actionType: "invite", sessionIdHint: extractVerifySessionId(req) });
    }
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

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
