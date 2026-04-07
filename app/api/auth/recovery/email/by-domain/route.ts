// app/api/auth/recovery/email/by-domain/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mintResetToken, hashToken, safeOkResponse } from "@/lib/auth/passwordReset";
import { sendEmail } from "@/lib/email/sendEmail";
import { AuthTokenType } from "@prisma/client";
import { assertWriteOrigin, getAppOrigin } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  buildVerifyErrorPayload,
  ensureActionVerification,
  extractVerifyGrantToken,
  extractVerifySessionId,
  recordVerifyActionSuccess,
} from "@/lib/auth/cavbotVerify";

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

/**
 * Normalize domain input:
 * - allows "cavbot.io" or "https://cavbot.io"
 * - strips scheme, path, and www.
 */
function normalizeDomain(input: string) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";

  const cleaned = raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .trim();

  // basic hard validation (no spaces, must contain dot, no @)
  if (!cleaned || cleaned.includes(" ") || cleaned.includes("@") || !cleaned.includes(".")) return "";
  if (cleaned.length > 253) return "";

  return cleaned;
}

function hostFromOrigin(origin: string) {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function domainMatches(host: string, domain: string) {
  if (!host || !domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);
    const body = (await readSanitizedJson(req, ({}))) as Record<string, unknown>;

    const verificationGate = ensureActionVerification(req, {
      actionType: "reset",
      route: "/users/recovery?mode=email",
      sessionIdHint: extractVerifySessionId(req, body?.verificationSessionId ?? body?.verifySessionId),
      verificationGrantToken: extractVerifyGrantToken(req, body?.verificationGrantToken),
    });
    if (!verificationGate.ok) {
      return NextResponse.json(buildVerifyErrorPayload(verificationGate), {
        status: verificationGate.decision === "block" ? 429 : 403,
        headers: noStore(),
      });
    }

    const domain = normalizeDomain(String(body?.domain || ""));

    // Always ok (prevents enumeration)
    if (!domain) {
      return NextResponse.json(safeOkResponse(), { headers: noStore() });
    }

    // ------------------------------------------------------------
    // STEP 1: Find matching Site by domain (DO NOT rely on rootDomain)
    // ------------------------------------------------------------
    const candidates = await prisma.site.findMany({
      where: {
        isActive: true,
        origin: { contains: domain, mode: "insensitive" },
      },
      select: {
        id: true,
        origin: true,
        projectId: true,
        createdAt: true,
      },
      take: 50,
    });

    const matches = candidates
      .map((s) => ({ ...s, host: hostFromOrigin(s.origin) }))
      .filter((s) => domainMatches(s.host, domain))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (!matches.length) {
      recordVerifyActionSuccess(req, { actionType: "reset", sessionIdHint: verificationGate.sessionId });
      return NextResponse.json(safeOkResponse(), { headers: noStore() });
    }

    const projectId = matches[0].projectId;

    // ------------------------------------------------------------
    // STEP 2: Resolve accountId from Project
    // ------------------------------------------------------------
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { accountId: true, isActive: true },
    });

    if (!project?.accountId || !project.isActive) {
      recordVerifyActionSuccess(req, { actionType: "reset", sessionIdHint: verificationGate.sessionId });
      return NextResponse.json(safeOkResponse(), { headers: noStore() });
    }

    const accountId = project.accountId;

    // ------------------------------------------------------------
    // STEP 3: Find OWNER -> ADMIN -> fallback member
    // ------------------------------------------------------------
    const membership =
      (await prisma.membership.findFirst({
        where: { accountId, role: "OWNER" },
        select: { user: { select: { id: true, email: true } } },
      })) ||
      (await prisma.membership.findFirst({
        where: { accountId, role: "ADMIN" },
        select: { user: { select: { id: true, email: true } } },
      })) ||
      (await prisma.membership.findFirst({
        where: { accountId },
        select: { user: { select: { id: true, email: true } } },
      }));

    const userId = membership?.user?.id || "";
    const recipient = membership?.user?.email || "";

    if (!userId || !recipient) {
      recordVerifyActionSuccess(req, { actionType: "reset", sessionIdHint: verificationGate.sessionId });
      return NextResponse.json(safeOkResponse(), { headers: noStore() });
    }

    // ------------------------------------------------------------
    // STEP 4: Mint token + store AuthToken
    // ------------------------------------------------------------
    const token = mintResetToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await prisma.authToken.create({
      data: {
        userId,
        tokenHash,
        type: AuthTokenType.EMAIL_RECOVERY,
        expiresAt,
      },
    });

    // ------------------------------------------------------------
    // STEP 5: Send email
    // ------------------------------------------------------------
    const confirmLink = `${appUrl()}/users/recovery/email?token=${encodeURIComponent(token)}`;

    await sendEmail({
      to: recipient,
      subject: "CavBot account recovery — confirm your login email",
      html: `
        <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
          <h2 style="margin:0 0 10px;">Account recovery requested</h2>
          <p style="margin:0 0 14px;">
            A request was made to recover the login email for a CavBot workspace tied to <b>${domain}</b>.
            If this was you, confirm below to view the email used for login.
          </p>

          <p style="margin:16px 0;">
            <a href="${confirmLink}"
              style="display:inline-block; padding:12px 16px; border-radius:12px;
              background:#4ea8ff; color:#0b1020; text-decoration:none; font-weight:700;">
              Confirm login email
            </a>
          </p>

          <p style="margin:14px 0 0; font-size:12px; color:#6b7280;">
            This link expires in 30 minutes and can only be used once.
          </p>
        </div>
      `,
    });

    recordVerifyActionSuccess(req, { actionType: "reset", sessionIdHint: verificationGate.sessionId });
    return NextResponse.json(safeOkResponse(), { headers: noStore() });
  } catch {
    // Still ok (prevents leakage)
    return NextResponse.json(safeOkResponse(), { headers: noStore() });
  }
}
