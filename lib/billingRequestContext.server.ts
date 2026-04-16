import "server-only";

import { cookies, headers } from "next/headers";

import { getAppOrigin } from "@/lib/apiAuth";

function normalizePathname(pathname: string) {
  const trimmed = String(pathname || "/").trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export async function buildRequestFromCurrentContext(pathname: string, method = "POST") {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const fallback = new URL(getAppOrigin());
  const host = String(headerStore.get("x-forwarded-host") || headerStore.get("host") || fallback.host).trim() || fallback.host;
  const proto = String(headerStore.get("x-forwarded-proto") || fallback.protocol.replace(/:$/, "")).trim() || "https";
  const requestOrigin = `${proto}://${host}`;
  const allowedOrigin = fallback.origin;

  return new Request(`${requestOrigin}${normalizePathname(pathname)}`, {
    method: String(method || "POST").toUpperCase(),
    headers: {
      cookie: cookieStore.toString(),
      origin: allowedOrigin,
      "x-forwarded-host": host,
      "x-forwarded-proto": proto,
      "user-agent": String(headerStore.get("user-agent") || "billing-server-action"),
    },
  });
}
