// app/api/members/invite/[id]/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireSession,
  requireAccountContext,
  requireAccountRole,
  isApiAuthError,
} from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";

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

/**
 * DELETE /api/members/invite/:id
 * Cancels an invite (only OWNER/ADMIN)
 */
export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    await requireAccountRole(sess, ["OWNER", "ADMIN"]);

    const accountId = sess.accountId!;
    const operatorUserId = sess.sub;

    const inviteId = String(ctx?.params?.id || "").trim();
    if (!inviteId) return json({ error: "BAD_INVITE_ID" }, 400);

    const invite = await prisma.invite.findFirst({
      where: { id: inviteId, accountId },
      select: {
        id: true,
        email: true,
        inviteeEmail: true,
        inviteeUserId: true,
        role: true,
        status: true,
        acceptedAt: true,
        expiresAt: true,
      },
    });

    if (!invite) return json({ error: "INVITE_NOT_FOUND" }, 404);

    // If already accepted, treat as not cancellable via invite endpoint
    if (invite.acceptedAt || invite.status === "ACCEPTED") {
      return json({ error: "INVITE_ALREADY_ACCEPTED" }, 409);
    }

    await prisma.$transaction(async (tx) => {
      await tx.invite.update({
        where: { id: invite.id },
        data: {
          status: "REVOKED",
          respondedAt: new Date(),
        },
      });
    });

    if (accountId) {
      await auditLogWrite({
        request: req,
        action: "MEMBER_REMOVED",
        accountId,
        operatorUserId,
        targetType: "invite",
        targetId: invite.id,
        targetLabel: invite.inviteeEmail || invite.email,
        metaJson: {
          email: invite.inviteeEmail || invite.email,
          inviteeUserId: invite.inviteeUserId,
          role: invite.role,
          reason: "invite_cancelled",
        },
      });
    }

    return json({ ok: true }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ error: error.code }, error.status);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "DELETE, OPTIONS" },
  });
}

export async function GET() {
  return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "DELETE, OPTIONS" } });
}

export async function POST() {
  return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "DELETE, OPTIONS" } });
}

export async function PATCH() {
  return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "DELETE, OPTIONS" } });
}
