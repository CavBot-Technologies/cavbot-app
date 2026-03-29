// app/api/members/[membershipId]/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireSession,
  requireAccountContext,
  requireAccountRole,
  isApiAuthError,
} from "@/lib/apiAuth";
import type { Prisma } from "@prisma/client";
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
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function safeRole(raw: unknown) {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "ADMIN" || v === "MEMBER" || v === "OWNER") return v as "ADMIN" | "MEMBER" | "OWNER";
  return null;
}

async function countOwners(tx: Prisma.TransactionClient, accountId: string) {
  return tx.membership.count({
    where: { accountId, role: "OWNER" },
  });
}

/**
 * PATCH /api/members/:membershipId
 * Body: { role: "ADMIN" | "MEMBER" | "OWNER" }
 *
 * Rules:
 * - ADMIN can set role to ADMIN/MEMBER
 * - OWNER can set role to ADMIN/MEMBER/OWNER
 * - Cannot change your own role here (prevents accidental lockouts)
 * - Cannot demote the last remaining OWNER
 */
export async function PATCH(req: NextRequest, ctx: { params: { membershipId: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    await requireAccountRole(sess, ["OWNER", "ADMIN"]);

    const accountId = sess.accountId!;
    const operatorUserId = sess.sub;

    const membershipId = String(ctx?.params?.membershipId || "").trim();
    if (!membershipId) return json({ error: "BAD_MEMBERSHIP_ID" }, 400);

    const body = (await readSanitizedJson(req, null)) as null | { role?: unknown };
    const nextRole = safeRole(body?.role);
    if (!nextRole) return json({ error: "BAD_ROLE" }, 400);

    // ADMIN cannot grant OWNER
    const operatorMembership = await prisma.membership.findFirst({
      where: { accountId, userId: operatorUserId },
      select: { role: true },
    });

const operatorRole = String(operatorMembership?.role || "").toUpperCase();
if (nextRole === "OWNER" && operatorRole !== "OWNER") {
  return json({ error: "FORBIDDEN_ROLE_GRANT" }, 403);
}

const membership = await prisma.membership.findFirst({
  where: { id: membershipId, accountId },
  select: {
    id: true,
    role: true,
    userId: true,
    user: { select: { email: true } },
  },
});

if (!membership) return json({ error: "MEMBER_NOT_FOUND" }, 404);

// ADMIN can only change MEMBER roles (cannot modify ADMIN/OWNER)
if (operatorRole !== "OWNER") {
  const targetRole = String(membership.role || "").toUpperCase();
  if (targetRole === "ADMIN" || targetRole === "OWNER") {
    return json(
      { error: "FORBIDDEN_TARGET_ROLE", message: "Admins can only manage Members." },
      403
    );
  }
}

    // No self role edits
    if (membership.userId === operatorUserId) {
      return json(
        { error: "CANNOT_EDIT_SELF", message: "You can’t change your own role from Settings." },
        409
      );
    }

    if (membership.role === nextRole) {
      return json({ ok: true, unchanged: true }, 200);
    }

    const result = await prisma.$transaction(async (tx) => {
      // Prevent demoting the last owner
      if (membership.role === "OWNER" && nextRole !== "OWNER") {
        const owners = await countOwners(tx, accountId);
        if (owners <= 1) {
          return { blocked: true as const, reason: "LAST_OWNER" as const };
        }
      }

      const updated = await tx.membership.update({
        where: { id: membership.id },
        data: { role: nextRole },
        select: { id: true, role: true, userId: true },
      });

      return { blocked: false as const, membership: updated };
    });

    if (!result.blocked) {
      await auditLogWrite({
        request: req,
        action: "MEMBER_ROLE_UPDATED",
        accountId,
        operatorUserId,
        targetType: "membership",
        targetId: result.membership.id,
        targetLabel: result.membership.userId,
        metaJson: {
          type: "member_role_updated",
          memberUserId: result.membership.userId,
          from: membership.role,
          to: nextRole,
          email: membership.user.email,
        },
      });
    }
    if (!result.blocked) {
      await auditLogWrite({
        request: req,
        action: "MEMBER_REMOVED",
        accountId,
        operatorUserId,
        targetType: "membership",
        targetId: membership.id,
        targetLabel: membership.userId,
        metaJson: {
          type: "member_removed",
          memberUserId: membership.userId,
          email: membership.user.email,
          role: membership.role,
        },
      });
    }

    if (result.blocked) {
      return json(
        {
          error: "CANNOT_DEMOTE_LAST_OWNER",
          message: "This workspace must always have at least one Owner.",
        },
        409
      );
    }

    return json(
      {
        ok: true,
        membership: {
          id: result.membership.id,
          role: result.membership.role,
          userId: result.membership.userId,
        },
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) return json({ error: error.code }, error.status);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}

/**
 * DELETE /api/members/:membershipId
 *
 * Rules:
 * - Only OWNER/ADMIN
 * - Cannot remove yourself here
 * - Cannot remove the last OWNER
 */
export async function DELETE(req: NextRequest, ctx: { params: { membershipId: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    await requireAccountRole(sess, ["OWNER", "ADMIN"]);

    const accountId = sess.accountId!;
    const operatorUserId = sess.sub;

    const membershipId = String(ctx?.params?.membershipId || "").trim();
    if (!membershipId) return json({ error: "BAD_MEMBERSHIP_ID" }, 400);

    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, accountId },
      select: {
        id: true,
        role: true,
        userId: true,
        user: { select: { email: true } },
      },
    });

    if (!membership) return json({ error: "MEMBER_NOT_FOUND" }, 404);

    // ADMIN can only remove MEMBERS (cannot remove ADMIN/OWNER)
    const operatorMembership = await prisma.membership.findFirst({
      where: { accountId, userId: operatorUserId },
      select: { role: true },
    });

    const operatorRole = String(operatorMembership?.role || "").toUpperCase();
    const targetRole = String(membership.role || "").toUpperCase();

    if (operatorRole !== "OWNER") {
      if (targetRole === "ADMIN" || targetRole === "OWNER") {
        return json({ error: "FORBIDDEN_REMOVE", message: "Admins can only remove Members." }, 403);
      }
    }

    // No self removal from this endpoint (prevents accidental lockout)
    if (membership.userId === operatorUserId) {
      return json(
        { error: "CANNOT_REMOVE_SELF", message: "You can’t remove yourself from this workspace." },
        409
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Prevent removing last owner
      if (membership.role === "OWNER") {
        const owners = await countOwners(tx, accountId);
        if (owners <= 1) {
          return { blocked: true as const };
        }
      }

      await tx.membership.delete({ where: { id: membership.id } });

      return { blocked: false as const };
    });

    if (result.blocked) {
      return json(
        {
          error: "CANNOT_REMOVE_LAST_OWNER",
          message: "This workspace must always have at least one Owner.",
        },
        409
      );
    }

    return json({ ok: true }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ error: error.code }, error.status);
    return json({ error: "SERVER_ERROR" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "PATCH, DELETE, OPTIONS" },
  });
}

export async function GET() {
  return json(
    { error: "METHOD_NOT_ALLOWED" },
    { status: 405, headers: { Allow: "PATCH, DELETE, OPTIONS" } }
  );
}

export async function POST() {
  return json(
    { error: "METHOD_NOT_ALLOWED" },
    { status: 405, headers: { Allow: "PATCH, DELETE, OPTIONS" } }
  );
}
