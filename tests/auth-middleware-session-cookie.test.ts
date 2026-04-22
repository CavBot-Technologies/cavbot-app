import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

function base64urlEncode(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildUserSessionToken(secret: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    sub: "user_123",
    systemRole: "user",
    accountId: "account_123",
    memberRole: "OWNER",
    iat: now,
    exp: now + 60 * 60,
  };
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${payloadB64}.${sig}`;
}

function request(url: string, cookieHeader = "") {
  const headers = new Headers({
    host: "app.cavbot.io",
  });
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  return new NextRequest(url, {
    headers,
  });
}

test("middleware accepts the valid session when a stale duplicate cookie appears first", async () => {
  const previousSecret = process.env.CAVBOT_SESSION_SECRET;
  process.env.CAVBOT_SESSION_SECRET = "test-session-secret";
  try {
    const validToken = buildUserSessionToken(process.env.CAVBOT_SESSION_SECRET);
    const response = await middleware(
      request(
        "https://app.cavbot.io/console",
        `cavbot_session=stale.invalid; cavbot_session=${validToken}`,
      ),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
  } finally {
    process.env.CAVBOT_SESSION_SECRET = previousSecret;
  }
});

test("middleware redirects protected routes to explicit login mode when no session is present", async () => {
  const response = await middleware(request("https://app.cavbot.io/console"));

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://app.cavbot.io/auth?mode=login&next=%2Fconsole",
  );
});
