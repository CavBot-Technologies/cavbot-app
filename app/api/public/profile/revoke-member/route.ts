import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireSession, requireUser } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { resolvePublicProfileWorkspaceContext } from "@/lib/publicProfile/teamState.server";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
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

const CSRF_HEADER = "x-cavbot-csrf";

type RevokeMemberBody = {
  username?: unknown;
  targetUserId?: unknown;
};

function json<T>(data: T, status = 200, extra?: Record<string, string>) {
  return NextResponse.json(data, {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      ...(extra || {}),
    },
  });
}

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function isCsrfHeaderValid(req: NextRequest): boolean {
  const value = s(req.headers.get(CSRF_HEADER)).toLowerCase();
  return value === "1" || value === "true";
}

function readClientIp(req: NextRequest): string {
  const direct = s(req.headers.get("cf-connecting-ip")) || s(req.headers.get("true-client-ip")) || s(req.headers.get("x-real-ip"));
  if (direct) return direct;
  const forwarded = s(req.headers.get("x-forwarded-for"));
  if (!forwarded) return "";
  return s(forwarded.split(",")[0]);
}

export async function POST(req: NextRequest) {
  try {
    if (!isCsrfHeaderValid(req)) {
      return json({ ok: false, error: "BAD_CSRF", message: "Missing request integrity token." }, 403);
    }

    const session = await requireSession(req);
    requireUser(session);

    const body = (await readSanitizedJson(req, null)) as RevokeMemberBody | null;
    if (!body) return json({ ok: false, error: "BAD_REQUEST" }, 400);

    const username = s(body.username);
    const targetUserId = s(body.targetUserId);
    const operatorUserId = s(session.sub);
    if (!username || !targetUserId || !operatorUserId) return json({ ok: false, error: "BAD_REQUEST" }, 400);
    if (targetUserId === operatorUserId) {
      return json({ ok: false, error: "CANNOT_REVOKE_SELF", message: "You cannot revoke your own access." }, 409);
    }

    const workspace = await resolvePublicProfileWorkspaceContext(username);
    if (!workspace?.workspaceId) return json({ ok: false, error: "WORKSPACE_NOT_FOUND" }, 404);
    const accountId = workspace.workspaceId;
    const workspaceName = s(workspace.workspaceName) || "Workspace";

    const userRate = consumeInMemoryRateLimit({
      key: `public-profile-revoke-member:user:${operatorUserId}:${accountId}`,
      limit: 16,
      windowMs: 60_000,
    });
    if (!userRate.allowed) {
      return json(
        { ok: false, error: "RATE_LIMITED", message: "Too many revoke requests. Please retry shortly." },
        429,
        { "Retry-After": String(userRate.retryAfterSec) }
      );
    }

    const clientIp = readClientIp(req);
    if (clientIp) {
      const ipRate = consumeInMemoryRateLimit({
        key: `public-profile-revoke-member:ip:${clientIp}`,
        limit: 64,
        windowMs: 60_000,
      });
      if (!ipRate.allowed) {
        return json(
          { ok: false, error: "RATE_LIMITED", message: "Too many revoke requests from this network. Please retry shortly." },
          429,
          { "Retry-After": String(ipRate.retryAfterSec) }
        );
      }
    }

    const [operatorMembership, targetMembership] = await Promise.all([
      prisma.membership.findUnique({
        where: {
          accountId_userId: {
            accountId,
            userId: operatorUserId,
          },
        },
        select: {
          role: true,
          user: {
            select: {
              username: true,
              email: true,
            },
          },
        },
      }).catch(() => null),
      prisma.membership.findUnique({
        where: {
          accountId_userId: {
            accountId,
            userId: targetUserId,
          },
        },
        select: {
          id: true,
          role: true,
          userId: true,
          user: {
            select: {
              username: true,
              email: true,
            },
          },
        },
      }).catch(() => null),
    ]);

    const operatorRole = s(operatorMembership?.role).toUpperCase();
    if (operatorRole !== "OWNER" && operatorRole !== "ADMIN") return json({ ok: false, error: "FORBIDDEN" }, 403);

    if (!targetMembership?.id || !targetMembership.userId) {
      return json({ ok: false, error: "TARGET_NOT_MEMBER", message: "Member not found in this workspace." }, 404);
    }

    const targetRole = s(targetMembership.role).toUpperCase();
    if (operatorRole === "ADMIN" && (targetRole === "ADMIN" || targetRole === "OWNER")) {
      return json({ ok: false, error: "FORBIDDEN", message: "Admins can only revoke members." }, 403);
    }

    if (targetRole === "OWNER") {
      if (operatorRole !== "OWNER") {
        return json({ ok: false, error: "FORBIDDEN", message: "Only owners can revoke owners." }, 403);
      }
      const ownersCount = await prisma.membership.count({
        where: {
          accountId,
          role: "OWNER",
        },
      }).catch(() => 0);
      if (ownersCount <= 1) {
        return json(
          {
            ok: false,
            error: "CANNOT_REMOVE_LAST_OWNER",
            message: "This workspace must always have at least one owner.",
          },
          409
        );
      }
    }

    await prisma.membership.delete({
      where: {
        id: targetMembership.id,
      },
    });

    try {
      await prisma.notification.create({
        data: {
          userId: targetMembership.userId,
          accountId,
          title: "Workspace access revoked",
          body: `Your access to ${workspaceName} was revoked.`,
          tone: "WATCH",
          kind: "GENERIC",
          metaJson: {
            entityType: "membership",
            workspace: {
              id: accountId,
              name: workspaceName,
            },
            removedBy: {
              userId: operatorUserId,
              username: s(operatorMembership?.user?.username) || null,
              email: s(operatorMembership?.user?.email) || null,
            },
          },
        },
      });
    } catch {
      // Notification write is best-effort.
    }

    await auditLogWrite({
      request: req,
      accountId,
      operatorUserId,
      action: "MEMBER_REMOVED",
      targetType: "membership",
      targetId: targetMembership.id,
      targetLabel: s(targetMembership.user?.username) ? `@${s(targetMembership.user?.username)}` : s(targetMembership.user?.email) || targetUserId,
      metaJson: {
        source: "public_profile_members_grid",
        profileUsername: username,
        memberUserId: targetUserId,
        memberRole: targetRole || "MEMBER",
        operatorRole,
      },
    });

    return json({
      ok: true,
      workspaceId: accountId,
      targetUserId,
      membershipId: targetMembership.id,
    });
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...NO_STORE_HEADERS,
      Allow: "POST, OPTIONS",
    },
  });
}
