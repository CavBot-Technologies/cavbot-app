// app/api/settings/security/password/route.ts
import "server-only";


import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isApiAuthError,
  verifyPassword,
  hashPassword,
  createUserSession,
  sessionCookieOptions,
} from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { auditLogWrite } from "@/lib/audit";
import { readSanitizedJson } from "@/lib/security/userInput";
import { readCoarseRequestGeo } from "@/lib/requestGeo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const sess = await requireSettingsOwnerSession(req);


    const accountId = sess.accountId;
    const userId = sess.sub;


    type PasswordPayload = {
      currentPassword?: string;
      nextPassword?: string;
    };

    const body = (await readSanitizedJson(req, null)) as null | PasswordPayload;

    const currentPassword = String(body?.currentPassword || "");
    const nextPassword = String(body?.nextPassword || "");


    if (!currentPassword || !nextPassword) {
      return json({ error: "BAD_INPUT", message: "Missing password fields." }, 400);
    }
    if (nextPassword.length < 8) {
      return json({ error: "WEAK_PASSWORD", message: "New password must be at least 8 characters." }, 400);
    }


    const geo = readCoarseRequestGeo(req);


    // Load auth record
    const auth = await prisma.userAuth.findUnique({
      where: { userId },
      select: { passwordSalt: true, passwordHash: true, passwordIters: true, sessionVersion: true },
    });


    if (!auth) {
      return json({ error: "AUTH_NOT_FOUND", message: "Auth record not found." }, 404);
    }


    const salt = String(auth.passwordSalt || "");
    const hash = String(auth.passwordHash || "");
    const iters = Number(auth.passwordIters || 210000);


    const ok = await verifyPassword(currentPassword, salt, iters, hash);
    if (!ok) {
      return json({ error: "INVALID_PASSWORD", message: "Current password is incorrect." }, 403);
    }


    const next = await hashPassword(nextPassword);
    const now = new Date();


    // Transaction: update password + bump sessionVersion
    const updated = await prisma.$transaction(async (tx) => {
      return tx.userAuth.update({
        where: { userId },
        data: {
          passwordAlgo: next.algo,
          passwordIters: next.iters,
          passwordSalt: next.salt,
          passwordHash: next.hash,


          // revoke ALL existing sessions instantly
          sessionVersion: { increment: 1 },
        },
        select: { sessionVersion: true },
      });
    });


    // Keep current user logged in by minting a NEW session cookie with the new sessionVersion
    const freshToken = await createUserSession({
      userId,
      accountId,
      memberRole: sess.memberRole,
      sessionVersion: Number(updated.sessionVersion || 1),
    });


    const res = json({ ok: true }, 200);


    const { name, ...cookieOptsFromLib } = sessionCookieOptions(req);
    const cookieOpts = {
      ...cookieOptsFromLib,
      secure: process.env.NODE_ENV === "production" ? cookieOptsFromLib.secure : false,
    };


    res.cookies.set(name, freshToken, cookieOpts);

    if (accountId) {
      await auditLogWrite({
        request: req,
        action: "PASSWORD_CHANGED",
        accountId,
        operatorUserId: userId,
        targetType: "auth",
        targetId: userId,
        targetLabel: userId,
        metaJson: {
          security_event: "password_changed",
          location: geo.label,
          geoRegion: geo.region,
          geoCountry: geo.country,
          at: now.toISOString(),
        },
      });
    }


    return res;
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ error: error.code, message: error.message }, error.status);
    return json({ error: "SECURITY_PASSWORD_FAILED", message: "Failed to update password." }, 500);
  }
}


export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "PATCH, OPTIONS" } });
}


export async function GET() {
  return json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "PATCH, OPTIONS" } });
}
