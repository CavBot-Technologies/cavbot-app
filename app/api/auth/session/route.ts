import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  clearSessionCookieHeader,
  createSystemSession,
  createUserSession,
  requireSystemToken,
  sessionCookieHeader,
} from "@/lib/apiAuth";

type Role = "OWNER" | "ADMIN" | "MEMBER";

function roleRank(role: Role) {
  if (role === "OWNER") return 3;
  if (role === "ADMIN") return 2;
  return 1;
}
export const runtime = "edge";
export async function POST(req: Request) {
  try {
    // INTERNAL ONLY
    requireSystemToken(req);

    const body = await req.json().catch(() => ({}));
    const emailRaw = String(body.email || "").trim().toLowerCase();
    const requestedAccountId = String(body.accountId || "").trim();

    // If no email provided: mint a SYSTEM session (for internal ops surfaces)
    if (!emailRaw) {
      const token = await createSystemSession();
      const res = NextResponse.json({ ok: true, mode: "system" }, { headers: { "Cache-Control": "no-store" } });
      res.headers.set("Set-Cookie", sessionCookieHeader(token));
      return res;
    }

    const user = await prisma.user.findUnique({
      where: { email: emailRaw },
      include: { memberships: true },
    });

    if (!user || !user.memberships || user.memberships.length === 0) {
      return NextResponse.json(
        { ok: false, error: "user_not_found_or_no_membership" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    // If accountId is provided, ensure membership exists in that tenant
    let active = null as any;

    if (requestedAccountId) {
      active = user.memberships.find((m) => m.accountId === requestedAccountId) || null;
      if (!active) {
        return NextResponse.json(
          { ok: false, error: "not_a_member_of_account" },
          { status: 403, headers: { "Cache-Control": "no-store" } }
        );
      }
    } else {
      // Default: OWNER > ADMIN > MEMBER, earliest created membership
      active = [...user.memberships].sort((a, b) => {
        const rr = roleRank(a.role as Role) - roleRank(b.role as Role);
        if (rr !== 0) return -rr;
        const at = new Date(a.createdAt as any).getTime();
        const bt = new Date(b.createdAt as any).getTime();
        return at - bt;
      })[0];
    }

    const token = await createUserSession({
      userId: user.id,
      accountId: active.accountId,
      memberRole: active.role as any,
    });

    const res = NextResponse.json(
      { ok: true, mode: "user", accountId: active.accountId, memberRole: active.role },
      { headers: { "Cache-Control": "no-store" } }
    );

    res.headers.set("Set-Cookie", sessionCookieHeader(token));
    return res;
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(
      { ok: false, error: "session_issue_failed", message: msg },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.headers.set("Set-Cookie", clearSessionCookieHeader());
  return res;
}