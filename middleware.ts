// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import {
  isAllowedReservedPublicUsername,
  isBasicUsername,
  isReservedUsername,
  normalizeUsername,
  RESERVED_ROUTE_SLUGS,
} from "@/lib/username";
import { isUnsafePathname, sanitizeQueryParamValue } from "@/lib/security/userInput";
import {
  fromAdminInternalPath,
  isAdminHost,
  isAdminInternalPath,
  isAdminPublicPath,
  sanitizeAdminNextPath,
  toAdminInternalPath,
} from "@/lib/admin/config";

/**
 * CavBot Launch Middleware (Next.js App Router)
 * - Protects app routes behind a session cookie
 * - Allows public access to auth + recovery surfaces
 * - Never gates /api routes (auth enforced inside handlers)
 * - Safe redirects (preserves intended destination via ?next=)
 */

const SESSION_COOKIE_NAME =
  process.env.CAVBOT_SESSION_COOKIE_NAME || "cavbot_session";
const ADMIN_SESSION_COOKIE_NAME =
  process.env.CAVBOT_ADMIN_SESSION_COOKIE_NAME || "cavbot_admin_session";

const OWNER_USERNAME = normalizeUsername(process.env.CAVBOT_OWNER_USERNAME || "");

const PUBLIC_FILE = /\.(.*)$/;
const STATUS_PROBE_HEADER = "x-cavbot-status-probe";

const ALWAYS_PUBLIC_STATUS_PATHS = ["/status", "/status/history", "/status/incidents"];
const UTF8_ENCODER = new TextEncoder();

type VerifiedUserSessionPayload = {
  sub?: string;
  systemRole?: string;
  memberRole?: string;
  exp?: number;
  v?: number;
};

type VerifiedAdminSessionPayload = {
  sub?: string;
  staffId?: string;
  staffCode?: string;
  role?: string;
  exp?: number;
  v?: number;
};

