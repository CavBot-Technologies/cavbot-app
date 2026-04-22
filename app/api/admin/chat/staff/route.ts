import "server-only";

import { NextRequest } from "next/server";

import { ApiAuthError } from "@/lib/apiAuth";
import { adminJson, maskOpaqueId } from "@/lib/admin/api";
import { resolveAdminDepartment } from "@/lib/admin/access";
import { requireActiveStaffSession } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireActiveStaffSession(req, { scopes: ["messaging.read"] });
    const staff = await prisma.staffProfile.findMany({
      where: { status: "ACTIVE" },
      orderBy: [
        { positionTitle: "asc" },
        { createdAt: "asc" },
      ],
      select: {
        id: true,
        userId: true,
        positionTitle: true,
        systemRole: true,
        staffCode: true,
        scopes: true,
        user: {
          select: {
            email: true,
            username: true,
            displayName: true,
            fullName: true,
            avatarImage: true,
            avatarTone: true,
          },
        },
      },
    });

    return adminJson({
      ok: true,
      staff: staff.map((member) => ({
        id: member.id,
        userId: member.userId,
        name: member.user.displayName || member.user.fullName || member.user.username || member.user.email,
        email: member.user.email,
        username: member.user.username,
        avatarImage: member.user.avatarImage,
        avatarTone: member.user.avatarTone,
        positionTitle: member.positionTitle,
        department: resolveAdminDepartment(member),
        maskedStaffCode: maskOpaqueId(member.staffCode),
      })),
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({ ok: false, error: "CHAT_STAFF_DIRECTORY_FAILED" }, 500);
  }
}
