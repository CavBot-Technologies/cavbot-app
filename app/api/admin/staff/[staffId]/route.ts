import "server-only";

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { ApiAuthError, assertWriteOrigin } from "@/lib/apiAuth";
import { buildAdminDepartmentScopeSet, formatAdminDepartmentLabel, normalizeAdminDepartment, resolveAdminDepartment } from "@/lib/admin/access";
import { writeAdminAuditLog } from "@/lib/admin/audit";
import { buildAdminUrl } from "@/lib/admin/config";
import { createOperatorIdReadyNotification } from "@/lib/admin/operatorOnboarding.server";
import { requireAdminAccess } from "@/lib/admin/staff";
import {
  formatStaffLifecycleStateLabel,
  isProtectedStaffIdentity,
  isRevokedStaffStatus,
  normalizeStaffLifecycleState,
  patchStaffLifecycleMetadata,
  readStaffLifecycleState,
  readStaffSuspendedUntil,
} from "@/lib/admin/staffDisplay";
import { sendEmail } from "@/lib/email/sendEmail";
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

type PatchBody = {
  department?: unknown;
  positionTitle?: unknown;
  notes?: unknown;
  onboardingStatus?: unknown;
  lifecycleState?: unknown;
};

type ActionBody = {
  action?: unknown;
  durationDays?: unknown;
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

function normalizeOnboardingStatus(value: unknown) {
  const status = String(value || "").trim().toUpperCase();
  if (status === "READY" || status === "COMPLETED") return status;
  return "PENDING";
}

function normalizeDurationDays(value: unknown) {
  const days = Number(value);
  if (days === 7 || days === 14 || days === 30) return days;
  return null;
}

function maskStaffCode(value: string) {
  const suffix = String(value || "").slice(-4);
  return suffix ? `•••• ${suffix}` : "••••";
}

function getPositionTitle(value: unknown, fallback: string) {
  const title = String(value || "").trim();
  return title || fallback;
}

async function getExistingStaff(staffId: string) {
  return prisma.staffProfile.findUnique({
    where: { id: staffId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
        },
      },
    },
  });
}

function getEntityLabel(staffCode: string) {
  return maskStaffCode(staffCode);
}

function getTargetDisplayName(existing: Awaited<ReturnType<typeof getExistingStaff>>) {
  if (!existing) return "Operator";
  return existing.user.displayName || existing.user.username || existing.user.email || "Operator";
}

function assertManageableTarget(existing: NonNullable<Awaited<ReturnType<typeof getExistingStaff>>>) {
  const locked = isProtectedStaffIdentity({
    staffCode: existing.staffCode,
    systemRole: existing.systemRole,
    email: existing.user.email,
    username: existing.user.username,
    name: existing.user.displayName || existing.user.username || existing.user.email,
  });

  if (locked) {
    throw new ApiAuthError("STAFF_PROTECTED", 403);
  }
}

function assertMutableStaffRecord(existing: NonNullable<Awaited<ReturnType<typeof getExistingStaff>>>) {
  if (isRevokedStaffStatus(existing.status)) {
    throw new ApiAuthError("STAFF_REVOKED", 409);
  }
}

function serializeStaff(existing: {
  id: string;
  staffCode: string;
  status: string;
  onboardingStatus: string;
  positionTitle: string;
  scopes: string[];
  notes: string | null;
  metadataJson: Prisma.JsonValue | null;
}) {
  return {
    id: existing.id,
    staffCode: existing.staffCode,
    staffCodeMasked: getEntityLabel(existing.staffCode),
    status: existing.status,
    positionTitle: existing.positionTitle,
    department: resolveAdminDepartment(existing),
    notes: existing.notes,
    suspendedUntilISO: readStaffSuspendedUntil(existing.metadataJson)?.toISOString() || null,
    onboardingStatus: existing.onboardingStatus,
    lifecycleState: readStaffLifecycleState(existing.metadataJson),
  };
}

