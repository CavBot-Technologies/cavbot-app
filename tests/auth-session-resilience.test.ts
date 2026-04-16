import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("auth me preserves authenticated shell state when account lookups degrade", () => {
  const source = read("app/api/auth/me/route.ts");

  assert.match(source, /function fallbackMembershipFromSession/);
  assert.match(source, /function buildFallbackAccountFromMembership/);
  assert.match(source, /let degraded = false;/);
  assert.match(source, /findSessionMembership\(pool, userId, accountId\)\.catch\(\(\) => \{/);
  assert.match(source, /await clearExpiredTrialSeat\(pool, effectiveAccountId\)\.catch\(\(\) => \{/);
  assert.match(source, /findAccountById\(pool, effectiveAccountId\)\.catch\(\(\) => \{/);
  assert.match(source, /findLatestEntitledSubscription\(effectiveAccountId\)\.catch\(\(\) => \{/);
  assert.match(source, /authenticated: true,\s*[\s\S]*degraded,/);
});

test("auth session bootstrap preserves cookie-backed auth on indeterminate backend failures", () => {
  const source = read("app/api/auth/session/route.ts");

  assert.match(source, /function buildDegradedBootstrapFromSession/);
  assert.match(source, /signedOut: true/);
  assert.match(source, /if \(isApiAuthError\(error\) && \(error\.status === 401 \|\| error\.status === 403\)\)/);
  assert.match(source, /const degraded = sess \? buildDegradedBootstrapFromSession\(sess\) : null;/);
  assert.match(source, /authed: true,\s*degraded: true,\s*indeterminate: true,\s*retryable: true/);
  assert.match(source, /authed: false,\s*degraded: true,\s*indeterminate: true,\s*retryable: true/);
});

test("auth me degrades from session context instead of forcing guest on unexpected backend failures", () => {
  const source = read("app/api/auth/me/route.ts");

  assert.match(source, /function buildDegradedAuthMePayloadFromSession/);
  assert.match(source, /signedOut: true/);
  assert.match(source, /const payload = buildDegradedAuthMePayloadFromSession\(sess\);/);
  assert.match(source, /authenticated: false,\s*degraded: true,\s*indeterminate: true/);
  assert.match(source, /isApiAuthError\(error\) \? \{ error: error\.code \} : \{\}/);
});

test("requireSession distinguishes auth-store outages from real auth failure", () => {
  const source = read("lib/apiAuth.ts");

  assert.match(source, /function authBackendUnavailableError\(\)/);
  assert.match(source, /function canFailOpenAuthenticatedRead\(req: Request\)/);
  assert.match(source, /new ApiAuthError\("AUTH_BACKEND_UNAVAILABLE", 503\)/);
  assert.match(source, /if \(canFailOpenAuthenticatedRead\(req\)\) return sess;/);
  assert.match(source, /if \(error instanceof ApiAuthError\) throw error;/);
  assert.match(source, /throw authBackendUnavailableError\(\);/);
});
