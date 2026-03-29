// app/api/members/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { resolvePlanIdFromTier, getPlanLimits } from "@/lib/plans";

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
    headers: {
      ...(resInit.headers || {}),
      ...NO_STORE_HEADERS,
    },
  });
}

/**
 * GET /api/members
 * Returns:
 * - members[]
 * - invites[] (pending only)
 */
export async function GET(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const accountId = sess.accountId;

    const account = await prisma.account.findFirst({
      where: { id: accountId },
      select: { tier: true },
    });

    const planId = resolvePlanIdFromTier(account?.tier || "FREE");
    const limits = getPlanLimits(planId);
    const seatLimit = Number(limits?.seats ?? 0);

    const [members, invites] = await Promise.all([
      prisma.membership.findMany({
        where: { accountId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              displayName: true,
              createdAt: true,
              lastLoginAt: true,
            },
          },
        },
      }),

      prisma.invite.findMany({
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
          expiresAt: true,
          createdAt: true,
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
      }),
    ]);

return json(
  {
    ok: true,
    planId,
    seatLimit,
    seatsUsed: members.length + invites.length,

    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      user: {
        id: m.user.id,
        username: m.user.username,
        email: m.user.email,
        displayName: m.user.displayName,
        createdAt: m.user.createdAt.toISOString(),
        lastLoginAt: m.user.lastLoginAt ? m.user.lastLoginAt.toISOString() : null,
      },
    })),
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      inviteeEmail: i.inviteeEmail,
      inviteeUserId: i.inviteeUserId,
      role: i.role,
      status: i.status,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
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
    headers: {
      ...NO_STORE_HEADERS,
      Allow: "GET, OPTIONS",
    },
  });
}

export async function POST() {
  return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "GET, OPTIONS" } });
}
