// app/api/auth/recovery/email/confirm/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth/passwordReset";
import { AuthTokenType } from "@prisma/client";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore() {
  return {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  };
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
      },
    });

    if (!authToken) {
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

    // Burn token (one-time)
    await prisma.authToken.delete({ where: { id: authToken.id } }).catch(() => {});

    return NextResponse.json({ ok: true, email: user?.email || "" }, { headers: noStore() });
  } catch {
    return NextResponse.json({ ok: false, error: "RECOVERY_FAILED" }, { status: 500, headers: noStore() });
  }
}
