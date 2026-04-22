import "server-only";

import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { assertWriteOrigin, ApiAuthError } from "@/lib/apiAuth";
import { buildOperatorInviteMeta, createOperatorOfferNotification } from "@/lib/admin/operatorOnboarding.server";
import { formatAdminDepartmentLabel, normalizeAdminDepartment } from "@/lib/admin/access";
import { writeAdminAuditLog } from "@/lib/admin/audit";
import { buildAdminUrl } from "@/lib/admin/config";
import { recordAdminEventSafe } from "@/lib/admin/events";
import { requireAdminAccess } from "@/lib/admin/staff";
import { sendEmail } from "@/lib/email/sendEmail";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";
import { normalizeUsername } from "@/lib/username";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type Body = {
  identifier?: unknown;
  department?: unknown;
  email?: unknown;
  positionTitle?: unknown;
  message?: unknown;
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

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function safeTitle(value: unknown) {
  const title = String(value || "").trim();
  return title || "Operator";
}

export async function POST(req: NextRequest) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireAdminAccess(req, { scopes: ["staff.write"] });
    const body = (await readSanitizedJson(req, {} as Body)) as Body;

    const rawIdentifier = String(body.identifier ?? body.email ?? "").trim();
    const email = rawIdentifier.includes("@") ? normalizeEmail(rawIdentifier) : "";
    const username = email ? "" : normalizeUsername(rawIdentifier);
    const department = normalizeAdminDepartment(body.department);
    const positionTitle = safeTitle(body.positionTitle);
    const message = String(body.message || "").trim() || null;

    if (!email && !username) {
      return json({ ok: false, error: "BAD_IDENTIFIER" }, 400);
    }

    const existingUser = email
      ? await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, username: true, displayName: true },
        })
      : await prisma.user.findUnique({
          where: { username },
          select: { id: true, email: true, username: true, displayName: true },
        });

    if (username && !existingUser) {
      return json({ ok: false, error: "USER_NOT_FOUND", message: "User not found." }, 404);
    }

    const targetEmail = existingUser?.email || email;

    if (!targetEmail || !targetEmail.includes("@")) {
      return json({ ok: false, error: "BAD_IDENTIFIER" }, 400);
    }

    const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const invite = await prisma.staffInvite.create({
      data: {
        email: targetEmail,
        normalizedEmail: targetEmail,
        tokenHash,
        systemRole: "MEMBER",
        positionTitle,
        status: "PENDING",
        invitedByUserId: ctx.userSession.sub,
        invitedByStaffCode: ctx.staff.staffCode,
        inviteeUserId: existingUser?.id || null,
        acceptedStaffId: null,
        acceptedAt: null,
        expiresAt,
        message,
        metaJson: existingUser
          ? {
              department,
              onboardingFlow: "notification",
              notificationAcceptRequired: true,
            }
          : {
              department,
            },
      },
    });

    if (existingUser) {
      const notificationId = await createOperatorOfferNotification({
        userId: existingUser.id,
        inviteId: invite.id,
        department,
        positionTitle,
        expiresAt,
        message,
      });

      await prisma.staffInvite.update({
        where: { id: invite.id },
        data: {
          metaJson: buildOperatorInviteMeta({
            inviteId: invite.id,
            department,
            positionTitle,
            expiresAt,
            message,
            notificationId,
          }),
        },
      });
    } else {
      await sendEmail({
        to: targetEmail,
        subject: "You have been invited to CavBot HQ",
        html: `
          <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
            <h2 style="margin:0 0 10px;">CavBot HQ operator access</h2>
            <p style="margin:0 0 14px;">
              You have been invited to CavBot HQ. Sign in with this email using your existing CavBot account, or create that account first if it does not exist yet.
            </p>
            <p style="margin:0 0 14px;">Department: <strong>${formatAdminDepartmentLabel(department)}</strong></p>
            <p style="margin:0 0 14px;">Position: <strong>${positionTitle}</strong></p>
            ${message ? `<p style="margin:0 0 14px;">Message: ${message}</p>` : ""}
            <p style="margin:0 0 14px;">
              Sign in: <a href="${buildAdminUrl("/sign-in")}" style="color:#4ea8ff;">${buildAdminUrl("/sign-in")}</a>
            </p>
            <p style="margin:14px 0 0; font-size:12px; color:rgba(234,240,255,0.65);">
              Your operator offer stays active for 14 days. After onboarding, the staff ID will be available securely inside CavBot notifications.
            </p>
          </div>
        `,
      });
    }

    await Promise.all([
      recordAdminEventSafe({
        name: "staff_invited",
        actorStaffId: ctx.staff.id,
        actorUserId: ctx.userSession.sub,
        subjectUserId: existingUser?.id || null,
        result: existingUser ? "notification_pending" : "pending",
        metaJson: {
          inviteId: invite.id,
          department,
          positionTitle,
          email: targetEmail,
          identifier: rawIdentifier,
          identifierType: email ? "email" : "username",
        },
      }),
      writeAdminAuditLog({
        actorStaffId: ctx.staff.id,
        actorUserId: ctx.userSession.sub,
        action: "STAFF_INVITED",
        actionLabel: "Operator access invited",
        entityType: "staff_invite",
        entityId: invite.id,
        entityLabel: targetEmail,
        request: req,
        metaJson: {
          email: targetEmail,
          identifier: rawIdentifier,
          identifierType: email ? "email" : "username",
          department,
          positionTitle,
          delivery: existingUser ? "notification" : "email",
        },
      }),
    ]);

    return json({
      ok: true,
      inviteId: invite.id,
      email: targetEmail,
      status: invite.status,
      delivery: existingUser ? "notification" : "email",
      staffCode: null,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: "STAFF_INVITE_FAILED" }, 500);
  }
}
