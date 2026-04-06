import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("auth me and command center stay wired to the effective CavCloud plan context", () => {
  const authMeRoute = read("app/api/auth/me/route.ts");
  const commandCenter = read("app/page.tsx");

  assert.equal(authMeRoute.includes("getCavCloudPlanContext"), true);
  assert.equal(authMeRoute.includes("cavcloudTierTokenForPlanId"), true);

  assert.equal(commandCenter.includes('fetch("/api/auth/me"'), true);
  assert.equal(commandCenter.includes('fetch("/api/cavcloud/summary"'), true);
  assert.equal(commandCenter.includes("const planKey = resolvePlanIdFromTier(meJson?.account);"), true);
  assert.equal(commandCenter.includes("trialActive: Boolean(meJson?.account?.trialActive ?? meJson?.trialActive)"), true);
});

test("cavsafe launch paths resolve limits from the shared effective account plan context", () => {
  const access = read("app/cavsafe/access.server.ts");
  const auth = read("lib/cavsafe/auth.server.ts");
  const storage = read("lib/cavsafe/storage.server.ts");
  const notifications = read("lib/cavsafe/notifications.server.ts");
  const treeRoute = read("app/api/cavsafe/tree/route.ts");

  assert.equal(access.includes("getEffectiveAccountPlanContext"), true);
  assert.equal(auth.includes("getEffectiveAccountPlanContext"), true);
  assert.equal(storage.includes("getEffectiveAccountPlanContext"), true);
  assert.equal(notifications.includes("getEffectiveAccountPlanContext"), true);
  assert.equal(treeRoute.includes("getEffectiveAccountPlanContext"), true);
  assert.equal(treeRoute.includes("CAVSAFE_MAX_FILE_BYTES_PREMIUM_PLUS"), true);
  assert.equal(treeRoute.includes("CAVSAFE_MAX_FILE_BYTES_PREMIUM"), true);
  assert.equal(treeRoute.includes("CAVSAFE_MAX_FILE_BYTES_FREE"), true);
});
