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

function appBase(req: NextRequest) {
  return req.nextUrl.origin.replace(/\/+$/, "");
}

export async function GET(req: NextRequest) {
  const clientId = mustEnv("GOOGLE_CLIENT_ID");

  //CSRF state token
  const state = crypto.randomBytes(24).toString("hex");

  //Must match current origin
  const callback = `${appBase(req)}/api/auth/oauth/google/callback`;

  //Optional: where to send them AFTER login
  // Example usage: /api/auth/oauth/google/start?next=/console
  const next = req.nextUrl.searchParams.get("next") || "/";
  const safeNext = next.startsWith("/") ? next : "/";

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

  //Store state (10 min)
  res.cookies.set("cb_google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  //Store next destination (10 min)
  res.cookies.set("cb_google_oauth_next", safeNext, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  return res;
}