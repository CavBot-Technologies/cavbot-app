import "server-only";

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { assertWriteOrigin, getSession, requireUser } from "@/lib/apiAuth";
import { getAuthPool, findAuthTokenByHash, markAuthTokenUsed } from "@/lib/authDb";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { readSanitizedJson } from "@/lib/security/userInput";

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

type AdminVerifyStaffRow = {
  id: string;
  userId: string;
  staffCode: string;
  systemRole: string;
  positionTitle: string;
  status: string;
  scopes: string[] | null;
};

function maskStaffCode(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D+/g, "").slice(-4);
  return digits ? `•••• ${digits.padStart(4, "0")}` : "••••";
}

function normalizeAdminSessionRole(value: string) {
  const role = String(value || "").trim().toUpperCase();
  if (role === "OWNER" || role === "ADMIN" || role === "READ_ONLY") return role;
  return "MEMBER";
}

async function readAdminVerifyStaff(userId: string) {
  const result = await getAuthPool().query<AdminVerifyStaffRow>(
    `SELECT
       staff."id",
       staff."userId",
       staff."staffCode",
       staff."systemRole",
       staff."positionTitle",
       staff."status",
       staff."scopes"
     FROM "StaffProfile" staff
     WHERE staff."userId" = $1
     LIMIT 1`,
    [userId],
  );

  return result.rows[0] ?? null;
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function pickClientIp(req: Request) {
  return String(
    req.headers.get("cf-connecting-ip")
    || req.headers.get("true-client-ip")
    || req.headers.get("x-forwarded-for")
    || req.headers.get("x-real-ip")
    || "",
  ).split(",")[0].trim();
}

type Body = {
  challengeId?: unknown;
  code?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    assertWriteOrigin(req);

    const session = await getSession(req);
    if (!session) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
    requireUser(session);

    const authPool = getAuthPool();
    const staff = await readAdminVerifyStaff(session.sub);
    if (!staff || staff.status !== "ACTIVE") {
      return json({ ok: false, error: "STAFF_NOT_ACTIVE" }, 403);
    }

    const ip = pickClientIp(req);
    const limitKey = `admin:verify:${staff.userId}:${ip}`;
    const limit = consumeInMemoryRateLimit({
      key: limitKey,
      limit: 10,
      windowMs: 10 * 60_000,
    });
    if (!limit.allowed) {
      return json({ ok: false, error: "RATE_LIMITED", retryAfterSec: limit.retryAfterSec }, 429);
    }

    const body = (await readSanitizedJson(req, {} as Body)) as Body;
    const challengeId = String(body?.challengeId || "").trim();
    const code = String(body?.code || "").trim();
    if (!challengeId || !/^\d{6}$/.test(code)) {
      return json({ ok: false, error: "BAD_INPUT" }, 400);
    }

    const token = await findAuthTokenByHash(authPool, sha256Hex(challengeId));
    if (!token || token.type !== "EMAIL_RECOVERY") {
      return json({ ok: false, error: "CHALLENGE_NOT_FOUND" }, 404);
    }
    if (token.userId !== staff.userId) {
      return json({ ok: false, error: "CHALLENGE_SCOPE_MISMATCH" }, 403);
    }
    if (token.usedAt) {
      return json({ ok: false, error: "CHALLENGE_USED" }, 409);
    }
    if (token.expiresAt.getTime() <= Date.now()) {
      return json({ ok: false, error: "CHALLENGE_EXPIRED" }, 410);
    }

    const meta = (token.metaJson || {}) as Record<string, unknown>;
    if (String(meta.purpose || "").trim() !== "admin_step_up") {
      return json({ ok: false, error: "BAD_CHALLENGE" }, 400);
    }
    if (String(meta.staffId || "").trim() !== staff.id) {
      return json({ ok: false, error: "CHALLENGE_SCOPE_MISMATCH" }, 403);
    }

    const expectedHash = String(meta.codeHash || "").trim();
    if (!expectedHash || expectedHash !== sha256Hex(code)) {
      return json({ ok: false, error: "INVALID_CODE" }, 403);
    }

    const [{ createAdminSessionToken, adminSessionCookieOptions }, { resolveAdminNextPath }] = await Promise.all([
      import("@/lib/admin/session"),
      import("@/lib/admin/access"),
    ]);
    const adminToken = await createAdminSessionToken({
      userId: staff.userId,
      staffId: staff.id,
      staffCode: staff.staffCode,
      role: normalizeAdminSessionRole(staff.systemRole),
      stepUpMethod: "email",
    });
    const nextPath = resolveAdminNextPath(staff, String(meta.nextPath || "/"));

    const loginAt = new Date();
    await markAuthTokenUsed(authPool, token.id);
    const [{ prisma }, { writeAdminAuditLog }] = await Promise.all([
      import("@/lib/prisma"),
      import("@/lib/admin/audit"),
    ]);
    await prisma.staffProfile.update({
      where: { id: staff.id },
      data: {
        lastAdminLoginAt: loginAt,
        lastAdminStepUpAt: loginAt,
        onboardingStatus: "COMPLETED",
      },
    }).catch((updateError) => {
      console.error("[admin/session/verify] staff profile login update failed", updateError);
    });
    await writeAdminAuditLog({
      actorStaffId: staff.id,
      actorUserId: staff.userId,
      action: "STAFF_SIGNED_IN",
      actionLabel: "Staff admin sign-in completed",
      entityType: "staff_profile",
      entityId: staff.id,
      entityLabel: maskStaffCode(staff.staffCode),
      request: req,
      metaJson: {
        nextPath,
      },
    }).catch((auditError) => {
      console.error("[admin/session/verify] audit log failed", auditError);
    });

    const response = json({
      ok: true,
      nextPath,
      staff: {
        id: staff.id,
        staffCode: maskStaffCode(staff.staffCode),
        systemRole: staff.systemRole,
        positionTitle: staff.positionTitle,
      },
    });

    const { name, ...cookieOptions } = adminSessionCookieOptions(req);
    response.cookies.set(name, adminToken, cookieOptions);
    return response;
  } catch (error) {
    console.error("[admin/session/verify] failed", error);
    return json({ ok: false, error: "ADMIN_VERIFY_FAILED" }, 500);
  }
}
