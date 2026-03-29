import assert from "node:assert/strict";
import test from "node:test";

import { buildCavGuardDecision } from "@/src/lib/cavguard/cavGuard.registry";

test("qwen cooldown guard copy uses real countdown when cooldown end is present", () => {
  const decision = buildCavGuardDecision("AI_QWEN_CODER_COOLDOWN", {
    role: "MEMBER",
    plan: "PREMIUM",
    flags: {
      qwenCooldownEndsAt: new Date(Date.now() + (6 * 24 * 60 * 60 * 1000) + (14 * 60 * 60 * 1000)).toISOString(),
    },
  });

  assert.equal(decision.title, "Caven cooling down");
  assert.equal(decision.reason.includes("opens in"), true);
  assert.equal(decision.reason.includes("Upgrade to Premium+"), true);
});

test("qwen premium exhausted guard copy uses real reset date when available", () => {
  const decision = buildCavGuardDecision("AI_QWEN_CODER_PREMIUM_EXHAUSTED", {
    role: "MEMBER",
    plan: "PREMIUM",
    flags: {
      qwenResetAt: "2026-04-12T16:00:00.000Z",
    },
  });

  assert.equal(decision.title, "Premium Caven credits exhausted");
  assert.equal(decision.reason.includes("reset on"), true);
  assert.equal(decision.reason.includes("Upgrade to Premium+"), true);
});

test("qwen premium plus exhausted guard copy uses real reset date when available", () => {
  const decision = buildCavGuardDecision("AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED", {
    role: "MEMBER",
    plan: "PREMIUM_PLUS",
    flags: {
      qwenResetAt: "2026-04-12T16:00:00.000Z",
    },
  });

  assert.equal(decision.title, "Premium+ Caven credits exhausted");
  assert.equal(decision.reason.includes("reset on"), true);
});

test("qwen exhausted guard copy falls back to next billing cycle when no reset date exists", () => {
  const decision = buildCavGuardDecision("AI_QWEN_CODER_PREMIUM_EXHAUSTED", {
    role: "MEMBER",
    plan: "PREMIUM",
    flags: null,
  });

  assert.equal(decision.reason.includes("next billing cycle"), true);
});
