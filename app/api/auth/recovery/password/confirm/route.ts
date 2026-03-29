// app/api/auth/recovery/password/confirm/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken, hashPasswordPBKDF2 } from "@/lib/auth/passwordReset";
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

function isStrongPassword(pw: string) {
  const p = String(pw || "");
  if (p.length < 10) return false;
  // strong but not annoying
  const hasUpper = /[A-Z]/.test(p);
  const hasLower = /[a-z]/.test(p);
  const hasNum = /[0-9]/.test(p);
  return hasUpper && hasLower && hasNum;
}

export async function POST(req: Request) {
  try {
    const body = (await readSanitizedJson(req, {} as Record<string, unknown>)) as Record<string, unknown>;
    const token = String(body?.token || "").trim();
    const password = String(body?.password || "");

    if (!token || !isStrongPassword(password)) {
      return NextResponse.json(
        { ok: false, error: "WEAK_PASSWORD" },
        { headers: noStore(), status: 400 }
      );
    }

    const tokenHash = hashToken(token);

    const authToken = await prisma.authToken.findFirst({
      where: {
        tokenHash,
        type: "PASSWORD_RESET",
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
      },
    });

    if (!authToken) {
      return NextResponse.json(
        { ok: false, error: "INVALID_TOKEN" },
        { headers: noStore(), status: 400 }
      );
    }

    if (authToken.expiresAt.getTime() < Date.now()) {
      // delete expired token
      await prisma.authToken.delete({ where: { id: authToken.id } }).catch(() => {});
      return NextResponse.json(
        { ok: false, error: "EXPIRED_TOKEN" },
        { headers: noStore(), status: 400 }
      );
    }

    // Update password securely
    const { salt, hash } = hashPasswordPBKDF2(password);

    // Assumes UserAuth has userId unique
    await prisma.userAuth.update({
      where: { userId: authToken.userId },
      data: {
        passwordSalt: salt,
        passwordHash: hash,
      },
    });

    // Burn token (one-time use)
    await prisma.authToken.delete({ where: { id: authToken.id } });

    return NextResponse.json({ ok: true }, { headers: noStore() });
  } catch {
    return NextResponse.json({ ok: false, error: "RESET_FAILED" }, { headers: noStore(), status: 500 });
  }
}
