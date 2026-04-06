// app/api/auth/recovery/email/confirm/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth/passwordReset";
import { recordAdminEventSafe } from "@/lib/admin/events";
import { AuthTokenType } from "@prisma/client";
import { readSanitizedJson } from "@/lib/security/userInput";
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

function emailDomainFromAddress(value: string | null | undefined) {
  const email = String(value || "").trim().toLowerCase();
  const parts = email.split("@");
  return parts.length === 2 ? parts[1] || "" : "";
}

export async function POST(req: Request) {
  try {
    const body = (await readSanitizedJson(req, {} as Record<string, unknown>)) as Record<string, unknown>;
    const token = String(body?.token || "").trim();

    if (!token) {
      return NextResponse.json({ ok: false, error: "INVALID_TOKEN" }, { status: 400, headers: noStore() });
    }

    const tokenHash = hashToken(token);

    const authToken = await prisma.authToken.findFirst({
      where: {
        tokenHash,
        type: AuthTokenType.EMAIL_RECOVERY,
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        metaJson: true,
      },
    });

    if (!authToken) {
      return NextResponse.json({ ok: false, error: "INVALID_TOKEN" }, { status: 400, headers: noStore() });
    }

    const meta = authToken.metaJson && typeof authToken.metaJson === "object"
      ? authToken.metaJson as Record<string, unknown>
      : null;
    const purpose = String(meta?.purpose || "").trim();
    if (purpose && purpose !== "email_lookup_recovery") {
      return NextResponse.json({ ok: false, error: "INVALID_TOKEN" }, { status: 400, headers: noStore() });
    }

    if (authToken.expiresAt.getTime() < Date.now()) {
      await prisma.authToken.delete({ where: { id: authToken.id } }).catch(() => {});
      return NextResponse.json({ ok: false, error: "EXPIRED_TOKEN" }, { status: 400, headers: noStore() });
    }

    const user = await prisma.user.findUnique({
      where: { id: authToken.userId },
      select: { email: true },
    });
    const geo = readCoarseRequestGeo(req);

    // Burn token (one-time)
    await prisma.authToken.delete({ where: { id: authToken.id } }).catch(() => {});

    await recordAdminEventSafe({
      name: "auth_email_recovery_completed",
      subjectUserId: authToken.userId,
      accountId: typeof meta?.accountId === "string" ? meta.accountId : null,
      projectId: typeof meta?.projectId === "number" ? meta.projectId : null,
      siteId: typeof meta?.siteId === "string" ? meta.siteId : null,
      origin: typeof meta?.requestedDomain === "string" ? meta.requestedDomain : null,
      status: "completed",
      result: "ok",
      country: geo.country,
      region: geo.region,
      metaJson: {
        recoveryType: "email",
        requestedDomain: typeof meta?.requestedDomain === "string" ? meta.requestedDomain : null,
        emailDomain: emailDomainFromAddress(user?.email),
      },
    });

    return NextResponse.json({ ok: true, email: user?.email || "" }, { headers: noStore() });
  } catch {
    return NextResponse.json({ ok: false, error: "RECOVERY_FAILED" }, { status: 500, headers: noStore() });
  }
}
