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
  assert.match(source, /await clearExpiredTrialSeat\(pool, accountId\)\.catch\(\(\) => \{/);
  assert.match(source, /findAccountById\(pool, accountId\)\.catch\(\(\) => \{/);
  assert.match(source, /findLatestEntitledSubscription\(accountId\)\.catch\(\(\) => \{/);
  assert.match(source, /authenticated: true,\s*[\s\S]*degraded,/);
});
