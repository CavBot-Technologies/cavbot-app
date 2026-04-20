// app/api/auth/oauth/github/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAppOrigin } from "@/lib/apiAuth";

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

function normalizeMode(mode: string | null) {
  return mode === "login" ? "login" : "signup";
}

// Always uses the actual domain your app is running on
function appBase() {
  return getAppOrigin().replace(/\/+$/, "");
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

function authRedirect(req: NextRequest, mode: "signup" | "login", error: string) {
  const url = new URL("/auth", appBase());
  url.searchParams.set("mode", mode);
  url.searchParams.set("error", error);
  const res = NextResponse.redirect(url.toString());
  for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.headers.set(k, v);
  return res;
}

export async function GET(req: NextRequest) {
  const mode = normalizeMode(req.nextUrl.searchParams.get("mode"));

  try {
    const clientId = mustEnv("GITHUB_CLIENT_ID");
    const clientSecret = mustEnv("GITHUB_CLIENT_SECRET");
    if (!clientSecret) throw new Error("Missing env: GITHUB_CLIENT_SECRET");

    // CSRF protection state token
    const state = randomBytes(24).toString("hex");

    // Callback MUST match the exact GitHub OAuth callback URL you registered
    const callback = `${appBase()}/api/auth/oauth/github/callback`;

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

    for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.headers.set(k, v);

    const cookieBase = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    };

    res.cookies.set("cb_oauth_state", state, cookieBase);
    res.cookies.set("cb_oauth_next", safeNext, cookieBase);
    res.cookies.set("cb_oauth_mode", mode, cookieBase);

    return res;
  } catch (error) {
    console.error("[auth][oauth][github][start]", error);
    return authRedirect(req, mode, "github_oauth_unavailable");
  }
}
