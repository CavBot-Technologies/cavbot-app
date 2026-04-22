// app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { assertWriteOrigin, expireSessionCookie, isApiAuthError, requireSession } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);

    let session: { accountId?: string | null; sub?: string | null } | null = null;
    try {
      session = await requireSession(req);
    } catch {}

    const res = json({ ok: true }, 200);

    // Clear session cookie reliably
    expireSessionCookie(req, res);

    // Clear project pointers
    const pointerCookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    };

    res.cookies.set("cb_active_project_id", "", pointerCookieOpts);
    res.cookies.set("cb_pid", "", pointerCookieOpts);

    if (session?.accountId) {
      await auditLogWrite({
        request: req,
        action: "AUTH_SIGNED_OUT",
        accountId: session.accountId,
        operatorUserId: session.sub ?? null,
        targetType: "auth",
        targetId: session.sub ?? null,
        targetLabel: session.sub || session.accountId,
        metaJson: {
          security_event: "logout",
        },
      });
    }

    return res;
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "logout_failed" }, 500);
  }
}
