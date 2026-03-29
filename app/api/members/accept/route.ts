// app/api/members/accept/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireUser, isApiAuthError } from "@/lib/apiAuth";
import { resolvePlanIdFromTier, getPlanLimits } from "@/lib/plans";
import crypto from "crypto";
import { auditLogWrite } from "@/lib/audit";
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
    headers: {
      ...(resInit.headers || {}),
      ...NO_STORE_HEADERS,
    },
  });
}

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeEmail(raw: string) {
  return String(raw || "").trim().toLowerCase();
}

/**
 * POST /api/members/accept
 * Body: { token: string }
 */
export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);

    // Accept must work even if user is not in an account yet
    requireUser(sess);

    const userId = sess.sub;

    const body = (await readSanitizedJson(req, null)) as null | { token?: string };
    const token = String(body?.token || "").trim();
    if (!token) return json({ error: "BAD_TOKEN" }, 400);

    const tokenHash = sha256Hex(token);

    // Fetch user email so we can bind invite -> intended recipient (SECURITY)
    const user = await prisma.user.findFirst({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) return json({ error: "USER_NOT_FOUND" }, 404);

    const invite = await prisma.invite.findFirst({
      where: {
        tokenHash,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        accountId: true,
        email: true,
        role: true,
        expiresAt: true,
      },
    });

    if (!invite) {
      return json({ error: "INVITE_NOT_FOUND", message: "Invite is invalid or expired." }, 404);
    }

    // CRITICAL: enforce invite is for this user email
    if (normalizeEmail(invite.email) !== normalizeEmail(user.email)) {
      return json(
        {
          error: "INVITE_EMAIL_MISMATCH",
          message: "This invite was issued for a different email address.",
        },
        403
      );
    }

    // Load account tier (Plan enforcement source)
    const account = await prisma.account.findFirst({
      where: { id: invite.accountId },
      select: { id: true, tier: true },
    });

    if (!account) return json({ error: "ACCOUNT_NOT_FOUND" }, 404);

    const planId = resolvePlanIdFromTier(account.tier);
    const limits = getPlanLimits(planId);
    const seatLimit = Number(limits?.seats ?? 0);

    type AcceptResult =
      | { kind: "ALREADY_MEMBER"; membershipId: string }
      | { kind: "CREATED"; membershipId: string }
      | { kind: "PLAN_SEAT_LIMIT"; limit: number; used: number };

    const result: AcceptResult = await prisma.$transaction(async (tx) => {
      const existing = await tx.membership.findFirst({
        where: { accountId: invite.accountId, userId },
        select: { id: true },
      });

      if (existing) {
        await tx.invite.update({
          where: { id: invite.id },
          data: {
            status: "ACCEPTED",
            acceptedAt: new Date(),
            respondedAt: new Date(),
            inviteeUserId: userId,
          },
        });

        return { kind: "ALREADY_MEMBER", membershipId: existing.id };
      }

      if (seatLimit > 0) {
        const membersCount = await tx.membership.count({
          where: { accountId: invite.accountId },
        });

        if (membersCount >= seatLimit) {
          return { kind: "PLAN_SEAT_LIMIT", limit: seatLimit, used: membersCount };
        }
      }

      const membership = await tx.membership.create({
        data: {
          accountId: invite.accountId,
          userId,
          role: invite.role,
        },
        select: { id: true },
      });

      await tx.invite.update({
        where: { id: invite.id },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          respondedAt: new Date(),
          inviteeUserId: userId,
        },
      });

        return { kind: "CREATED", membershipId: membership.id };
      });

    if (result.kind === "CREATED") {
      await auditLogWrite({
        request: req,
        action: "MEMBER_INVITED",
        accountId: invite.accountId,
        operatorUserId: userId,
        targetType: "membership",
        targetId: result.membershipId,
        targetLabel: invite.email || invite.role,
        metaJson: {
          acceptedInviteId: invite.id,
          email: invite.email,
          role: invite.role,
        },
      });
    }

    if (result.kind === "PLAN_SEAT_LIMIT") {
      return json(
        {
          error: "PLAN_SEAT_LIMIT",
          message: "Seat limit reached for this plan.",
          limit: result.limit,
          used: result.used,
          planId,
        },
        403
      );
    }

    const alreadyMember = result.kind === "ALREADY_MEMBER";
    return json(
      {
        ok: true,
        alreadyMember,
        accountId: invite.accountId,
        role: invite.role,
        membershipId: result.membershipId,
      },
      200
    );
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ error: error.code }, error.status);
    return json({ error: "SERVER_ERROR" }, 500);
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

export async function GET() {
  return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
