import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { buildAdminDepartmentScopeSet } from "@/lib/admin/access";
import {
  createOperatorIdReadyNotification,
  markOperatorOfferAccepted,
  readOperatorInviteMeta,
} from "@/lib/admin/operatorOnboarding.server";
import { writeAdminAuditLog } from "@/lib/admin/audit";
import { recordAdminEventSafe } from "@/lib/admin/events";
import { issueNextStaffCode } from "@/lib/admin/staff";
import { assertWriteOrigin, ApiAuthError, requireSession, requireUser } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type Body = {
  inviteId?: unknown;
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: {
      ...(base.headers || {}),
      ...NO_STORE_HEADERS,
    },
  });
}

function s(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeEmail(value: unknown) {
  return s(value).toLowerCase();
}

function maskOperatorId(staffCode: string) {
  const suffix = s(staffCode).slice(-4);
  return suffix ? `•••• ${suffix}` : "••••";
}

export async function POST(req: NextRequest) {
  try {
    assertWriteOrigin(req);
    const session = await requireSession(req);
    requireUser(session);

    const body = (await readSanitizedJson(req, {} as Body)) as Body;
    const inviteId = s(body.inviteId);
    if (!inviteId) {
      return json({ ok: false, error: "BAD_INVITE_ID" }, 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user?.id || !user.email) {
      return json({ ok: false, error: "USER_NOT_FOUND" }, 404);
    }

    const invite = await prisma.staffInvite.findUnique({
      where: { id: inviteId },
      select: {
        id: true,
        email: true,
        normalizedEmail: true,
        systemRole: true,
        positionTitle: true,
        status: true,
        invitedByUserId: true,
        inviteeUserId: true,
        acceptedStaffId: true,
        expiresAt: true,
        revokedAt: true,
        metaJson: true,
      },
    });

    if (!invite) {
      return json({ ok: false, error: "INVITE_NOT_FOUND", message: "Operator offer not found." }, 404);
    }

    if (invite.revokedAt) {
      return json({ ok: false, error: "INVITE_REVOKED", message: "This operator offer is no longer active." }, 409);
    }

    if (invite.status !== "PENDING") {
      return json({ ok: false, error: "INVITE_NOT_PENDING", message: "This operator offer has already been handled." }, 409);
    }

    if (invite.expiresAt.getTime() <= Date.now()) {
      await prisma.staffInvite.updateMany({
        where: {
          id: invite.id,
          status: "PENDING",
        },
        data: {
          status: "EXPIRED",
        },
      });
      return json({ ok: false, error: "INVITE_EXPIRED", message: "This operator offer has expired." }, 410);
    }

    const normalizedUserEmail = normalizeEmail(user.email);
    if (invite.inviteeUserId && invite.inviteeUserId !== user.id) {
      return json({ ok: false, error: "INVITE_FOR_DIFFERENT_USER", message: "This operator offer belongs to another account." }, 403);
    }
    if (normalizeEmail(invite.normalizedEmail || invite.email) !== normalizedUserEmail) {
      return json({ ok: false, error: "INVITE_EMAIL_MISMATCH", message: "This operator offer was issued for a different email." }, 403);
    }

    const inviteMeta = readOperatorInviteMeta(invite.metaJson);
    const department = inviteMeta.department;
    const acceptedAt = new Date();

    const existingProfile = await prisma.staffProfile.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        staffCode: true,
        onboardingStatus: true,
        createdByUserId: true,
      },
    });
    const issuedStaffCode = existingProfile?.staffCode || await issueNextStaffCode();

    const profile = await prisma.$transaction(async (tx) => {
      const profileRow = existingProfile
        ? await tx.staffProfile.update({
            where: { id: existingProfile.id },
            data: {
              systemRole: invite.systemRole,
              scopes: buildAdminDepartmentScopeSet(department),
              positionTitle: invite.positionTitle,
              status: "ACTIVE",
              onboardingStatus: existingProfile.onboardingStatus === "COMPLETED" ? "COMPLETED" : "READY",
              invitedEmail: normalizedUserEmail,
              invitedByUserId: invite.invitedByUserId || null,
              createdByUserId: existingProfile.createdByUserId || invite.invitedByUserId || user.id,
            },
            select: {
              id: true,
              staffCode: true,
            },
          })
        : await tx.staffProfile.create({
            data: {
              userId: user.id,
              staffCode: issuedStaffCode,
              systemRole: invite.systemRole,
              scopes: buildAdminDepartmentScopeSet(department),
              positionTitle: invite.positionTitle,
              status: "ACTIVE",
              onboardingStatus: "READY",
              invitedEmail: normalizedUserEmail,
              invitedByUserId: invite.invitedByUserId || null,
              createdByUserId: invite.invitedByUserId || user.id,
              metadataJson: {
                inviteId: invite.id,
                onboardedFromInvite: true,
                department,
              },
            },
            select: {
              id: true,
              staffCode: true,
            },
          });

      const accepted = await tx.staffInvite.updateMany({
        where: {
          id: invite.id,
          status: "PENDING",
        },
        data: {
          status: "ACCEPTED",
          acceptedAt,
          inviteeUserId: user.id,
          acceptedStaffId: profileRow.id,
        },
      });

      if (accepted.count !== 1) {
        throw new Error("INVITE_STATE_CHANGED");
      }

      return profileRow;
    });

    await Promise.all([
      markOperatorOfferAccepted({
        notificationId: inviteMeta.notificationId,
        userId: user.id,
        inviteId: invite.id,
        staffCode: profile.staffCode,
      }),
      createOperatorIdReadyNotification({
        userId: user.id,
        staffId: profile.id,
        staffCode: profile.staffCode,
        department,
        positionTitle: invite.positionTitle,
      }),
      recordAdminEventSafe({
        name: "staff_invite_accepted",
        actorUserId: user.id,
        subjectUserId: user.id,
        result: "accepted",
        metaJson: {
          inviteId: invite.id,
          staffId: profile.id,
          staffCode: maskOperatorId(profile.staffCode),
          department,
          positionTitle: invite.positionTitle,
        },
      }),
      writeAdminAuditLog({
        actorStaffId: profile.id,
        actorUserId: user.id,
        action: "STAFF_INVITE_ACCEPTED",
        actionLabel: "Operator offer accepted",
        entityType: "staff_invite",
        entityId: invite.id,
        entityLabel: normalizedUserEmail,
        request: req,
        metaJson: {
          staffId: profile.id,
          staffCode: maskOperatorId(profile.staffCode),
          department,
          positionTitle: invite.positionTitle,
        },
      }),
    ]);

    return json({
      ok: true,
      inviteId: invite.id,
      staffCode: maskOperatorId(profile.staffCode),
      message: "Operator onboarding accepted. Check your notifications to view your staff ID.",
      refreshSession: true,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    if (error instanceof Error && error.message === "INVITE_STATE_CHANGED") {
      return json({ ok: false, error: "INVITE_STATE_CHANGED", message: "This operator offer was already handled." }, 409);
    }
    return json({ ok: false, error: "STAFF_INVITE_ACCEPT_FAILED" }, 500);
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
