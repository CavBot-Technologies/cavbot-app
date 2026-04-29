import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { computeBillingPlanResolution } from "../lib/billingPlan.server";

function read(relPath: string) {
  return fs.readFileSync(path.resolve(relPath), "utf8");
}

test("billing plan resolver prefers active subscription over stale stored account tier", () => {
  const result = computeBillingPlanResolution({
    account: {
      id: "acct_1",
      tier: "FREE",
      trialSeatActive: false,
      trialEndsAt: null,
    },
    entitledSubscription: {
      tier: "PREMIUM",
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    },
  });

  assert.equal(result.currentPlanId, "premium");
  assert.equal(result.accountPlanId, "free");
  assert.equal(result.planSource, "subscription");
  assert.equal(result.authoritative, true);
  assert.equal(result.driftDetected, true);
});

test("billing plan resolver preserves paid current plan during an active trial window", () => {
  const result = computeBillingPlanResolution({
    account: {
      id: "acct_trial",
      tier: "FREE",
      trialSeatActive: true,
      trialEndsAt: new Date(Date.now() + 86_400_000),
    },
    entitledSubscription: null,
  });

  assert.equal(result.currentPlanId, "premium_plus");
  assert.equal(result.planSource, "trial");
  assert.equal(result.authoritative, true);
  assert.equal(result.driftDetected, true);
});

test("billing summary and billing actions share the effective plan resolver", () => {
  const summaryRoute = read("app/api/billing/summary/route.ts");
  const upgradeRoute = read("app/api/billing/upgrade/route.ts");
  const downgradeRoute = read("app/api/billing/downgrade/route.ts");
  const upgradePage = read("app/settings/upgrade/page.tsx");
  const downgradePage = read("app/settings/downgrade/page.tsx");

  assert.equal(summaryRoute.includes("resolveBillingPlanResolution({"), true);
  assert.equal(summaryRoute.includes("planSource: planResolution.planSource"), true);
  assert.equal(summaryRoute.includes("authoritative: planResolution.authoritative"), true);
  assert.equal(summaryRoute.includes("withSoftTimeout("), true);
  assert.equal(summaryRoute.includes("getQwenCoderPopoverState({"), true);

  assert.equal(upgradeRoute.includes("resolveBillingPlanResolution({"), true);
  assert.equal(downgradeRoute.includes("resolveBillingPlanResolution({"), true);
  assert.equal(upgradePage.includes("resolveBillingPlanResolution({"), true);
  assert.equal(downgradePage.includes("resolveBillingPlanResolution({"), true);
});

test("billing client ignores non-authoritative fallback summaries and does not write shell snapshot state", () => {
  const source = read("app/settings/sections/BillingClient.tsx");

  assert.equal(source.includes("!s?.computed?.authoritative || !s?.account?.id"), true);
  assert.equal(source.includes("(!billingSummaryResolved ? bootPlanId : null)"), true);
  assert.equal(source.includes('label: billingSummaryResolved ? "Plan unavailable" : "Loading..."'), true);
  assert.equal(source.includes("globalThis.__cbLocalStore.setItem("), false);
});
