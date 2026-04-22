import "server-only";

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { prisma } from "@/lib/prisma";
import { createOperatorIdReadyNotification } from "@/lib/admin/operatorOnboarding.server";
import { ensureAdminOwnerBootstrap } from "@/lib/admin/staff";
import { readSanitizedJson } from "@/lib/security/userInput";
import { sendEmail } from "@/lib/email/sendEmail";
import { recordAdminEventSafe } from "@/lib/admin/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

function json<T>(payload: T) {
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

function safeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
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

function maskStaffCode(value: string) {
  return `•••• ${String(value || "").slice(-4)}`;
}

type Body = { email?: unknown };

const APP_ORIGIN = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://app.cavbot.io").trim() || "https://app.cavbot.io";

export async function POST(req: NextRequest) {
  await ensureAdminOwnerBootstrap();
  const body = (await readSanitizedJson(req, {} as Body)) as Body;
  const email = safeEmail(body?.email);
  const ip = pickClientIp(req);

  const rate = consumeInMemoryRateLimit({
    key: `admin:forgot-staff-id:${createHash("sha256").update(`${email}:${ip}`).digest("hex")}`,
    limit: 5,
    windowMs: 15 * 60_000,
  });

  if (!rate.allowed) {
    return json({ ok: true });
  }

  if (!email) return json({ ok: true });

  const staff = await prisma.staffProfile.findFirst({
    where: {
      invitedEmail: email,
    },
    include: {
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  const resolvedStaff = staff || await prisma.staffProfile.findFirst({
    where: {
      user: {
        email,
      },
    },
    include: {
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  if (resolvedStaff?.user?.email || resolvedStaff?.invitedEmail) {
    const recipient = resolvedStaff.user?.email || resolvedStaff.invitedEmail || email;
    await createOperatorIdReadyNotification({
      userId: resolvedStaff.userId,
      staffId: resolvedStaff.id,
      staffCode: resolvedStaff.staffCode,
      title: "Your staff ID is ready in CavBot",
      body: "Sign in to CavBot and open notifications to view your staff ID securely.",
    });

    await sendEmail({
      to: recipient,
      subject: "CavBot HQ secure staff access notice",
      html: `
        <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
          <h2 style="margin:0 0 10px;">CavBot HQ secure recovery</h2>
          <p style="margin:0 0 14px;">We received a request to recover your CavBot HQ staff access.</p>
          <p style="margin:0 0 14px;">For security, staff IDs are no longer sent by email.</p>
          <p style="margin:0 0 14px;">
            Sign in to CavBot and open Notifications to view your staff ID securely:
            <a href="${APP_ORIGIN}" style="color:#4ea8ff;">${APP_ORIGIN}</a>
          </p>
          <p style="margin:14px 0 0; font-size:12px; color:rgba(234,240,255,0.65);">
            If you didn’t request this, you can ignore this email.
          </p>
        </div>
      `,
    });

    await recordAdminEventSafe({
      name: "staff_id_recovery_requested",
      subjectUserId: resolvedStaff.userId,
      actorUserId: resolvedStaff.userId,
      result: "sent",
      metaJson: {
        staffId: resolvedStaff.id,
        staffCode: maskStaffCode(resolvedStaff.staffCode),
      },
    });
  }

  return json({ ok: true });
}
