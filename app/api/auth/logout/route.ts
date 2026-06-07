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
  Vary: "Origin, Cookie",
};

const ALLOWED_PUBLIC_SITE_ORIGINS = new Set([
  "https://cavbot.io",
  "https://www.cavbot.io",
  "https://brand.cavbot.io",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const headers: Record<string, string> = {
    ...NO_STORE_HEADERS,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (ALLOWED_PUBLIC_SITE_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

function isAllowedPublicSiteOrigin(req: Request) {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_PUBLIC_SITE_ORIGINS.has(origin);
}

function jsonForRequest<T>(req: Request, payload: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...corsHeaders(req) },
  });
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  try {
    if (!isAllowedPublicSiteOrigin(req)) {
      assertWriteOrigin(req);
    }

    let session: { accountId?: string | null; sub?: string | null } | null = null;
    try {
      session = await requireSession(req);
    } catch {}

    const res = jsonForRequest(req, { ok: true }, 200);

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
    if (isApiAuthError(error)) return jsonForRequest(req, { ok: false, error: error.code }, error.status);
    return jsonForRequest(req, { ok: false, error: "logout_failed" }, 500);
  }
}
