import "server-only";

import { NextResponse } from "next/server";

import { readVerifiedSession } from "@/lib/apiAuth";
import { readAuthSessionView } from "@/lib/authSessionView.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ORIGINS = new Set([
  "https://cavbot.io",
  "https://www.cavbot.io",
]);

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Origin, Cookie",
};

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const headers: Record<string, string> = {
    ...NO_STORE_HEADERS,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

function json<T>(req: Request, payload: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...corsHeaders(req) },
  });
}

function cleanString(value: unknown, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function initialsFor(input: { initials?: unknown; displayName?: unknown; fullName?: unknown; email?: unknown; username?: unknown }) {
  const explicit = cleanString(input.initials, 4).toUpperCase();
  if (explicit) return explicit.slice(0, 3);
  const source =
    cleanString(input.displayName, 120)
    || cleanString(input.fullName, 120)
    || cleanString(input.username, 80)
    || cleanString(input.email, 120);
  if (!source) return "C";
  const words = source.includes("@")
    ? [source.split("@")[0]]
    : source.split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 3) || "C";
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  const sess = await readVerifiedSession(req).catch(() => null);
  if (!sess || sess.systemRole !== "user") {
    return json(req, { ok: true, authenticated: false }, 200);
  }

  const view = await readAuthSessionView(sess).catch(() => null);
  if (!view?.user) {
    return json(req, { ok: true, authenticated: false, indeterminate: true }, 200);
  }

  const user = view.user;
  const displayName = cleanString(user.displayName || user.fullName || user.username || user.email, 120);
  const username = cleanString(user.username, 80);
  const avatarImage = cleanString(user.avatarImage, 2000);
  const avatarTone = cleanString(user.avatarTone, 32).toLowerCase() || "lime";

  return json(
    req,
    {
      ok: true,
      authenticated: true,
      user: {
        displayName,
        username: username || null,
        initials: initialsFor(user),
        avatarImage: avatarImage || null,
        avatarTone,
      },
    },
    200,
  );
}
