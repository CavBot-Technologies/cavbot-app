import assert from "node:assert/strict";
import test from "node:test";

import {
  cavcloudTierTokenForPlanId,
  cavcloudStorageLimitBytesForPlan,
  mergeCavCloudPlanAccounts,
  resolveCavCloudEffectivePlan,
} from "@/lib/cavcloud/plan";

test("uses active subscription tier when account tier is stale", () => {
  const resolved = resolveCavCloudEffectivePlan({
    account: { tier: "FREE" },
    subscription: { status: "ACTIVE", tier: "ENTERPRISE" },
  });

  assert.equal(resolved.planId, "premium_plus");
  assert.equal(resolved.trialActive, false);
  assert.equal(resolved.source, "subscription");
  assert.equal(cavcloudStorageLimitBytesForPlan(resolved.planId, { trialActive: resolved.trialActive }), 500 * 1024 * 1024 * 1024);
});

test("treats active trial seats as premium plus with unlimited CavCloud quota", () => {
  const resolved = resolveCavCloudEffectivePlan({
    account: {
      tier: "FREE",
      trialSeatActive: true,
      trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    subscription: { status: "ACTIVE", tier: "PREMIUM" },
  });

  assert.equal(resolved.planId, "premium_plus");
  assert.equal(resolved.trialActive, true);
  assert.equal(resolved.source, "trial");
  assert.equal(cavcloudStorageLimitBytesForPlan(resolved.planId, { trialActive: resolved.trialActive }), null);
});

test("keeps paid plan on past-due subscriptions", () => {
  const resolved = resolveCavCloudEffectivePlan({
    account: { tier: "FREE" },
    subscription: { status: "PAST_DUE", tier: "PREMIUM" },
  });

  assert.equal(resolved.planId, "premium");
  assert.equal(resolved.source, "subscription");
  assert.equal(cavcloudStorageLimitBytesForPlan(resolved.planId, { trialActive: resolved.trialActive }), 50 * 1024 * 1024 * 1024);
});

test("does not downgrade when the account tier is already higher than the subscription row", () => {
  const resolved = resolveCavCloudEffectivePlan({
    account: { tier: "ENTERPRISE" },
    subscription: { status: "ACTIVE", tier: "PREMIUM" },
  });

  assert.equal(resolved.planId, "premium_plus");
  assert.equal(resolved.source, "account");
});

test("falls back to account tier when there is no paid subscription", () => {
  const resolved = resolveCavCloudEffectivePlan({
    account: { tier: "PREMIUM" },
    subscription: { status: "CANCELED", tier: "ENTERPRISE" },
  });

  assert.equal(resolved.planId, "premium");
  assert.equal(resolved.source, "account");
});

test("merges account plan inputs without dropping the higher tier", () => {
  const merged = mergeCavCloudPlanAccounts(
    { tier: "FREE", trialSeatActive: false, trialEndsAt: null },
    { tier: "ENTERPRISE", trialSeatActive: false, trialEndsAt: null },
  );

  assert.equal(merged?.tier, "ENTERPRISE");
  assert.equal(merged?.trialSeatActive, false);
});

test("maps CavCloud plan ids back to auth tier tokens", () => {
  assert.equal(cavcloudTierTokenForPlanId("free"), "FREE");
  assert.equal(cavcloudTierTokenForPlanId("premium"), "PREMIUM");
  assert.equal(cavcloudTierTokenForPlanId("premium_plus"), "PREMIUM_PLUS");
});
