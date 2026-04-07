// app/api/members/invite/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";
import { prisma } from "@/lib/prisma";
import {
  getAppOrigin,
  requireSession,
  requireAccountContext,
  requireAccountRole,
  isApiAuthError,
} from "@/lib/apiAuth";
import { resolvePlanIdFromTier, getPlanLimits } from "@/lib/plans";
import { sendInviteEmail } from "@/lib/mailer.server";
import { auditLogWrite } from "@/lib/audit";
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

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeEmail(raw: string) {
  return String(raw || "").trim().toLowerCase();
}

function safeInviteRole(raw: unknown) {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "ADMIN" || v === "MEMBER") return v as "ADMIN" | "MEMBER";
  return "MEMBER";
}

function isEmailLike(email: string) {
  return email.includes("@") && email.includes(".") && email.length <= 254;
}

/**
 * Fixes the comma-origin bug permanently:
 * "https://app.cavbot.io,https://preview.example.com" -> "https://app.cavbot.io"
 */
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

/**
 * POST /api/members/invite
 * Body: { email: string, role?: "MEMBER" | "ADMIN" }
 *
 * Returns:
 * - 201 { ok:true, invite: { ... }, emailed:true, acceptUrl? (dev only) }
 * - 409 INVITE_EXISTS / ALREADY_MEMBER
 * - 403 PLAN_SEAT_LIMIT
 */
