// app/api/auth/session/route.ts
import "server-only";


import { NextResponse } from "next/server";
import {
  createSystemSession,
  readVerifiedSession,
  createUserSession,
  requireSystemToken,
  expireSessionCookie,
  isApiAuthError,
  sessionCookieOptions,
  writeSessionCookie,
} from "@/lib/apiAuth";
import type { CavbotSession } from "@/lib/apiAuth";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";


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



type Role = "OWNER" | "ADMIN" | "MEMBER";
function normalizeRole(value: string | null | undefined): Role {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "OWNER") return "OWNER";
  if (normalized === "ADMIN") return "ADMIN";
  return "MEMBER";
}

function resolveIssuedSessionVersion(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}


function normalizeEmail(x: unknown) {
  return String(x ?? "").trim().toLowerCase();
}

function buildDegradedBootstrapFromSession(sess: CavbotSession) {
  if (sess.systemRole !== "user") return null;

  const userId = String(sess.sub || "").trim();
  const accountId = String(sess.accountId || "").trim();
  if (!userId || !accountId) return null;

  return {
    mode: "user" as const,
    session: {
      userId,
      email: null,
      displayName: null,
      accountId,
      memberRole: normalizeRole(sess.memberRole),
    },
    account: {
      id: accountId,
      slug: null,
      tier: null,
      name: null,
    },
  };
}


type SessionBody = {
  email?: string;
  accountId?: string;
};

function toStringValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return typeof value === "string" ? value : String(value);
}

async function readBody(req: Request): Promise<SessionBody> {
  const { readSanitizedFormData, readSanitizedJson } = await import("@/lib/security/userInput");
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const raw = (await readSanitizedJson(req, ({}))) as Record<string, unknown>;
    return {
      email: toStringValue(raw.email),
      accountId: toStringValue(raw.accountId),
    };
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await readSanitizedFormData(req, null);
    if (!fd) return {};
    return {
      email: toStringValue(fd.get("email")),
      accountId: toStringValue(fd.get("accountId")),
    };
  }
  const fallback = (await readSanitizedJson(req, ({}))) as Record<string, unknown>;
  return {
    email: toStringValue(fallback.email),
    accountId: toStringValue(fallback.accountId),
  };
}


/* =========================
   Client fingerprint (read-only)
   ========================= */


function pickIp(req: Request) {
  // Prefer first forwarded IP
  const xff = String(req.headers.get("x-forwarded-for") || "").trim();
  if (xff) return xff.split(",")[0].trim();
  const xr = String(req.headers.get("x-real-ip") || "").trim();
  if (xr) return xr;
  return "";
}


function detectBrowser(uaRaw: string) {
  const ua = String(uaRaw || "").toLowerCase();


  // Order matters
  if (ua.includes("edg/") || ua.includes("edge/")) return "edge";
  if (ua.includes("brave")) return "brave";
  if (ua.includes("firefox/")) return "firefox";
  if (ua.includes("chrome/") && !ua.includes("chromium") && !ua.includes("edg/")) return "chrome";
  if (ua.includes("safari/") && !ua.includes("chrome/") && !ua.includes("chromium")) return "safari";


  return "unknown";
}


function detectPlatform(uaRaw: string) {
  const ua = String(uaRaw || "");
  const l = ua.toLowerCase();
  if (l.includes("mac os x") || l.includes("macintosh")) return "macos";
  if (l.includes("windows")) return "windows";
  if (l.includes("android")) return "android";
  if (l.includes("iphone") || l.includes("ipad") || l.includes("ios")) return "ios";
  if (l.includes("linux")) return "linux";
  return "unknown";
}


function makeClientMeta(req: Request) {
  const ua = String(req.headers.get("user-agent") || "");
  const browser = detectBrowser(ua);
  const platform = detectPlatform(ua);
  const ip = pickIp(req);


  return {
    userAgent: ua || null,
    browser, // "chrome" | "safari" | ...
    platform, // "macos" | "windows" | ...
    ip: ip || null,
  };
}


/**
 * IMPORTANT:
 * - Client bootstraps with GET /api/auth/session
 * - This GET must return 200 always with { authed: boolean } to prevent loops
 * - If cookie is invalid/stale, we clear it (so middleware + API agree)
 *
 * NOTE:
 * - This endpoint does NOT create “session history” records.
 *   Session history requires a real Session table + capture on login/refresh.
 */
