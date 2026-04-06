import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("account plan helper upgrades cavcloud to the highest live entitlement", () => {
  const source = read("lib/accountPlan.server.ts");

  assert.equal(source.includes("const PLAN_RANK: Record<PlanId, number> = {"), true);
  assert.equal(source.includes('premium_plus: 2,'), true);
  assert.equal(
    source.includes('const ENTITLED_SUBSCRIPTION_STATUSES = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);'),
    true,
  );
  assert.equal(source.includes('if (isTrialSeatEntitled(args.account, now)) return "premium_plus";'), true);
  assert.equal(
    source.includes("return PLAN_RANK[subscriptionPlanId] > PLAN_RANK[accountPlanId] ? subscriptionPlanId : accountPlanId;"),
    true,
  );
});

test("cavcloud quota and shell routes use the shared effective plan resolver", () => {
  const authMe = read("app/api/auth/me/route.ts");
  const summary = read("app/api/cavcloud/summary/route.ts");
  const dashboard = read("app/api/cavcloud/dashboard/route.ts");
  const tree = read("app/api/cavcloud/tree/route.ts");
  const storage = read("lib/cavcloud/storage.server.ts");
  const sync = read("app/api/cavcloud/sync/upsert/route.ts");

  assert.equal(authMe.includes("findLatestEntitledSubscription(accountId)"), true);
  assert.equal(authMe.includes("tierEffective: planTierTokenFromPlanId(effectivePlanId)"), true);

  assert.equal(summary.includes("findLatestEntitledSubscription(accountId)"), true);
  assert.equal(summary.includes("subscription: entitledSubscription,"), true);

  assert.equal(dashboard.includes("findLatestEntitledSubscription(accountId)"), true);
  assert.equal(dashboard.includes("subscription: entitledSubscription,"), true);

  assert.equal(tree.includes("findLatestEntitledSubscription(accountId)"), true);
  assert.equal(tree.includes("const planId: PlanId = resolveEffectiveAccountPlanId({"), true);

  assert.equal(storage.includes("findLatestEntitledSubscription(accountId, tx)"), true);
  assert.equal(storage.includes("const planId = resolveEffectiveAccountPlanId({"), true);

  assert.equal(sync.includes('findLatestEntitledSubscription(String(sess.accountId || ""))'), true);
  assert.equal(sync.includes("const planId = resolveEffectiveAccountPlanId({"), true);
});
