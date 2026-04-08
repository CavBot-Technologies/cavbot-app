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

test("tree, summary, and dashboard degraded helpers do not fail when plan lookups fail", () => {
  const tree = read("app/api/cavcloud/tree/route.ts");
  const summary = read("app/api/cavcloud/summary/route.ts");
  const dashboard = read("app/api/cavcloud/dashboard/route.ts");
  const plan = read("lib/accountPlan.server.ts");

  assert.match(tree, /getEffectiveAccountPlanContext\(accountId\)\.catch\(\(\) => null\)/);
  assert.match(summary, /getEffectiveAccountPlanContext\(accountId\)\.catch\(\(\) => null\)/);
  assert.match(dashboard, /getEffectiveAccountPlanContext\(accountId\)\.catch\(\(\) => null\)/);
  assert.match(plan, /function isSubscriptionLookupSoftFailure/);
  assert.match(plan, /if \(isSubscriptionLookupSoftFailure\(error\)\) return null;/);
});

test("collab and shares GET routes degrade to empty payloads on backend outages", () => {
  const collab = read("app/api/cavcloud/collab/route.ts");
  const shares = read("app/api/cavcloud/shares/route.ts");

  assert.match(collab, /async function buildDegradedCollabResponse/);
  assert.match(collab, /isCavCloudServiceUnavailableError\(err\) \|\| isCavCloudCollabSchemaMismatch\(err\)/);
  assert.match(collab, /return await buildDegradedCollabResponse\(req, filter\)/);
  assert.match(collab, /degraded:\s*true/);
  assert.match(shares, /async function buildDegradedSharesResponse/);
  assert.match(shares, /isCavCloudServiceUnavailableError\(e\) \|\| isCavCloudShareSchemaMismatch\(e\)/);
  assert.match(shares, /return await buildDegradedSharesResponse\(req\)/);
  assert.match(shares, /degraded:\s*true/);
});

test("cavcloud storage activity writes fail open when non-critical activity tables lag schema", () => {
  const storage = read("lib/cavcloud/storage.server.ts");
  const folders = read("app/api/cavcloud/folders/route.ts");

  assert.match(storage, /function isMissingActivityTableError/);
  assert.match(storage, /function isActivitySchemaMismatchError/);
  assert.match(storage, /if \(!isMissingActivityTableError\(err\) && !isActivitySchemaMismatchError\(err\)\) throw err;/);
  assert.match(storage, /if \(isMissingActivityTableError\(err\) \|\| isActivitySchemaMismatchError\(err\)\) return \[\];/);
  assert.match(storage, /await writeActivity\(prisma, \{/);
  assert.doesNotMatch(storage, /prisma\.cavCloudActivity\.create/);
  assert.match(folders, /function isCavCloudFolderWriteSchemaMismatch/);
  assert.match(folders, /SERVICE_UNAVAILABLE/);
});
