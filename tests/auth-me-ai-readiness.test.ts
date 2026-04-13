import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("auth me exposes explicit AI readiness without lying about degraded account fallbacks", () => {
  const source = read("app/api/auth/me/route.ts");

  assert.match(source, /capabilities: \{ aiReady: false \}/);
  assert.match(source, /const aiReady = Boolean\(accountRecord && effectiveAccountId\);/);
  assert.match(source, /AI routes require a real account context; fallback account payloads are UI-safe but not AI-safe\./);
  assert.match(source, /capabilities:\s*\{[\s\S]*aiReady,/);
  assert.match(source, /authenticated: true,\s*degraded,/);
});
