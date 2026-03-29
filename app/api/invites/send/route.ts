import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireAccountContext, requireAccountRole, requireSession } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { createWorkspaceInvite } from "@/lib/workspaceTeam.server";
import { normalizeUsernameExact } from "@/lib/workspaceIdentity";
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

type SendInviteBody = {
  targetUserId?: unknown;
  targetUsername?: unknown;
  role?: unknown;
};

async function resolveInviteTargetUserId(input: SendInviteBody): Promise<string> {
  const targetUserId = s(input.targetUserId);
  if (targetUserId) return targetUserId;

  const targetUsername = normalizeUsernameExact(input.targetUsername);
  if (!targetUsername) return "";

  const user = await prisma.user.findUnique({
    where: { username: targetUsername },
    select: { id: true },
  });
  return s(user?.id);
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
    requireAccountContext(session);
    await requireAccountRole(session, ["OWNER", "ADMIN"]);

    const userRate = consumeInMemoryRateLimit({
      key: `invite-send:user:${session.sub}`,
      limit: 20,
      windowMs: 60_000,
    });
    if (!userRate.allowed) {
      return json(
        { ok: false, error: "RATE_LIMITED", message: "Too many invite attempts. Please retry shortly." },
        { status: 429, headers: { "Retry-After": String(userRate.retryAfterSec) } },
      );
    }

    const workspaceRate = consumeInMemoryRateLimit({
      key: `invite-send:workspace:${session.accountId}`,
      limit: 80,
      windowMs: 60_000,
    });
    if (!workspaceRate.allowed) {
      return json(
        { ok: false, error: "RATE_LIMITED", message: "Invite rate limit reached for this workspace." },
        { status: 429, headers: { "Retry-After": String(workspaceRate.retryAfterSec) } },
      );
    }

    const clientIp = readClientIp(req);
    if (clientIp) {
      const ipRate = consumeInMemoryRateLimit({
        key: `invite-send:ip:${clientIp}`,
        limit: 120,
        windowMs: 60_000,
      });
      if (!ipRate.allowed) {
        return json(
          { ok: false, error: "RATE_LIMITED", message: "Too many invite attempts from this network." },
          { status: 429, headers: { "Retry-After": String(ipRate.retryAfterSec) } },
        );
      }
    }

    const body = (await readSanitizedJson(req, null)) as SendInviteBody | null;
    const inviteeUserId = await resolveInviteTargetUserId(body || {});
    if (!inviteeUserId) {
      return json(
        { ok: false, error: "INVITEE_NOT_FOUND", message: "Invite target not found." },
        404,
      );
    }

    const result = await createWorkspaceInvite({
      accountId: session.accountId,
      inviterUserId: session.sub,
      role: s(body?.role).toUpperCase() === "ADMIN" ? "ADMIN" : "MEMBER",
      inviteeUserId,
      inviteeEmail: null,
    });

    if (!result.ok) {
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
        status,
      );
    }

    await auditLogWrite({
      request: req,
      accountId: session.accountId,
      operatorUserId: session.sub,
      action: "MEMBER_INVITED",
      actionLabel: "INVITE_SENT",
      targetType: "invite",
      targetId: result.invite.id,
      targetLabel: result.invite.invitee?.username || result.invite.inviteeEmail || null,
      metaJson: {
        event: "INVITE_SENT",
        deduped: result.reused,
        inviteId: result.invite.id,
      },
    });

    return json(
      {
        ok: true,
        deduped: result.reused,
        inviteId: result.invite.id,
        invite: result.invite,
      },
      result.reused ? 200 : 201,
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
