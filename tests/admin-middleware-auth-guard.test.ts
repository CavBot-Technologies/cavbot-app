import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { createUserSession } from "@/lib/apiAuth";
import { createAdminSessionToken } from "@/lib/admin/session";
import { middleware } from "@/middleware";

const USER_COOKIE = "cavbot_session";
const ADMIN_COOKIE = "cavbot_admin_session";

process.env.CAVBOT_SESSION_SECRET = "test-session-secret";
process.env.CAVBOT_ADMIN_SESSION_SECRET = "test-admin-session-secret";

function adminRequest(pathname: string, cookieHeader = "") {
  const headers = new Headers({
    host: "admin.localhost:3000",
  });
  if (cookieHeader) headers.set("cookie", cookieHeader);
  return new NextRequest(`http://admin.localhost:3000${pathname}`, { headers });
}

function hasClearedCookie(response: Response, name: string) {
  const nextResponse = response as Response & {
    cookies?: {
      getAll?: () => Array<{ name: string; value: string }>;
    };
  };
  return Boolean(nextResponse.cookies?.getAll?.().some((cookie) => cookie.name === name && cookie.value === ""));
}

async function buildValidCookieHeader(args?: { userId?: string; accountId?: string; memberRole?: "OWNER" | "ADMIN" | "MEMBER" }) {
  const userId = args?.userId || "user_123";
  const accountId = args?.accountId || "acct_123";
  const memberRole = args?.memberRole || "OWNER";

  const userToken = await createUserSession({
    userId,
    accountId,
    memberRole,
  });
  const adminToken = await createAdminSessionToken({
    userId,
    staffId: `staff_${userId}`,
    staffCode: "CAV-515081",
    role: "OWNER",
    stepUpMethod: "email",
  });

  return `${USER_COOKIE}=${userToken}; ${ADMIN_COOKIE}=${adminToken}`;
}

test("admin middleware redirects protected routes when stale cookies are present and clears them", async () => {
  const response = await middleware(adminRequest("/overview", `${USER_COOKIE}=bad; ${ADMIN_COOKIE}=bad`));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location")?.endsWith("/sign-in?next=%2Foverview"), true);
  assert.equal(hasClearedCookie(response, USER_COOKIE), true);
  assert.equal(hasClearedCookie(response, ADMIN_COOKIE), true);
});

test("admin middleware sends the host root to HQ sign-in instead of the shared app auth flow", async () => {
  const response = await middleware(adminRequest("/"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location")?.endsWith("/sign-in?next=%2F"), true);
});

test("admin middleware rewrites protected routes only when both validated cookies belong to the same user", async () => {
  const response = await middleware(adminRequest("/overview", await buildValidCookieHeader()));

  assert.equal(response.headers.get("x-middleware-rewrite")?.endsWith("/admin-internal/overview"), true);
  assert.equal(hasClearedCookie(response, USER_COOKIE), false);
  assert.equal(hasClearedCookie(response, ADMIN_COOKIE), false);
});

test("admin middleware rewrites the host root to the HQ internal root when admin auth is valid", async () => {
  const response = await middleware(adminRequest("/", await buildValidCookieHeader()));

  assert.equal(response.headers.get("x-middleware-rewrite")?.endsWith("/admin-internal"), true);
  assert.equal(hasClearedCookie(response, USER_COOKIE), false);
  assert.equal(hasClearedCookie(response, ADMIN_COOKIE), false);
});

test("admin middleware rejects mismatched validated user and admin cookies", async () => {
  const userToken = await createUserSession({
    userId: "user_alpha",
    accountId: "acct_123",
    memberRole: "OWNER",
  });
  const adminToken = await createAdminSessionToken({
    userId: "user_beta",
    staffId: "staff_beta",
    staffCode: "CAV-000002",
    role: "OWNER",
    stepUpMethod: "email",
  });

  const response = await middleware(
    adminRequest("/overview", `${USER_COOKIE}=${userToken}; ${ADMIN_COOKIE}=${adminToken}`),
  );

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location")?.endsWith("/sign-in?next=%2Foverview"), true);
  assert.equal(hasClearedCookie(response, USER_COOKIE), false);
  assert.equal(hasClearedCookie(response, ADMIN_COOKIE), true);
});

test("admin sign-in stays reachable with stale cookies and cleans them up instead of looping", async () => {
  const response = await middleware(adminRequest("/sign-in", `${USER_COOKIE}=bad; ${ADMIN_COOKIE}=bad`));

  assert.equal(response.headers.get("x-middleware-rewrite")?.endsWith("/admin-internal/sign-in"), true);
  assert.equal(response.headers.get("location"), null);
  assert.equal(hasClearedCookie(response, USER_COOKIE), true);
  assert.equal(hasClearedCookie(response, ADMIN_COOKIE), true);
});