export async function PATCH(req: NextRequest, { params }: { params: { staffId: string } }) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireAdminAccess(req, { scopes: ["staff.write"] });
    const body = (await readSanitizedJson(req, {} as PatchBody)) as PatchBody;

    const existing = await getExistingStaff(params.staffId);
    if (!existing) return json({ ok: false, error: "STAFF_NOT_FOUND" }, 404);
    assertManageableTarget(existing);
    assertMutableStaffRecord(existing);

    const existingDepartment = resolveAdminDepartment(existing);
    const nextDepartment = body.department === undefined ? existingDepartment : normalizeAdminDepartment(body.department);
    const nextTitle = body.positionTitle === undefined ? existing.positionTitle : getPositionTitle(body.positionTitle, existing.positionTitle);
    const nextNotes = body.notes === undefined ? existing.notes : (String(body.notes || "").trim() || null);
    const nextOnboardingStatus =
      body.onboardingStatus === undefined ? existing.onboardingStatus : normalizeOnboardingStatus(body.onboardingStatus);
    const nextLifecycleState =
      body.lifecycleState === undefined ? readStaffLifecycleState(existing.metadataJson) : normalizeStaffLifecycleState(body.lifecycleState);
    const nextMetadata = patchStaffLifecycleMetadata(existing.metadataJson, {
      employmentState: nextLifecycleState === "ACTIVE" ? null : nextLifecycleState,
      lifecycleUpdatedAtISO: new Date().toISOString(),
      lifecycleUpdatedByStaffId: ctx.staff.id,
    });

    const updated = await prisma.staffProfile.update({
      where: { id: existing.id },
      data: {
        scopes: buildAdminDepartmentScopeSet(nextDepartment),
        positionTitle: nextTitle,
        notes: nextNotes,
        onboardingStatus: nextOnboardingStatus,
        metadataJson: nextMetadata ?? Prisma.JsonNull,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
          },
        },
      },
    });

    await writeAdminAuditLog({
      actorStaffId: ctx.staff.id,
      actorUserId: ctx.userSession.sub,
      action: "STAFF_PROFILE_UPDATED",
      actionLabel: "Operator profile updated",
      entityType: "staff_profile",
      entityId: updated.id,
      entityLabel: getEntityLabel(updated.staffCode),
      request: req,
      beforeJson: {
        department: existingDepartment,
        positionTitle: existing.positionTitle,
        notes: existing.notes,
        onboardingStatus: existing.onboardingStatus,
        lifecycleState: readStaffLifecycleState(existing.metadataJson),
      },
      afterJson: {
        department: nextDepartment,
        positionTitle: updated.positionTitle,
        notes: updated.notes,
        onboardingStatus: updated.onboardingStatus,
        lifecycleState: nextLifecycleState,
      },
    });

    return json({
      ok: true,
      staff: serializeStaff(updated),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: "STAFF_UPDATE_FAILED" }, 500);
  }
}

