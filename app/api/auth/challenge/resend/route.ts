// app/api/auth/challenge/resend/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHash, randomInt } from "crypto";
import { sendEmail } from "@/lib/email/sendEmail";
import { assertWriteOrigin } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type AuthTokenMeta = {
  purpose?: string;
  lastSentAt?: string | number | null;
  accountId?: string | null;
  geoLabel?: string | null;
  [key: string]: unknown;
};

function json<T>(data: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, { ...resInit, headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS } });
}

function sha256Hex(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function newEmailCode() {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

function safeStr(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function readCloudflareGeo(req: NextRequest) {
  const countryRaw = safeStr(req.headers.get("cf-ipcountry")).trim();
  const country = countryRaw && countryRaw !== "XX" ? countryRaw : "";
  const region = safeStr(req.headers.get("cf-region")).trim() || safeStr(req.headers.get("cf-region-code")).trim();
  const label = [region, country].map((s) => String(s || "").trim()).filter(Boolean).join(", ");
  return { country: country || null, region: region || null, label: label || (country ? country : null) };
}

export async function POST(req: NextRequest) {
  try {
    assertWriteOrigin(req);

    const body = (await readSanitizedJson(req, null)) as null | {
      challengeId?: string;
      method?: string;
    };

    const challengeId = String(body?.challengeId || "").trim();
    const method = String(body?.method || "email").trim().toLowerCase();

    if (!challengeId) return json({ ok: false, error: "BAD_INPUT", message: "Missing challenge id." }, 400);
    if (method !== "email") return json({ ok: false, error: "METHOD_NOT_SUPPORTED", message: "Only email is supported." }, 400);

    const tokenHash = sha256Hex(challengeId);

    const row = await prisma.authToken.findFirst({
      where: { tokenHash, type: "EMAIL_RECOVERY" },
      select: { id: true, userId: true, metaJson: true, usedAt: true, expiresAt: true },
    });

    if (!row) return json({ ok: false, error: "CHALLENGE_NOT_FOUND", message: "Challenge not found." }, 404);
    if (row.usedAt) return json({ ok: false, error: "CHALLENGE_USED", message: "This challenge was already used." }, 409);

    const meta = (row.metaJson || {}) as AuthTokenMeta;
    if (String(meta.purpose || "") !== "2fa_email") {
      return json({ ok: false, error: "BAD_CHALLENGE", message: "Challenge is not valid for email 2FA." }, 400);
    }

    // simple resend throttle (30s)
    const lastSentAt = meta?.lastSentAt ? new Date(String(meta.lastSentAt)) : null;
    if (lastSentAt && Number.isFinite(+lastSentAt) && Date.now() - +lastSentAt < 30_000) {
      return json({ ok: false, error: "TOO_FAST", message: "Please wait a moment, then resend." }, 429);
    }

    const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { email: true } });
    if (!user?.email) return json({ ok: false, error: "USER_NOT_FOUND", message: "User not found." }, 404);

    const code = newEmailCode();
    const codeHash = sha256Hex(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const geo = readCloudflareGeo(req);

    await prisma.authToken.update({
      where: { id: row.id },
      data: {
        expiresAt,
        metaJson: {
          ...(meta || {}),
          codeHash,
          lastSentAt: new Date().toISOString(),
          geoLabel: meta?.geoLabel || geo.label || null,
        },
      },
    });

    await sendEmail({
      to: user.email,
      subject: "Your CavBot security code",
      html: `
        <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
          <h2 style="margin:0 0 10px;">Security verification</h2>
          <p style="margin:0 0 14px;">Enter the code below to complete your sign-in.</p>
          <div style="margin:16px 0; padding:14px 16px; border-radius:14px; background:#0b1020; border:1px solid rgba(255,255,255,0.14); display:inline-block;">
            <div style="font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:rgba(234,240,255,0.62); margin-bottom:8px;">CavBot code</div>
            <div style="font-size:26px; font-weight:900; letter-spacing:.16em; color:#eaf0ff;">${code}</div>
          </div>
          <p style="margin:14px 0 0; font-size:12px; color:rgba(234,240,255,0.65);">This code expires in 10 minutes.</p>
        </div>
      `,
    });

    const accountId = String(meta.accountId || "").trim();
    if (accountId) {
      await auditLogWrite({
        request: req,
        action: "AUTH_2FA_EMAIL_SENT",
        accountId,
        operatorUserId: row.userId,
        targetType: "auth",
        targetId: row.userId,
        targetLabel: user.email || row.userId,
        metaJson: {
          security_event: "2fa_email_resent",
          location: geo.label || null,
          geoRegion: geo.region,
          geoCountry: geo.country,
        },
      });
    }

    return json({ ok: true, expiresAt: expiresAt.toISOString() }, 200);
  } catch {
    return json({ ok: false, error: "CHALLENGE_RESEND_FAILED", message: "Failed to resend code." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
