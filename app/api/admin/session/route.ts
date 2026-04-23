import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { assertWriteOrigin, getSession, requireUser } from "@/lib/apiAuth";
import { resolveAdminDepartment } from "@/lib/admin/access";
import { clearAdminSessionCookie, getAdminSession } from "@/lib/admin/session";
import { ensureStaffProfileForUser, getStaffProfileByUserId, maskStaffCode } from "@/lib/admin/staff";
import { findUserById, getAuthPool } from "@/lib/authDb";
import { writeAdminAuditLog } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return json({ ok: true, authenticated: false, adminAuthenticated: false });
  }
  requireUser(session);

  const user = await findUserById(getAuthPool(), session.sub);

  const [adminSession, staff] = await Promise.all([
    getAdminSession(req),
    ensureStaffProfileForUser(session.sub, user?.email || null),
  ]);

  return json({
    ok: true,
    authenticated: true,
    adminAuthenticated: Boolean(adminSession && staff && staff.id === adminSession.staffId),
    staffEligible: Boolean(staff && staff.status === "ACTIVE"),
    staff: staff
      ? {
          id: staff.id,
          userId: staff.userId,
          email: staff.user.email,
          displayName: staff.user.displayName || staff.user.fullName || staff.user.email || maskStaffCode(staff.staffCode),
          avatarImage: staff.user.avatarImage || null,
          staffCode: maskStaffCode(staff.staffCode),
          department: resolveAdminDepartment(staff),
          systemRole: staff.systemRole,
          positionTitle: staff.positionTitle,
          status: staff.status,
          lastAdminLoginAt: staff.lastAdminLoginAt?.toISOString() || null,
        }
      : null,
  });
}

export async function DELETE(req: NextRequest) {
  try {
    assertWriteOrigin(req);
    const session = await getSession(req);
    const response = json({ ok: true });
    clearAdminSessionCookie(response);

    if (session && session.systemRole === "user") {
      const staff = await getStaffProfileByUserId(session.sub);
      if (staff) {
        await writeAdminAuditLog({
          actorStaffId: staff.id,
          actorUserId: staff.userId,
          action: "STAFF_SIGNED_OUT",
          actionLabel: "Staff admin session cleared",
          entityType: "staff_profile",
          entityId: staff.id,
          entityLabel: maskStaffCode(staff.staffCode),
          request: req,
        });
      }
    }

    return response;
  } catch {
    return json({ ok: false, error: "ADMIN_SIGN_OUT_FAILED" }, 500);
  }
}
