import "server-only";

import { cookies, headers } from "next/headers";

import {
  getAppOrigin,
  requireAccountContext,
  requireAccountRole,
  requireSession,
  requireUser,
  type CavbotAccountSession,
} from "@/lib/apiAuth";

export async function requireSettingsOwnerSession(req: Request): Promise<CavbotAccountSession> {
  const session = await requireSession(req);
  requireUser(session);
  requireAccountContext(session);
  requireAccountRole(session, ["OWNER"]);
  return session;
}

export async function requireSettingsOwnerFromRequestContext(pathname = "/settings"): Promise<CavbotAccountSession> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const fallback = new URL(getAppOrigin());
  const host = String(
    headerStore.get("x-forwarded-host")
      || headerStore.get("host")
      || fallback.host,
  ).trim();
  const proto = String(headerStore.get("x-forwarded-proto") || fallback.protocol.replace(/:$/, "")).trim() || "http";
  const url = `${proto}://${host}${String(pathname || "/settings")}`;
  const request = new Request(url, {
    method: "GET",
    headers: {
      cookie: cookieStore.toString(),
      "user-agent": String(headerStore.get("user-agent") || "settings-page"),
    },
  });
  return requireSettingsOwnerSession(request);
}
