import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcloud HTTP helpers preserve service-unavailable responses", () => {
  const source = read("lib/cavcloud/http.server.ts");

  assert.match(source, /export function isCavCloudServiceUnavailableError/);
  assert.match(source, /error:\s*"SERVICE_UNAVAILABLE"/);
  assert.match(source, /status === 502 \|\| status === 503 \|\| status === 504/);
});

test("tree and summary degraded helpers do not fail when plan lookups fail", () => {
  const tree = read("app/api/cavcloud/tree/route.ts");
  const summary = read("app/api/cavcloud/summary/route.ts");

  assert.match(tree, /getEffectiveAccountPlanContext\(accountId\)\.catch\(\(\) => null\)/);
  assert.match(summary, /getEffectiveAccountPlanContext\(accountId\)\.catch\(\(\) => null\)/);
});

test("collab and shares GET routes degrade to empty payloads on backend outages", () => {
  const collab = read("app/api/cavcloud/collab/route.ts");
  const shares = read("app/api/cavcloud/shares/route.ts");

  assert.match(collab, /isCavCloudServiceUnavailableError\(err\) \|\| isCavCloudCollabSchemaMismatch\(err\)/);
  assert.match(collab, /degraded:\s*true/);
  assert.match(shares, /isCavCloudServiceUnavailableError\(e\) \|\| isCavCloudShareSchemaMismatch\(e\)/);
  assert.match(shares, /degraded:\s*true/);
});