export async function GET(req: Request) {
  const sess: CavbotSession | null = await readVerifiedSession(req).catch(() => null);

  try {
    const client = makeClientMeta(req);
    if (!sess) {
      return json({ ok: true, authed: false, signedOut: false, client }, 200);
    }

    // System session (ops)
    if (sess.systemRole === "system") {
      return json({ ok: true, authed: true, mode: "system", client }, 200);
    }


    const userId = String(sess.sub || "").trim();
    const accountId = String(sess.accountId || "").trim();


    if (!userId || !accountId) {
      const res = json({ ok: true, authed: false, signedOut: true, reason: "missing_session_fields", client }, 200);
      return expireSessionCookie(req, res);
    }

    const response = json(
      {
        ok: true,
        authed: true,
        mode: "user",
        signedOut: false,
        session: {
          userId,
          email: null,
          displayName: null,
          accountId,
          memberRole: normalizeRole(sess.memberRole),
        },
        account: {
          id: accountId,
          slug: null,
          tier: null,
          name: null,
        },
        client,
      },
      200
    );
    const sharedSessionCookieEnabled = Boolean(sessionCookieOptions(req).domain);
    if (sharedSessionCookieEnabled) {
      const token = await createUserSession({
        userId,
        accountId,
        memberRole: normalizeRole(sess.memberRole),
        sessionVersion: resolveIssuedSessionVersion(sess.sv),
      });
      return writeSessionCookie(req, response, token);
    }
    return response;
  } catch (error) {
    // Always return 200 for session bootstrap stability
    const client = makeClientMeta(req);
    const authErrorCode = isApiAuthError(error) ? error.code : "";

    if (isApiAuthError(error) && (error.status === 401 || error.status === 403)) {
      const res = json({ ok: true, authed: false, signedOut: true, error: error.code, client }, 200);
      return expireSessionCookie(req, res);
    }

    if (sess?.systemRole === "system") {
      return json(
        {
          ok: true,
          authed: true,
          mode: "system",
          degraded: true,
          indeterminate: true,
          retryable: true,
          ...(authErrorCode ? { error: authErrorCode } : {}),
          client,
        },
        200
      );
    }

    const degraded = sess ? buildDegradedBootstrapFromSession(sess) : null;
    if (degraded) {
      return json(
        {
          ok: true,
          authed: true,
          degraded: true,
          indeterminate: true,
          retryable: true,
          ...(authErrorCode ? { error: authErrorCode } : {}),
          client,
          ...degraded,
        },
        200
      );
    }

    return json(
      {
        ok: true,
        authed: false,
        degraded: true,
        indeterminate: true,
        retryable: true,
        ...(authErrorCode ? { error: authErrorCode } : {}),
        client,
      },
      200
    );
  }
}


export async function POST(req: Request) {
  try {
    // INTERNAL ONLY
    requireSystemToken(req);
    const {
      findUserAuth,
      findMembershipsForUser,
      findUserByEmail,
      getAuthPool,
      pickPrimaryMembership,
    } = await import("@/lib/authDb");


    const body = await readBody(req);
    const email = normalizeEmail(body?.email);
    const requestedAccountId = String(body?.accountId || "").trim();


    // No email -> mint SYSTEM session (ops)
    if (!email) {
      const token = await createSystemSession();
      const res = json({ ok: true, mode: "system" }, 200);


      return writeSessionCookie(req, res, token);
    }


    const pool = getAuthPool();
    const user = await findUserByEmail(pool, email);
    const memberships = user ? await findMembershipsForUser(pool, user.id) : [];


    if (!user || !memberships.length) {
      return json({ ok: false, error: "user_not_found_or_no_membership" }, 404);
    }


    let active = null as null | (typeof memberships)[number];


    if (requestedAccountId) {
      active = memberships.find((m) => String(m.accountId) === requestedAccountId) || null;
      if (!active) return json({ ok: false, error: "not_a_member_of_account" }, 403);
    } else {
      active = pickPrimaryMembership(memberships);
    }


    if (!active) return json({ ok: false, error: "user_not_found_or_no_membership" }, 404);

    const memberRole = normalizeRole(active.role);
    const userAuth = await findUserAuth(pool, user.id).catch(() => null);
    const token = await createUserSession({
      userId: user.id,
      accountId: active.accountId,
      memberRole,
      sessionVersion: resolveIssuedSessionVersion(userAuth?.sessionVersion),
    });

    const res = json({ ok: true, mode: "user", accountId: active.accountId, memberRole }, 200);


    return writeSessionCookie(req, res, token);
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "session_issue_failed" }, 500);
  }
}


export async function DELETE(req: Request) {
  const res = json({ ok: true }, 200);
  return expireSessionCookie(req, res);
}


export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET,POST,DELETE,OPTIONS" },
  });
}