function isStatusPublicPath(pathname: string) {
  if (ALWAYS_PUBLIC_STATUS_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/status/incidents/")) return true;
  return false;
}

function badRequestResponse() {
  return new NextResponse("Bad Request", {
    status: 400,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function isLocalhostHost(host: string) {
  const normalized = String(host || "").trim().toLowerCase();
  return (
    normalized.includes("localhost") ||
    normalized.startsWith("127.0.0.1") ||
    normalized.startsWith("0.0.0.0") ||
    normalized.startsWith("[::1]")
  );
}

function cookieShouldBeSecure(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return true;

  const allowDevSecure = String(process.env.CAVBOT_DEV_SECURE_COOKIE || "").trim() === "1";
  if (!allowDevSecure) return false;

  const host = String(req.headers.get("host") || "").trim();
  const proto = String(req.headers.get("x-forwarded-proto") || "").trim().toLowerCase();
  return !isLocalhostHost(host) && proto === "https";
}

function expireCookie(res: NextResponse, req: NextRequest, name: string) {
  res.cookies.set(name, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieShouldBeSecure(req),
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}

function applyAuthCookieCleanup(
  res: NextResponse,
  req: NextRequest,
  options: { clearUser?: boolean; clearAdmin?: boolean },
) {
  if (options.clearUser) expireCookie(res, req, SESSION_COOKIE_NAME);
  if (options.clearAdmin) expireCookie(res, req, ADMIN_SESSION_COOKIE_NAME);
  return res;
}

function sanitizeQueryParamsInPlace(url: URL): boolean {
  const original = Array.from(url.searchParams.entries());
  if (!original.length) return false;

  let changed = false;
  const rebuilt = new URLSearchParams();
  for (const [rawKey, rawValue] of original) {
    const key = sanitizeQueryParamValue(rawKey);
    const value = sanitizeQueryParamValue(rawValue);
    if (key !== rawKey || value !== rawValue) changed = true;
    if (!key) continue;
    rebuilt.append(key, value);
  }

  if (!changed) return false;
  const nextSearch = rebuilt.toString();
  url.search = nextSearch ? `?${nextSearch}` : "";
  return true;
}

// Public paths (no auth required)
function isPublicPath(pathname: string) {
  // Keep API un-gated by middleware (auth is enforced inside routes)
  if (pathname.startsWith("/api/")) return true;

  // Tokenized share links (public; resolve -> redirect to CavCloud gateway)
  if (pathname === "/share" || pathname.startsWith("/share/")) return true;

  // Public artifact resolver (public; mints short-lived token and redirects)
  if (pathname === "/p" || pathname.startsWith("/p/")) return true;

  // Public profile backing route (canonical is /{username} via rewrite)
  if (pathname === "/u" || pathname.startsWith("/u/")) return true;

  // CavBot Arcade surfaces are public so in-game links can return to the gallery
  // even when the user enters via a static game page under /public.
  if (
    pathname === "/cavbot-arcade" ||
    pathname === "/cavbot-arcade/" ||
    pathname.startsWith("/cavbot-arcade/gallery")
  ) {
    return true;
  }

  // Next internals + static assets
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    PUBLIC_FILE.test(pathname)
  ) {
    return true;
  }

  // CavBot status pages (PUBLIC)
  if (isStatusPublicPath(pathname)) {
    return true;
  }

  // Auth + recovery routes (PUBLIC)
  if (
    pathname === "/auth" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/cavai" ||
    pathname === "/cavai/" ||
    pathname === "/users/recovery" ||
    pathname.startsWith("/users/recovery/")
  ) {
    return true;
  }

  return false;
}

// Normalize next param (defensive)
function safeNextParam(pathname: string, search: string) {
  const next = `${pathname}${search || ""}`.trim();

  // Never allow external redirects
  if (next.startsWith("http://") || next.startsWith("https://")) return "/";

  // Must be an internal route
  if (!next.startsWith("/")) return "/";

  return next;
}

function isRoutablePublicUsernameCandidate(raw: string, candidate: string) {
  return (
    Boolean(candidate) &&
    isBasicUsername(candidate) &&
    !((RESERVED_ROUTE_SLUGS as readonly string[]).includes(candidate)) &&
    (!isReservedUsername(candidate) || isAllowedReservedPublicUsername(candidate, OWNER_USERNAME)) &&
    !raw.includes(".") &&
    !raw.includes("/") &&
    !raw.includes("\\")
  );
}

async function profileExists(req: NextRequest, candidate: string) {
  const checkUrl = req.nextUrl.clone();
  checkUrl.pathname = "/api/public/profile-exists";
  checkUrl.search = `username=${encodeURIComponent(candidate)}`;

  const res = await fetch(checkUrl, {
    method: "GET",
    headers: {
      "Cache-Control": "no-store",
    },
  });

  const data = (await res.json().catch(() => null)) as null | { ok?: boolean; exists?: boolean };
  return Boolean(data?.ok && data.exists === true);
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSha256(secret: string, payloadB64: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    UTF8_ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, UTF8_ENCODER.encode(payloadB64));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function parseVerifiedSessionPayload(token: string): Promise<null | VerifiedUserSessionPayload> {
  const secret = String(process.env.CAVBOT_SESSION_SECRET || "").trim();
  if (!secret) return null;

  const [payloadB64, sig] = String(token || "").trim().split(".");
  if (!payloadB64 || !sig) return null;

  const expectedSig = await hmacSha256(secret, payloadB64);
  if (!timingSafeEqual(sig, expectedSig)) return null;

  try {
    const decoded = new TextDecoder().decode(base64UrlToBytes(payloadB64));
    const payload = JSON.parse(decoded) as VerifiedUserSessionPayload;
    if (!payload || payload.v !== 1) return null;
    const exp = Number(payload.exp || 0);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function parseVerifiedAdminSessionPayload(token: string): Promise<null | VerifiedAdminSessionPayload> {
  const secret = String(process.env.CAVBOT_ADMIN_SESSION_SECRET || process.env.CAVBOT_SESSION_SECRET || "").trim();
  if (!secret) return null;

  const [payloadB64, sig] = String(token || "").trim().split(".");
  if (!payloadB64 || !sig) return null;

  const expectedSig = await hmacSha256(secret, payloadB64);
  if (!timingSafeEqual(sig, expectedSig)) return null;

  try {
    const decoded = new TextDecoder().decode(base64UrlToBytes(payloadB64));
    const payload = JSON.parse(decoded) as VerifiedAdminSessionPayload;
    if (!payload || payload.v !== 1) return null;
    const exp = Number(payload.exp || 0);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
    if (!payload.sub || !payload.staffId || !payload.staffCode || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  if (req.headers.get(STATUS_PROBE_HEADER) === "1") {
    return NextResponse.next();
  }

  const { pathname, search } = req.nextUrl;
  if (isUnsafePathname(pathname)) {
    return badRequestResponse();
  }

  const sanitizedUrl = req.nextUrl.clone();
  const queryChanged = sanitizeQueryParamsInPlace(sanitizedUrl);
  if (queryChanged) {
    if (req.method === "GET" || req.method === "HEAD") {
      return NextResponse.redirect(sanitizedUrl, 308);
    }
    return badRequestResponse();
  }

  const host = String(req.headers.get("x-forwarded-host") || req.headers.get("host") || "").trim();

  if (!isAdminHost(host) && isAdminInternalPath(pathname)) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  if (isAdminHost(host)) {
    const visiblePath = fromAdminInternalPath(pathname);

    if (
      visiblePath.startsWith("/_next/") ||
      visiblePath.startsWith("/favicon") ||
      visiblePath === "/robots.txt" ||
      visiblePath === "/sitemap.xml" ||
      PUBLIC_FILE.test(visiblePath)
    ) {
      return NextResponse.next();
    }

    if (visiblePath.startsWith("/api/")) {
      return NextResponse.next();
    }

    const rawAdminToken = String(req.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value || "").trim();
    const rawUserToken = String(req.cookies.get(SESSION_COOKIE_NAME)?.value || "").trim();
    const [userSessionPayload, adminSessionPayload] = await Promise.all([
      rawUserToken ? parseVerifiedSessionPayload(rawUserToken) : Promise.resolve(null),
      rawAdminToken ? parseVerifiedAdminSessionPayload(rawAdminToken) : Promise.resolve(null),
    ]);

    const hasValidUserSession = Boolean(
      userSessionPayload &&
      userSessionPayload.systemRole === "user" &&
      userSessionPayload.sub &&
      userSessionPayload.memberRole,
    );
    const hasValidAdminSession = Boolean(adminSessionPayload);
    const sameAdminIdentity = Boolean(
      hasValidUserSession &&
      hasValidAdminSession &&
      userSessionPayload?.sub &&
      adminSessionPayload?.sub &&
      userSessionPayload.sub === adminSessionPayload.sub,
    );
    const hasFullAdminAuth = hasValidUserSession && hasValidAdminSession && sameAdminIdentity;
    const clearUserCookie = Boolean(rawUserToken) && !hasValidUserSession;
    const clearAdminCookie = Boolean(rawAdminToken) && (!hasValidAdminSession || !sameAdminIdentity);

    if ((visiblePath === "/sign-in" || visiblePath === "/forgot-staff-id") && hasFullAdminAuth) {
      const url = req.nextUrl.clone();
      url.pathname = "/overview";
      url.search = "";
      return applyAuthCookieCleanup(NextResponse.redirect(url, 307), req, {
        clearUser: clearUserCookie,
        clearAdmin: clearAdminCookie,
      });
    }

    if (!isAdminPublicPath(visiblePath) && !hasFullAdminAuth) {
      const url = req.nextUrl.clone();
      url.pathname = "/sign-in";
      url.search = `next=${encodeURIComponent(sanitizeAdminNextPath(`${visiblePath}${search || ""}`))}`;
      return applyAuthCookieCleanup(NextResponse.redirect(url, 307), req, {
        clearUser: clearUserCookie,
        clearAdmin: clearAdminCookie,
      });
    }

    let adminResponse: NextResponse;
    if (!isAdminInternalPath(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = toAdminInternalPath(visiblePath);
      adminResponse = NextResponse.rewrite(url);
    } else {
      adminResponse = NextResponse.next();
    }
    return applyAuthCookieCleanup(adminResponse, req, {
      clearUser: clearUserCookie,
      clearAdmin: clearAdminCookie,
    });
  }

  // ------------------------------------------------------------
  // CANONICAL PROFILE URL
  // Redirect /u/{username} -> /{username} for users.
  // ------------------------------------------------------------
  try {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 2 && String(parts[0] || "").toLowerCase() === "u") {
      const raw = String(parts[1] || "");
      const candidate = normalizeUsername(raw);

      if (isRoutablePublicUsernameCandidate(raw, candidate) && await profileExists(req, candidate)) {
        const url = req.nextUrl.clone();
        url.pathname = `/${candidate}`;
        url.search = search || "";
        return NextResponse.redirect(url, 308);
      }
    }
  } catch {
    // fail-closed (no redirect)
  }

  // ------------------------------------------------------------
  // PUBLIC PROFILE REWRITE (MULTI-TENANT SAFE)
  // Only rewrite /{username} -> /u/{username} when that username exists.
  // This avoids hijacking legitimate single-segment workspace routes.
  // ------------------------------------------------------------
  try {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 1) {
      const raw = String(parts[0] || "");
      const candidate = normalizeUsername(raw);

      // Must look like a username (and must not be reserved / file-like).
      if (isRoutablePublicUsernameCandidate(raw, candidate)) {
        if (await profileExists(req, candidate)) {
          const url = req.nextUrl.clone();
          url.pathname = `/u/${candidate}`;
          // Keep the URL users see as /{username}
          url.search = search || "";
          return NextResponse.rewrite(url);
        }
      }
    }
  } catch {
    // fail-closed (no rewrite)
  }

  // ------------------------------------------------------------
  // PUBLIC ROUTES
  // ------------------------------------------------------------
  if (isPublicPath(pathname)) {
    // If already logged in, don’t show auth again
    if (pathname === "/auth" || pathname === "/login" || pathname === "/register") {
      const token = req.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();
      if (token) {
        const payload = await parseVerifiedSessionPayload(token);
        if (payload) {
          const url = req.nextUrl.clone();
          url.pathname = "/";
          url.search = "";
          return NextResponse.redirect(url);
        }
      }
    }

    return NextResponse.next();
  }

  // Public routes (no auth required)
  if (
    pathname.startsWith("/users/recovery") ||
    pathname.startsWith("/users/reset")
  ) {
    return NextResponse.next();
  }


  // ------------------------------------------------------------
  // PROTECTED ROUTES
  // ------------------------------------------------------------
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();

  // No session -> send to /auth and preserve destination
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth";
    url.search = `next=${encodeURIComponent(safeNextParam(pathname, search))}`;
    return NextResponse.redirect(url);
  }

  const payload = await parseVerifiedSessionPayload(token);
  if (!payload) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth";
    url.search = `next=${encodeURIComponent(safeNextParam(pathname, search))}`;
    return NextResponse.redirect(url);
  }

  const isOwnerSettingsPath = pathname === "/settings"
    || pathname.startsWith("/settings/")
    || pathname === "/cavcloud/settings"
    || pathname.startsWith("/cavcloud/settings/")
    || pathname === "/cavsafe/settings"
    || pathname.startsWith("/cavsafe/settings/");

  if (isOwnerSettingsPath) {
    const role = String(payload.memberRole || "").trim().toUpperCase();
    if (role !== "OWNER") {
      return new NextResponse("Forbidden", {
        status: 403,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }
  }

  return NextResponse.next();
}

/**
 * Matcher:
 * - Runs everywhere EXCEPT:
 *   - Next.js static assets
 *   - images
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
