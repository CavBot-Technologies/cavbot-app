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

function safeNextPath(input: string | null) {
  const raw = String(input || "").trim();
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (raw.includes("\n") || raw.includes("\r")) return "/";
  return raw;
}

function appBase() {
  return getAppOrigin().replace(/\/+$/, "");
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
    const clientId = mustEnv("GOOGLE_CLIENT_ID");
    const clientSecret = mustEnv("GOOGLE_CLIENT_SECRET");
    if (!clientSecret) throw new Error("Missing env: GOOGLE_CLIENT_SECRET");

    // CSRF state token
    const state = randomBytes(24).toString("hex");

    // Must match current origin
    const callback = `${appBase()}/api/auth/oauth/google/callback`;

    // Optional: where to send them AFTER login
    // Example usage: /api/auth/oauth/google/start?next=/console
    const safeNext = safeNextPath(req.nextUrl.searchParams.get("next"));

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", callback);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");

    const res = NextResponse.redirect(url.toString());

    for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.headers.set(k, v);

    res.cookies.set("cb_google_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    });

    res.cookies.set("cb_google_oauth_next", safeNext, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    });

    res.cookies.set("cb_google_oauth_mode", mode, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    });

    return res;
  } catch (error) {
    console.error("[auth][oauth][google][start]", error);
    return authRedirect(req, mode, "google_oauth_unavailable");
  }
}
