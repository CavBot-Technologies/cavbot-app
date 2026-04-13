import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("auth me refreshes first-party shared cookies while preserving the active session version", () => {
  const source = read("app/api/auth/me/route.ts");

  assert.match(source, /const sharedSessionCookieEnabled = Boolean\(sessionCookieOptions\(req\)\.domain\);/);
  assert.match(source, /const shouldRefreshSharedSessionCookie = Boolean\(promotedMembershipRecord\) \|\| sharedSessionCookieEnabled;/);
  assert.match(source, /function resolveIssuedSessionVersion\(value: unknown\)/);
  assert.match(source, /sessionVersion: resolveIssuedSessionVersion\(sess\.sv\),/);
});

test("auth session bootstrap also upgrades first-party cookies and preserves session versions", () => {
  const source = read("app/api/auth/session/route.ts");

  assert.match(source, /const sharedSessionCookieEnabled = Boolean\(sessionCookieOptions\(req\)\.domain\);/);
  assert.match(source, /if \(promotedMembership \|\| sharedSessionCookieEnabled\) \{/);
  assert.match(source, /sessionVersion: resolveIssuedSessionVersion\(sess\.sv\),/);
  assert.match(source, /sessionVersion: resolveIssuedSessionVersion\(userAuth\?\.sessionVersion\),/);
});

test("interactive login and challenge verification mint sessions with the stored auth session version", () => {
  const loginSource = read("app/api/auth/login/route.ts");
  const challengeSource = read("app/api/auth/challenge/verify/route.ts");

  assert.match(loginSource, /sessionVersion: resolveIssuedSessionVersion\(userAuth\.sessionVersion\),/);
  assert.match(challengeSource, /sessionVersion: resolveIssuedSessionVersion\(userAuth\?\.sessionVersion\),/);
});
