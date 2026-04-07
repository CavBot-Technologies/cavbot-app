import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcloud founder account plan context upgrades the canonical founder workspace to premium plus", () => {
  const profileIdentity = read("lib/profileIdentity.ts");
  const planServer = read("lib/cavcloud/plan.server.ts");
  const summaryRoute = read("app/api/cavcloud/summary/route.ts");
  const dashboardRoute = read("app/api/cavcloud/dashboard/route.ts");
  const treeRoute = read("app/api/cavcloud/tree/route.ts");
  const storageServer = read("lib/cavcloud/storage.server.ts");

  assert.match(profileIdentity, /export function isCavbotFounderAccountIdentity/);
  assert.match(planServer, /isCavbotFounderAccountIdentity/);
  assert.match(planServer, /resolveRequestScopedFounderUser/);
  assert.match(planServer, /headers\(\)/);
  assert.match(planServer, /getSession\(req\)/);
  assert.match(planServer, /isCavbotFounderIdentity/);
  assert.match(planServer, /tier: "PREMIUM_PLUS"/);
  assert.match(summaryRoute, /getEffectiveAccountPlanContext/);
  assert.match(dashboardRoute, /getEffectiveAccountPlanContext/);
  assert.match(treeRoute, /getEffectiveAccountPlanContext/);
  assert.match(storageServer, /getEffectiveAccountPlanContext\(accountId, tx\)/);
});

test("cavcloud tree path fails open when optional collaboration or failed-upload metadata tables drift", () => {
  const storageServer = read("lib/cavcloud/storage.server.ts");

  assert.match(storageServer, /function isMissingNamedRelationError/);
  assert.match(storageServer, /function isOptionalTreeMetadataSchemaMismatch/);
  assert.match(storageServer, /async function loadFailedUploadMetaByFileId/);
  assert.match(storageServer, /cavcloudfolderuploadsessionfile/);
  assert.match(storageServer, /cavcloudfileaccess/);
  assert.match(storageServer, /cavcloudfolderaccess/);
  assert.match(storageServer, /const failedMetaByFileId = await loadFailedUploadMetaByFileId\(accountId, failedFileIds\)/);
});

test("cavcloud direct surface resyncs shared shell profile and plan state from cache and events", () => {
  const cavcloudClient = read("app/cavcloud/CavCloudClient.tsx");

  assert.match(cavcloudClient, /let eSync = \(\) => \{/);
  assert.match(cavcloudClient, /readCachedCavcloudProfileState\(\)/);
  assert.match(cavcloudClient, /readCachedCavcloudPlanState\(\)/);
  assert.match(cavcloudClient, /window\.addEventListener\("storage", eSync\)/);
  assert.match(cavcloudClient, /window\.addEventListener\("cb:profile", eSync\)/);
  assert.match(cavcloudClient, /window\.addEventListener\("cb:plan", eSync\)/);
});
