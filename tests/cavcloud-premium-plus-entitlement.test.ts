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
  assert.equal(source.includes("const ENTITLED_SUBSCRIPTION_STATUS_LIST = [\"ACTIVE\", \"TRIALING\", \"PAST_DUE\"] as const;"), true);
  assert.equal(source.includes("const ENTITLED_SUBSCRIPTION_STATUSES = new Set<string>(ENTITLED_SUBSCRIPTION_STATUS_LIST);"), true);
  assert.equal(source.includes('if (isTrialSeatEntitled(args.account, now)) return "premium_plus";'), true);
  assert.equal(
    source.includes("return PLAN_RANK[subscriptionPlanId] > PLAN_RANK[accountPlanId] ? subscriptionPlanId : accountPlanId;"),
    true,
  );
});

test("cavcloud quota and shell routes use the shared effective plan resolver", () => {
  const authMe = read("app/api/auth/me/route.ts");
  const planServer = read("lib/cavcloud/plan.server.ts");
  const summary = read("app/api/cavcloud/summary/route.ts");
  const dashboard = read("app/api/cavcloud/dashboard/route.ts");
  const tree = read("app/api/cavcloud/tree/route.ts");
  const storage = read("lib/cavcloud/storage.server.ts");
  const settings = read("app/api/cavcloud/settings/route.ts");
  const notifications = read("lib/cavcloud/notifications.server.ts");
  const collab = read("lib/cavcloud/collab.server.ts");
  const sync = read("app/api/cavcloud/sync/upsert/route.ts");

  assert.equal(authMe.includes("findLatestEntitledSubscription(effectiveAccountId)"), true);
  assert.equal(authMe.includes("planTierTokenFromPlanId(effectivePlanId)"), true);
  assert.equal(planServer.includes("resolveRequestScopedFounderUser"), false);
  assert.equal(planServer.includes("getSession(req)"), false);
  assert.equal(planServer.includes('tier: "PREMIUM_PLUS"'), false);

  assert.equal(summary.includes("getEffectiveAccountPlanContext(accountId)"), true);
  assert.equal(dashboard.includes("getEffectiveAccountPlanContext(accountId)"), true);
  assert.equal(tree.includes("getEffectiveAccountPlanContext(accountId)"), true);
  assert.equal(storage.includes("getEffectiveAccountPlanContext(accountId, tx)"), true);
  assert.equal(settings.includes("getEffectiveAccountPlanContext(accountId)"), true);
  assert.equal(notifications.includes("getEffectiveAccountPlanContext(accountId)"), true);
  assert.equal(collab.includes("getEffectiveAccountPlanContext(args.accountId, args.tx)"), true);

  assert.equal(sync.includes('findLatestEntitledSubscription(String(sess.accountId || ""))'), true);
  assert.equal(sync.includes("const planId = resolveEffectiveAccountPlanId({"), true);
});
