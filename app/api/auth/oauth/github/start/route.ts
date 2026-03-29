// app/api/auth/oauth/github/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Always uses the actual domain your app is running on
function appBase(req: NextRequest) {
  return req.nextUrl.origin.replace(/\/+$/, "");
}

// Prevent open-redirect bugs (security: only allow internal paths)
function safeNextPath(input: string | null) {
  const raw = String(input || "").trim();
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (raw.includes("\n") || raw.includes("\r")) return "/";
  return raw;
}

export async function GET(req: NextRequest) {
  const clientId = mustEnv("GITHUB_CLIENT_ID");

  // CSRF protection state token
  const state = crypto.randomBytes(24).toString("hex");

  // Callback MUST match the exact GitHub OAuth callback URL you registered
  const callback = `${appBase(req)}/api/auth/oauth/github/callback`;

  // Optional redirect target after login
  // Example: /api/auth/oauth/github/start?next=/console
  const nextRaw = req.nextUrl.searchParams.get("next");
  const safeNext = safeNextPath(nextRaw);

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");

  const res = NextResponse.redirect(url.toString());

  // No-store headers (same as your login/register routes)
  for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.headers.set(k, v);

  const cookieBase = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10, // 10 minutes
  };

  // Store OAuth state securely
  res.cookies.set("cb_oauth_state", state, cookieBase);

  // Store next destination so callback can redirect you properly
  res.cookies.set("cb_oauth_next", safeNext, cookieBase);

  return res;
}