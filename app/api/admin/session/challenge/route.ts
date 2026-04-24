import "server-only";

import { createHash, randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { assertWriteOrigin, readVerifiedSession, requireUser } from "@/lib/apiAuth";
import { resolveAdminNextPath } from "@/lib/admin/access";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { getAuthPool, createAuthTokenRecord } from "@/lib/authDb";
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

type AdminStepUpStaffRow = {
  id: string;
  userId: string;
  staffCode: string;
  systemRole: string;
  positionTitle: string;
  status: string;
  scopes: string[] | null;
  userEmail: string;
};

function maskStaffCode(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D+/g, "").slice(-4);
  return digits ? `•••• ${digits.padStart(4, "0")}` : "••••";
}

async function readAdminStepUpStaffFromDb(
  queryable: { query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  userId: string,
) {
  const result = await queryable.query<AdminStepUpStaffRow>(
    `SELECT
       staff."id",
       staff."userId",
       staff."staffCode",
       staff."systemRole",
       staff."positionTitle",
       staff."status",
       staff."scopes",
       user_row."email" AS "userEmail"
     FROM "StaffProfile" staff
     INNER JOIN "User" user_row ON user_row."id" = staff."userId"
     WHERE staff."userId" = $1
     LIMIT 1`,
    [userId],
  );

  return result.rows[0] ?? null;
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function newChallengeId() {
  return `cb_admin_${createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 32)}`;
}

function newEmailCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
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
  next?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    assertWriteOrigin(req);

    const session = await readVerifiedSession(req);
    if (!session) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
    requireUser(session);

    const authPool = getAuthPool();
    const authClient = await authPool.connect();
    try {
      const staff = await readAdminStepUpStaffFromDb(authClient, session.sub);
      if (!staff || staff.status !== "ACTIVE") {
        return json({ ok: false, error: "STAFF_NOT_ACTIVE" }, 403);
      }

      const ip = pickClientIp(req);
      const limitKey = `admin:challenge:${staff.userId}:${ip}`;
      const limit = consumeInMemoryRateLimit({
        key: limitKey,
        limit: 5,
        windowMs: 10 * 60_000,
      });
      if (!limit.allowed) {
        return json({ ok: false, error: "RATE_LIMITED", retryAfterSec: limit.retryAfterSec }, 429);
      }

      const body = (await readSanitizedJson(req, {} as Body)) as Body;
      const nextPath = resolveAdminNextPath(staff, String(body?.next || "").trim() || "/");

      const challengeId = newChallengeId();
      const code = newEmailCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await createAuthTokenRecord(authClient, {
        userId: staff.userId,
        type: "EMAIL_RECOVERY",
        tokenHash: sha256Hex(challengeId),
        expiresAt,
        metaJson: {
          purpose: "admin_step_up",
          codeHash: sha256Hex(code),
          staffId: staff.id,
          staffCode: staff.staffCode,
          nextPath,
        },
      });

      const [{ sendEmail }, { writeAdminAuditLog }] = await Promise.all([
        import("@/lib/email/sendEmail"),
        import("@/lib/admin/audit"),
      ]);
      await sendEmail({
        to: staff.userEmail,
        subject: "Your Caverify access code",
        html: `
          <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
            <h2 style="margin:0 0 10px;">Caverify access</h2>
            <p style="margin:0 0 14px;">
              Use this code to finish your protected admin sign-in.
            </p>
            <div style="margin:16px 0; padding:14px 16px; border-radius:14px; background:#0b1020; border:1px solid rgba(255,255,255,0.14); display:inline-block;">
              <div style="font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:rgba(234,240,255,0.62); margin-bottom:8px;">
                Caverify access code
              </div>
              <div style="font-size:26px; font-weight:900; letter-spacing:.16em; color:#eaf0ff;">
                ${code}
              </div>
            </div>
            <p style="margin:14px 0 0; font-size:12px; color:rgba(234,240,255,0.65);">
              This code expires in 10 minutes.
            </p>
          </div>
        `,
      });

      await writeAdminAuditLog({
        actorStaffId: staff.id,
        actorUserId: staff.userId,
        action: "STAFF_ADMIN_STEP_UP_SENT",
        actionLabel: "Admin step-up code sent",
        entityType: "staff_profile",
        entityId: staff.id,
        entityLabel: maskStaffCode(staff.staffCode),
        request: req,
        metaJson: {
          nextPath,
          email: staff.userEmail,
        },
      }).catch((auditError) => {
        console.error("[admin/session/challenge] audit log failed", auditError);
      });

      return json({
        ok: true,
        challengeId,
        expiresAt: expiresAt.toISOString(),
        maskedEmail: staff.userEmail.replace(/(^.).*(@.*$)/, "$1•••$2"),
      });
    } finally {
      authClient.release();
    }
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
    }
    console.error("[admin/session/challenge] failed", error);
    return json({ ok: false, error: "ADMIN_CHALLENGE_FAILED" }, 500);
  }
}
