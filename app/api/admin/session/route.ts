import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { assertWriteOrigin, readVerifiedSession, requireUser } from "@/lib/apiAuth";
import { resolveAdminDepartment } from "@/lib/admin/access";
import { clearAdminSessionCookie, getAdminSession } from "@/lib/admin/session";
import { getAuthPool } from "@/lib/authDb";

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

type AdminSessionStaffRow = {
  id: string;
  userId: string;
  staffCode: string;
  systemRole: string;
  positionTitle: string;
  status: string;
  scopes: string[] | null;
  lastAdminLoginAt: Date | string | null;
  userEmail: string;
  userDisplayName: string | null;
  userFullName: string | null;
  userAvatarImage: string | null;
};

function maskStaffCode(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D+/g, "").slice(-4);
  return digits ? `•••• ${digits.padStart(4, "0")}` : "••••";
}

async function readAdminSessionStaff(userId: string) {
  const result = await getAuthPool().query<AdminSessionStaffRow>(
    `SELECT
       staff."id",
       staff."userId",
       staff."staffCode",
       staff."systemRole",
       staff."positionTitle",
       staff."status",
       staff."scopes",
       staff."lastAdminLoginAt",
       user_row."email" AS "userEmail",
       user_row."displayName" AS "userDisplayName",
       user_row."fullName" AS "userFullName",
       user_row."avatarImage" AS "userAvatarImage"
     FROM "StaffProfile" staff
     INNER JOIN "User" user_row ON user_row."id" = staff."userId"
     WHERE staff."userId" = $1
     LIMIT 1`,
    [userId],
  );

  return result.rows[0] ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await readVerifiedSession(req);
    if (!session) {
      return json({ ok: true, authenticated: false, adminAuthenticated: false });
    }
    requireUser(session);

    const [adminSession, staff] = await Promise.all([
      getAdminSession(req).catch((error) => {
        console.error("[admin/session] getAdminSession failed", error);
        return null;
      }),
      readAdminSessionStaff(session.sub).catch((error) => {
        console.error("[admin/session] readAdminSessionStaff failed", error);
        return null;
      }),
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
            email: staff.userEmail,
            displayName: staff.userDisplayName || staff.userFullName || staff.userEmail || maskStaffCode(staff.staffCode),
            avatarImage: staff.userAvatarImage || null,
            staffCode: maskStaffCode(staff.staffCode),
            department: resolveAdminDepartment(staff),
            systemRole: staff.systemRole,
            positionTitle: staff.positionTitle,
            status: staff.status,
            lastAdminLoginAt: staff.lastAdminLoginAt ? new Date(staff.lastAdminLoginAt).toISOString() : null,
          }
        : null,
    });
  } catch (error) {
    console.error("[admin/session] failed", error);
    return json({ ok: true, authenticated: false, adminAuthenticated: false });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    assertWriteOrigin(req);
    const session = await readVerifiedSession(req);
    const response = json({ ok: true });
    clearAdminSessionCookie(response);

    if (session && session.systemRole === "user") {
      const staff = await readAdminSessionStaff(session.sub);
      if (staff) {
        const { writeAdminAuditLog } = await import("@/lib/admin/audit");
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
