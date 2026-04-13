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
  buildCanonicalCavAiUrlFromSearchParams,
  buildCavAiPageSearchParamsFromRoot,
  isCavAiCanonicalHost,
} from "@/lib/cavai/url";

/**
 * CavBot Launch Middleware (Next.js App Router)
 * - Protects app routes behind a session cookie
 * - Allows public access to auth + recovery surfaces
 * - Never gates /api routes (auth enforced inside handlers)
 * - Safe redirects (preserves intended destination via ?next=)
 */

const SESSION_COOKIE_NAME =
  process.env.CAVBOT_SESSION_COOKIE_NAME || "cavbot_session";

const OWNER_USERNAME = normalizeUsername(process.env.CAVBOT_OWNER_USERNAME || "");

const PUBLIC_FILE = /\.(.*)$/;
const STATUS_PROBE_HEADER = "x-cavbot-status-probe";

const ALWAYS_PUBLIC_STATUS_PATHS = ["/status", "/status/history", "/status/incidents"];
const UTF8_ENCODER = new TextEncoder();

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

async function parseVerifiedSessionPayload(token: string): Promise<null | { memberRole?: string; exp?: number; v?: number }> {
  const secret = String(process.env.CAVBOT_SESSION_SECRET || "").trim();
  if (!secret) return null;

  const [payloadB64, sig] = String(token || "").trim().split(".");
  if (!payloadB64 || !sig) return null;

  const expectedSig = await hmacSha256(secret, payloadB64);
  if (!timingSafeEqual(sig, expectedSig)) return null;

  try {
    const decoded = new TextDecoder().decode(base64UrlToBytes(payloadB64));
    const payload = JSON.parse(decoded) as { memberRole?: string; exp?: number; v?: number };
    if (!payload || payload.v !== 1) return null;
    const exp = Number(payload.exp || 0);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
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

  const aiHostEnabled = process.env.NODE_ENV === "production";
  const onCavAiCanonicalHost = aiHostEnabled && isCavAiCanonicalHost(req.nextUrl.hostname);

  if (aiHostEnabled && (pathname === "/cavai" || pathname === "/cavai/")) {
    const target = onCavAiCanonicalHost
      ? req.nextUrl.clone()
      : new URL(buildCanonicalCavAiUrlFromSearchParams(req.nextUrl.searchParams));
    if (onCavAiCanonicalHost) {
      target.pathname = "/";
      const canonicalParams = new URL(buildCanonicalCavAiUrlFromSearchParams(req.nextUrl.searchParams)).search;
      target.search = canonicalParams;
    }
    return NextResponse.redirect(target, 308);
  }

  if (onCavAiCanonicalHost && pathname === "/") {
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = "/cavai";
    const params = buildCavAiPageSearchParamsFromRoot(req.nextUrl.searchParams);
    const query = params.toString();
    rewriteUrl.search = query ? `?${query}` : "";
    return NextResponse.rewrite(rewriteUrl);
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
