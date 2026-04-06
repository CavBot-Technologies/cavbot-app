// app/api/auth/recovery/password/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mintResetToken, hashToken, safeOkResponse } from "@/lib/auth/passwordReset";
import { recordAdminEventSafe } from "@/lib/admin/events";
import { sendEmail } from "@/lib/email/sendEmail";
import { normalizeUsername } from "@/lib/username";
import { assertWriteOrigin, getAppOrigin } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  buildVerifyErrorPayload,
  ensureActionVerification,
  extractVerifyGrantToken,
  extractVerifySessionId,
  recordVerifyActionSuccess,
} from "@/lib/auth/cavbotVerify";
import { readCoarseRequestGeo } from "@/lib/requestGeo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore() {
  return {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function appUrl() {
  return getAppOrigin().replace(/\/+$/, "");
}

function emailDomainFromAddress(value: string | null | undefined) {
  const email = String(value || "").trim().toLowerCase();
  const parts = email.split("@");
  return parts.length === 2 ? parts[1] || "" : "";
}

export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);

    const body = (await readSanitizedJson(req, ({}))) as Record<string, unknown>;
    const verificationGate = ensureActionVerification(req, {
      actionType: "reset",
      route: "/users/recovery",
      sessionIdHint: extractVerifySessionId(req, body?.verificationSessionId ?? body?.verifySessionId),
      verificationGrantToken: extractVerifyGrantToken(req, body?.verificationGrantToken),
    });
    if (!verificationGate.ok) {
      return NextResponse.json(buildVerifyErrorPayload(verificationGate), {
        status: verificationGate.decision === "block" ? 429 : 403,
        headers: noStore(),
      });
    }

    const identifier = String(body?.email || body?.identifier || body?.username || "").trim();
    const email = identifier.includes("@") ? identifier : "";
    const username = !identifier.includes("@") ? normalizeUsername(identifier) : "";

    // Always return ok (prevents enumeration)
    if (!email && !username) {
      recordVerifyActionSuccess(req, { actionType: "reset", sessionIdHint: verificationGate.sessionId });
      return NextResponse.json(safeOkResponse(), { headers: noStore() });
    }

    // Find the user
    const user = email
      ? await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true },
      })
      : await prisma.user.findUnique({
        where: { username },
        select: { id: true, email: true },
      });

    // If user not found -> still ok
    if (!user) {
      recordVerifyActionSuccess(req, { actionType: "reset", sessionIdHint: verificationGate.sessionId });
      return NextResponse.json(safeOkResponse(), { headers: noStore() });
    }

    // Mint secure token + store hashed only
    const token = mintResetToken();
    const tokenHash = hashToken(token);
    const geo = readCoarseRequestGeo(req);

    // Expire in 30 minutes
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await prisma.authToken.create({
      data: {
        userId: user.id,
        tokenHash,
        type: "PASSWORD_RESET",
        expiresAt,
        metaJson: {
          purpose: "password_reset",
          identifierType: email ? "email" : "username",
          emailDomain: emailDomainFromAddress(user.email),
        },
      },
    });

    const resetLink = `${appUrl()}/users/reset?token=${encodeURIComponent(token)}`;

    // Security escalation mailto (pre-filled)
    const securityMailto =
      "mailto:security@cavbot.io" +
"?subject=Account%20Recovery%20%E2%80%94%20Unauthorized%20Reset%20Request" +
"&body=Hi%20CavBot%20Security%20Team%2C%0A%0AI%E2%80%99m%20reporting%20an%20unauthorized%20password%20reset%20request%20associated%20with%20my%20CavBot%20account.%20Please%20confirm%20whether%20this%20request%20originated%20from%20a%20recognized%20session%20and%20let%20me%20know%20if%20any%20security%20actions%20have%20been%20applied.%0A%0ASincerely%2C%0A%5BYour%20Name%5D";



    // CavBot-grade security email
    await sendEmail({
      to: user.email,
      subject: "Reset your CavBot password",
      html: `
        <div style="font-family: ui-sans-serif, system-ui; line-height: 1.6;">
          <h2 style="margin:0 0 10px;">Password reset requested</h2>
          <p style="margin:0 0 14px;">
            A password reset was requested for your CavBot account.
            If this was you, use the button below.
          </p>

          <p style="margin:16px 0;">
            <a href="${resetLink}"
               style="display:inline-block; padding:12px 16px; border-radius:12px;
                      background:#4ea8ff; color:#0b1020; text-decoration:none; font-weight:700;">
              Reset password
            </a>
          </p>

          <p style="margin:14px 0 0; font-size:12px; color:#6b7280;">
            This link expires in 30 minutes. For your security, this link can only be used once.
          </p>

          <p style="margin:16px 0 0; font-size:12px; line-height:1.6; color:#9aa3b2;">
            If you didn’t request this password reset, you can safely ignore this email — or contact
            <a
              href="${securityMailto}"
              style="color:#4ea8ff; text-decoration:none;"
            >Security</a>.
          </p>
        </div>
      `,
    });

    await recordAdminEventSafe({
      name: "auth_password_recovery_requested",
      subjectUserId: user.id,
      status: "requested",
      result: "matched",
      country: geo.country,
      region: geo.region,
      metaJson: {
        recoveryType: "password",
        identifierType: email ? "email" : "username",
        emailDomain: emailDomainFromAddress(user.email),
      },
    });

    recordVerifyActionSuccess(req, { actionType: "reset", sessionIdHint: verificationGate.sessionId });
    return NextResponse.json(safeOkResponse(), { headers: noStore() });
  } catch {
    // Still return ok (security + prevents system leakage)
    return NextResponse.json(safeOkResponse(), { headers: noStore() });
  }
}
