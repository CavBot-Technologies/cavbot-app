import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  assertWriteOrigin,
  createUserSession,
  sessionCookieHeader,
  verifyPassword,
} from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

type Role = "OWNER" | "ADMIN" | "MEMBER";

function roleRank(role: Role) {
  if (role === "OWNER") return 3;
  if (role === "ADMIN") return 2;
  return 1;
}
export const runtime = "edge";
export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);

    const body = await req.json().catch(() => ({}));
    const emailRaw = String(body.email || "");
    const password = String(body.password || "");

    const email = emailRaw.trim().toLowerCase();

    if (!email || !password) {
      return NextResponse.json(
        { ok: false, error: "missing_credentials" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        auth: true,
        memberships: true,
      },
    });

    // Generic response on auth failure (don’t reveal which part failed)
    if (!user || !user.auth) {
      return NextResponse.json(
        { ok: false, error: "invalid_credentials" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const ok = await verifyPassword(
      password,
      user.auth.passwordSalt,
      user.auth.passwordIters,
      user.auth.passwordHash
    );

    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "invalid_credentials" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Must belong to at least one tenant (Account)
    if (!user.memberships || user.memberships.length === 0) {
      return NextResponse.json(
        { ok: false, error: "no_account_membership" },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Choose default tenant:
    // Prefer OWNER > ADMIN > MEMBER; tie-breaker by earliest created membership
    const sorted = [...user.memberships].sort((a, b) => {
      const rr = roleRank(a.role as Role) - roleRank(b.role as Role);
      if (rr !== 0) return -rr; // higher first
      const at = new Date(a.createdAt as any).getTime();
      const bt = new Date(b.createdAt as any).getTime();
      return at - bt;
    });

    const active = sorted[0];

    const token = await createUserSession({
      userId: user.id,
      accountId: active.accountId,
      memberRole: active.role as any,
    });

    // Update lastLoginAt (best practice, helps security/audit later)
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const res = NextResponse.json(
      {
        ok: true,
        accountId: active.accountId,
        memberRole: active.role,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );

    res.headers.set("Set-Cookie", sessionCookieHeader(token));
    return res;
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = msg === "BAD_ORIGIN" ? 403 : 500;
    return NextResponse.json(
      { ok: false, error: msg === "BAD_ORIGIN" ? "bad_origin" : "login_failed" },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }
}