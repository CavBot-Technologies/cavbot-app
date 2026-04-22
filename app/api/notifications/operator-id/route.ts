import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { formatAdminDepartmentLabel, resolveAdminDepartment } from "@/lib/admin/access";
import { requireSession, requireUser, isApiAuthError } from "@/lib/apiAuth";
import { HQ_NOTIFICATION_KINDS } from "@/lib/notificationKinds";
import { prisma } from "@/lib/prisma";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

function s(value: unknown) {
  return String(value ?? "").trim();
}

function readMetaObject(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req);
    requireUser(session);

    const notificationId = s(new URL(req.url).searchParams.get("notificationId"));
    if (!notificationId) {
      return json({ ok: false, error: "BAD_NOTIFICATION_ID" }, 400);
    }

    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId: s(session.sub),
        kind: HQ_NOTIFICATION_KINDS.OPERATOR_ID_READY,
      },
      select: {
        id: true,
        metaJson: true,
      },
    });

    if (!notification?.id) {
      return json({ ok: false, error: "NOTIFICATION_NOT_FOUND" }, 404);
    }

    const staffProfile = await prisma.staffProfile.findUnique({
      where: { userId: s(session.sub) },
      select: {
        id: true,
        staffCode: true,
        positionTitle: true,
        status: true,
        onboardingStatus: true,
        scopes: true,
        user: {
          select: {
            fullName: true,
            displayName: true,
            email: true,
          },
        },
      },
    });

    if (!staffProfile?.id || !staffProfile.staffCode) {
      return json({ ok: false, error: "STAFF_PROFILE_NOT_FOUND" }, 404);
    }

    const meta = readMetaObject(notification.metaJson);
    const department = resolveAdminDepartment({
      scopes: staffProfile.scopes,
      systemRole: null,
    });
    const displayName = s(staffProfile.user.fullName) || s(staffProfile.user.displayName) || s(staffProfile.user.email);

    return json({
      ok: true,
      card: {
        name: displayName || "CavBot staff",
        department: formatAdminDepartmentLabel(department),
        positionTitle: s(meta.positionTitle) || s(staffProfile.positionTitle) || "Staff",
        staffCode: staffProfile.staffCode,
      },
    });
  } catch (error) {
    if (isApiAuthError(error)) {
      const guardPayload = buildGuardDecisionPayload({
        actionId: "AUTH_REQUIRED",
      });
      return json({ ok: false, error: error.code, ...(guardPayload || {}) }, error.status);
    }
    return json({ ok: false, error: "STAFF_ID_REVEAL_FAILED" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" } });
}