export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    await requireAccountRole(sess, ["OWNER", "ADMIN"]);

    const accountId = sess.accountId!;
    const senderUserId = sess.sub;

    type InviteBody = {
      email?: string;
      role?: string;
      verificationGrantToken?: string;
      verificationSessionId?: string;
    };

    const body = (await readSanitizedJson(req, null)) as null | InviteBody;
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
    const reject = (payload: Record<string, unknown>, status: number) => {
      recordVerifyActionFailure(req, { actionType: "invite", sessionIdHint: verifySessionHint });
      return json(payload, status);
    };

    const email = normalizeEmail(body?.email || "");
    if (!email || !isEmailLike(email)) {
      return reject({ error: "BAD_EMAIL", message: "Enter a valid email address." }, 400);
    }

    const role = safeInviteRole(body?.role);

    // Load account tier (source of truth)
    const account = await prisma.account.findFirst({
      where: { id: accountId },
      select: { id: true, tier: true },
    });

    if (!account) return reject({ error: "ACCOUNT_NOT_FOUND" }, 404);

    const plan = await getEffectiveAccountPlanContext(accountId).catch(() => null);
    const planId = plan?.planId ?? resolvePlanIdFromTier(account.tier);
    const limits = getPlanLimits(planId);
    const seatLimit = Number(limits?.seats ?? 0);

    // Invite token + hash
    const inviteToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = sha256Hex(inviteToken);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

    // Create invite inside transaction
    type InviteCreationResult =
      | { kind: "ALREADY_MEMBER" }
      | { kind: "INVITE_EXISTS"; inviteId: string; expiresAt: Date; role: "ADMIN" | "MEMBER" }
      | { kind: "PLAN_SEAT_LIMIT"; used: number; limit: number }
      | {
          kind: "CREATED";
          invite: {
            id: string;
            email: string;
            role: "ADMIN" | "MEMBER";
            expiresAt: Date;
            createdAt: Date;
          };
        };

    const result: InviteCreationResult = await prisma.$transaction(async (tx) => {
      // already a member
      const existingMember = await tx.membership.findFirst({
        where: { accountId, user: { email } },
        select: { id: true },
      });

      if (existingMember) return { kind: "ALREADY_MEMBER" as const };

      // invite exists + active
      const existingInvite = await tx.invite.findFirst({
        where: {
          accountId,
          email,
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
        select: { id: true, expiresAt: true, role: true },
      });

      if (existingInvite) {
        return {
          kind: "INVITE_EXISTS" as const,
          inviteId: existingInvite.id,
          expiresAt: existingInvite.expiresAt,
          role: existingInvite.role === "ADMIN" ? "ADMIN" : "MEMBER",
        };
      }

      // seat enforcement
      if (seatLimit > 0) {
        const membersCount = await tx.membership.count({ where: { accountId } });

        const pendingInvitesCount = await tx.invite.count({
          where: { accountId, status: "PENDING", expiresAt: { gt: new Date() } },
        });

        const usedSeats = membersCount + pendingInvitesCount;
        if (usedSeats >= seatLimit) {
          return {
            kind: "PLAN_SEAT_LIMIT" as const,
            used: usedSeats,
            limit: seatLimit,
          };
        }
      }

      // create invite
      const row = await tx.invite.create({
        data: {
          accountId,
          email,
          inviteeEmail: email,
          role,
          status: "PENDING",
          tokenHash,
          expiresAt,
          sentById: senderUserId,
        },
        select: {
          id: true,
          email: true,
          role: true,
          expiresAt: true,
          createdAt: true,
        },
      });

      return {
        kind: "CREATED" as const,
        invite: {
          ...row,
          role: row.role === "ADMIN" ? "ADMIN" : "MEMBER",
        },
      };
    });

    if (result.kind === "CREATED") {
      await auditLogWrite({
        request: req,
        action: "MEMBER_INVITED",
        accountId,
        operatorUserId: senderUserId,
        targetType: "invite",
        targetId: result.invite.id,
        targetLabel: result.invite.email,
        metaJson: {
          email: result.invite.email,
          role: result.invite.role,
          expiresAt: result.invite.expiresAt.toISOString(),
        },
      });
    }

    // Handle conflict responses
    if (result.kind === "ALREADY_MEMBER") {
      return reject({ error: "ALREADY_MEMBER", message: "This user is already a member." }, 409);
    }

    if (result.kind === "INVITE_EXISTS") {
      return reject(
        {
          error: "INVITE_EXISTS",
          message: "An active invite already exists for this email.",
          inviteId: result.inviteId,
          expiresAt: result.expiresAt.toISOString(),
          role: result.role,
        },
        409
      );
    }

    if (result.kind === "PLAN_SEAT_LIMIT") {
      return reject(
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

    const appOrigin = pickOrigin(
      process.env.CAVBOT_APP_ORIGIN ||
        process.env.NEXT_PUBLIC_APP_ORIGIN ||
        getAppOrigin()
    );

    const acceptUrl = `${appOrigin}/accept-invite?token=${encodeURIComponent(inviteToken)}`;

    const emailRole: "ADMIN" | "MEMBER" =
      result.invite.role === "ADMIN" ? "ADMIN" : "MEMBER";

    try {
      await sendInviteEmail({
        to: email,
        role: emailRole,
        inviteToken,
        origin: appOrigin,
      });

    } catch {
      recordVerifyActionSuccess(req, { actionType: "invite", sessionIdHint: verifySessionHint });
      return json(
        {
          ok: true,
          invite: {
            id: result.invite.id,
            email: result.invite.email,
            role: result.invite.role,
            expiresAt: result.invite.expiresAt.toISOString(),
            createdAt: result.invite.createdAt.toISOString(),
          },
          emailed: false,
          // DEV fallback only
          inviteToken: process.env.NODE_ENV !== "production" ? inviteToken : undefined,
          acceptUrl: process.env.NODE_ENV !== "production" ? acceptUrl : undefined,
        },
        201
      );
    }

    recordVerifyActionSuccess(req, { actionType: "invite", sessionIdHint: verifySessionHint });
    return json(
      {
        ok: true,
        invite: {
          id: result.invite.id,
          email: result.invite.email,
          role: result.invite.role,
          expiresAt: result.invite.expiresAt.toISOString(),
          createdAt: result.invite.createdAt.toISOString(),
        },
        emailed: true,
        // DEV fallback only
        inviteToken: process.env.NODE_ENV !== "production" ? inviteToken : undefined,
        acceptUrl: process.env.NODE_ENV !== "production" ? acceptUrl : undefined,
      },
      201
    );
  } catch (error: unknown) {
    if (!(isApiAuthError(error))) {
      recordVerifyActionFailure(req, { actionType: "invite", sessionIdHint: extractVerifySessionId(req) });
    }
    if (isApiAuthError(error)) return json({ error: error.code }, error.status);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}

export async function GET() {
  return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