export async function POST(req: NextRequest, { params }: { params: { staffId: string } }) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireAdminAccess(req, { scopes: ["staff.write"] });
    const body = (await readSanitizedJson(req, {} as ActionBody)) as ActionBody;

    const existing = await getExistingStaff(params.staffId);
    if (!existing) return json({ ok: false, error: "STAFF_NOT_FOUND" }, 404);
    assertManageableTarget(existing);
    assertMutableStaffRecord(existing);

    const action = String(body.action || "").trim().toLowerCase();
    if (action === "send_access_reminder") {
      const department = resolveAdminDepartment(existing);
      const recipientEmail = existing.invitedEmail || existing.user.email;
      const reminderAt = new Date();

      if (!recipientEmail) {
        return json({ ok: false, error: "STAFF_CONTACT_MISSING" }, 400);
      }

      await Promise.all([
        sendEmail({
          to: recipientEmail,
          subject: "Your CavBot HQ access is ready",
          html: `
            <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
              <h2 style="margin:0 0 10px;">CavBot HQ access reminder</h2>
              <p style="margin:0 0 14px;">
                Your ${formatAdminDepartmentLabel(department)} staff access is active inside CavBot HQ.
              </p>
              <p style="margin:0 0 14px;">
                Position: <strong>${existing.positionTitle || "Operator"}</strong><br />
                Staff ID: <strong>${maskStaffCode(existing.staffCode)}</strong>
              </p>
              <p style="margin:0 0 14px;">
                Sign in securely here: <a href="${buildAdminUrl("/sign-in")}" style="color:#4ea8ff;">${buildAdminUrl("/sign-in")}</a>
              </p>
              <p style="margin:14px 0 0; font-size:12px; color:rgba(234,240,255,0.65);">
                CavBot HQ uses Caverify step-up verification for protected staff sign-in.
              </p>
            </div>
          `,
        }),
        createOperatorIdReadyNotification({
          userId: existing.userId,
          staffId: existing.id,
          staffCode: existing.staffCode,
          department,
          positionTitle: existing.positionTitle,
          title: "Your CavBot HQ access is ready",
          body: "Use your staff ID and Caverify to continue secure staff sign-in.",
        }),
      ]);

      const updated = await prisma.staffProfile.update({
        where: { id: existing.id },
        data: {
          metadataJson: patchStaffLifecycleMetadata(existing.metadataJson, {
            lastOnboardingReminderAtISO: reminderAt.toISOString(),
            lastOnboardingReminderByStaffId: ctx.staff.id,
          }) ?? Prisma.JsonNull,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              displayName: true,
            },
          },
        },
      });

      await writeAdminAuditLog({
        actorStaffId: ctx.staff.id,
        actorUserId: ctx.userSession.sub,
        action: "STAFF_ONBOARDING_REMINDER_SENT",
        actionLabel: "Operator onboarding reminder sent",
        entityType: "staff_profile",
        entityId: updated.id,
        entityLabel: getEntityLabel(updated.staffCode),
        request: req,
        beforeJson: {
          onboardingStatus: existing.onboardingStatus,
          lifecycleState: readStaffLifecycleState(existing.metadataJson),
        },
        afterJson: {
          onboardingStatus: updated.onboardingStatus,
          lifecycleState: readStaffLifecycleState(updated.metadataJson),
          lastOnboardingReminderAtISO: reminderAt.toISOString(),
        },
        metaJson: {
          remindedTeamMember: getTargetDisplayName(existing),
          recipientEmail,
        },
      });

      return json({
        ok: true,
        reminderSentAtISO: reminderAt.toISOString(),
        lifecycleStateLabel: formatStaffLifecycleStateLabel(readStaffLifecycleState(updated.metadataJson)),
        staff: serializeStaff(updated),
      });
    }

    if (action === "restore") {
      const updated = await prisma.staffProfile.update({
        where: { id: existing.id },
        data: {
          status: "ACTIVE",
          metadataJson: patchStaffLifecycleMetadata(existing.metadataJson, {
            suspendedUntilISO: null,
            suspendedAtISO: null,
            suspendedByStaffId: null,
            suspensionDays: null,
          }) ?? Prisma.JsonNull,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              displayName: true,
            },
          },
        },
      });

      await writeAdminAuditLog({
        actorStaffId: ctx.staff.id,
        actorUserId: ctx.userSession.sub,
        action: "STAFF_RESTORED",
        actionLabel: "Operator access restored",
        entityType: "staff_profile",
        entityId: updated.id,
        entityLabel: getEntityLabel(updated.staffCode),
        request: req,
        beforeJson: {
          status: existing.status,
          suspendedUntilISO: readStaffSuspendedUntil(existing.metadataJson)?.toISOString() || null,
        },
        afterJson: {
          status: updated.status,
          suspendedUntilISO: null,
        },
      });

      return json({
        ok: true,
        staff: serializeStaff(updated),
      });
    }

    if (action !== "suspend") {
      return json({ ok: false, error: "BAD_ACTION" }, 400);
    }

    const durationDays = normalizeDurationDays(body.durationDays);
    if (!durationDays) return json({ ok: false, error: "BAD_DURATION" }, 400);

    const now = new Date();
    const suspendedUntil = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const updated = await prisma.staffProfile.update({
      where: { id: existing.id },
      data: {
        status: "SUSPENDED",
        metadataJson: patchStaffLifecycleMetadata(existing.metadataJson, {
          suspendedUntilISO: suspendedUntil.toISOString(),
          suspendedAtISO: now.toISOString(),
          suspendedByStaffId: ctx.staff.id,
          suspensionDays: durationDays,
        }) ?? Prisma.JsonNull,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
          },
        },
      },
    });

    await writeAdminAuditLog({
      actorStaffId: ctx.staff.id,
      actorUserId: ctx.userSession.sub,
      action: "STAFF_SUSPENDED",
      actionLabel: "Operator access suspended",
      entityType: "staff_profile",
      entityId: updated.id,
      entityLabel: getEntityLabel(updated.staffCode),
      request: req,
      severity: "warning",
      beforeJson: {
        status: existing.status,
        suspendedUntilISO: readStaffSuspendedUntil(existing.metadataJson)?.toISOString() || null,
      },
      afterJson: {
        status: updated.status,
        suspendedUntilISO: suspendedUntil.toISOString(),
        suspensionDays: durationDays,
      },
      metaJson: {
        suspendedTeamMember: getTargetDisplayName(existing),
      },
    });

    return json({
      ok: true,
      staff: serializeStaff(updated),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: "STAFF_ACTION_FAILED" }, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { staffId: string } }) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireAdminAccess(req, { scopes: ["staff.write"] });

    const existing = await getExistingStaff(params.staffId);
    if (!existing) return json({ ok: false, error: "STAFF_NOT_FOUND" }, 404);
    assertManageableTarget(existing);

    await prisma.staffProfile.delete({
      where: { id: existing.id },
    });

    await writeAdminAuditLog({
      actorStaffId: ctx.staff.id,
      actorUserId: ctx.userSession.sub,
      action: "STAFF_REVOKED",
      actionLabel: "Operator access revoked",
      entityType: "staff_profile",
      entityId: existing.id,
      entityLabel: getEntityLabel(existing.staffCode),
      request: req,
      severity: "destructive",
      beforeJson: {
        staffCode: existing.staffCode,
        status: existing.status,
        department: resolveAdminDepartment(existing),
        systemRole: existing.systemRole,
        positionTitle: existing.positionTitle,
      },
      metaJson: {
        revokedTeamMember: getTargetDisplayName(existing),
        revokedUserId: existing.userId,
      },
    });

    return json({
      ok: true,
      revoked: {
        id: existing.id,
        userId: existing.userId,
        staffCode: existing.staffCode,
        staffCodeMasked: getEntityLabel(existing.staffCode),
      },
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: "STAFF_REVOKE_FAILED" }, 500);
  }
}
