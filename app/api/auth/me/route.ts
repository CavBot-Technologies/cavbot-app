import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";
export const runtime = "edge";
export async function GET(req: Request) {
  const sess = await getSession(req);

  if (!sess) {
    return NextResponse.json(
      { ok: false, authenticated: false },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  // System sessions (internal tooling)
  if (sess.systemRole === "system") {
    return NextResponse.json(
      { ok: true, authenticated: true, session: sess },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // User sessions
  const userId = sess.sub;
  const accountId = sess.accountId || null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, createdAt: true, lastLoginAt: true },
  });

  if (!user) {
    return NextResponse.json(
      { ok: false, authenticated: false },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  let account: any = null;
  let membership: any = null;

  if (accountId) {
    membership = await prisma.membership.findUnique({
      where: { accountId_userId: { accountId, userId } },
      select: { role: true, createdAt: true, accountId: true, userId: true },
    });

    // Only return account if user actually belongs to it
    if (membership) {
      account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { id: true, name: true, slug: true, tier: true, createdAt: true },
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      authenticated: true,
      session: sess,
      user,
      account,
      membership,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}