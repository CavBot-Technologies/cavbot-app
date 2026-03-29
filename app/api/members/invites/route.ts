// app/api/members/invites/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";

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
 * GET /api/members/invites
 * Returns pending invites only (non-expired, not accepted)
 */
export async function GET(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const accountId = sess.accountId!;

    const invites = await prisma.invite.findMany({
      where: {
        accountId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        inviteeEmail: true,
        inviteeUserId: true,
        role: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        respondedAt: true,
        sentById: true,
        invitee: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarImage: true,
          },
        },
      },
    });

    return json(
      {
        ok: true,
        invites: invites.map((i) => ({
          id: i.id,
          email: i.email,
          inviteeEmail: i.inviteeEmail,
          inviteeUserId: i.inviteeUserId,
          role: i.role,
          status: i.status,
          createdAt: i.createdAt.toISOString(),
          expiresAt: i.expiresAt.toISOString(),
          respondedAt: i.respondedAt ? i.respondedAt.toISOString() : null,
          sentById: i.sentById,
          invitee: i.invitee
            ? {
                id: i.invitee.id,
                username: i.invitee.username,
                displayName: i.invitee.displayName,
                avatarUrl: i.invitee.avatarImage,
              }
            : null,
        })),
      },
      200
    );
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ error: e.code }, e.status);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" },
  });
}

export async function POST() {
  return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "GET, OPTIONS" } });
}

export async function PATCH() {
  return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "GET, OPTIONS" } });
}

export async function DELETE() {
  return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "GET, OPTIONS" } });
}
