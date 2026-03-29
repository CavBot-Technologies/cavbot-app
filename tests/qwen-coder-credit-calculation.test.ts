import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import type { CoderCreditWallet } from "@prisma/client";

function loadQwenCreditsModule() {
  const req = createRequire(import.meta.url);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  if (!previousDatabaseUrl) {
    process.env.DATABASE_URL = "postgresql://localhost:5432/cavbot_test";
  }
  const moduleLoader = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return req(path.resolve("src/lib/ai/qwen-coder-credits.server.ts")) as typeof import("../src/lib/ai/qwen-coder-credits.server");
  } finally {
    moduleLoader._load = originalLoad;
    if (!previousDatabaseUrl) {
      delete process.env.DATABASE_URL;
    }
  }
}

const { calculateQwenCoderCredits, estimateQwenCoderCost, __qwenTestOnly } = loadQwenCreditsModule();

function buildWallet(overrides: Partial<CoderCreditWallet>): CoderCreditWallet {
  const now = new Date("2026-03-14T00:00:00.000Z");
  return {
    id: "wallet_test",
    accountId: "acct_test",
    userId: "user_test",
    planTier: "premium",
    billingCycleStart: new Date("2026-03-01T00:00:00.000Z"),
    billingCycleEnd: new Date("2026-04-01T00:00:00.000Z"),
    monthlyAllocation: 400,
    rolloverAllocation: 0,
    totalAvailable: 400,
    totalUsed: 0,
    totalRemaining: 400,
    stagedModeEnabled: true,
    stage1Allocation: 250,
    stage1Used: 0,
    stage1ExhaustedAt: null,
    cooldownEndsAt: null,
    stage2Allocation: 150,
    stage2Used: 0,
    exhaustedAt: null,
    resetSource: "billing_cycle",
    lastRecomputedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("Qwen coder credit formula applies weighted tokens, runtime, action overhead, and complexity multiplier", () => {
  const breakdown = calculateQwenCoderCredits({
    inputTokens: 25_000,
    retrievedContextTokens: 25_000,
    outputTokens: 25_000,
    compactionTokens: 10_000,
    toolRuntimeSeconds: 45,
    diffGenerated: true,
    testsRun: true,
    lintRun: true,
    typecheckRun: true,
    patchApplyAttempted: true,
    complexity: "medium",
  });

  assert.equal(breakdown.weightedTokens, 101_250);
  assert.equal(breakdown.tokenCredits, 5);
  assert.equal(breakdown.runtimeCredits, 3);
  assert.equal(breakdown.actionCredits, 5);
  assert.equal(breakdown.complexityMultiplier, 1.25);
  assert.equal(breakdown.finalCredits, 17);
});

test("Qwen coder credit formula enforces a minimum charge floor", () => {
  const breakdown = calculateQwenCoderCredits({
    inputTokens: 0,
    retrievedContextTokens: 0,
    outputTokens: 0,
    compactionTokens: 0,
    toolRuntimeSeconds: 0,
    diffGenerated: false,
    testsRun: false,
    lintRun: false,
    typecheckRun: false,
    patchApplyAttempted: false,
    complexity: "small",
  });
  assert.equal(breakdown.finalCredits, 1);
});

test("Qwen coder estimator scales higher for heavy refactor context than a tiny prompt", () => {
  const tiny = estimateQwenCoderCost({
    actionClass: "standard",
    taskType: "code_explain",
    promptText: "Explain this one error quickly.",
    contextJson: { file: "app.ts", line: 12, error: "x is undefined" },
    maxOutputChars: 1_000,
    expectedRuntimeSeconds: 8,
    repoSizeFiles: 25,
    filesTouched: 1,
    toolCount: 1,
  });

  const heavy = estimateQwenCoderCost({
    actionClass: "premium_plus_heavy_coding",
    taskType: "code_refactor",
    promptText: "Refactor this feature across modules and preserve behavior.",
    contextJson: {
      files: Array.from({ length: 180 }, (_, i) => `src/module/${i}.ts`),
      diagnostics: Array.from({ length: 90 }, (_, i) => ({ id: i, message: "warning", severity: "warn" })),
    },
    maxOutputChars: 24_000,
    expectedRuntimeSeconds: 140,
    repoSizeFiles: 5_000,
    filesTouched: 22,
    toolCount: 6,
  });

  assert.equal(heavy.finalCredits > tiny.finalCredits, true);
  assert.equal(heavy.complexityMultiplier >= tiny.complexityMultiplier, true);
});

test("Qwen plan config defaults match policy: Premium 400 with staged 250/150 and 7-day cooldown", () => {
  const premium = __qwenTestOnly.qwenPlanConfig("premium");
  assert.equal(premium.monthlyCoderCredits, 400);
  assert.equal(premium.rollover, false);
  assert.equal(premium.rolloverCap, 0);
  assert.equal(premium.premiumStagedAccessEnabled, true);
  assert.equal(premium.stage1Credits, 250);
  assert.equal(premium.stage2Credits, 150);
  assert.equal(premium.cooldownDays, 7);

  const free = __qwenTestOnly.qwenPlanConfig("free");
  assert.equal(free.monthlyCoderCredits, 0);
  assert.equal(free.rollover, false);
});

test("Qwen plan config defaults match policy: Premium+ 4000 monthly with 4000 rollover cap and 8000 max bank", () => {
  const plus = __qwenTestOnly.qwenPlanConfig("premium_plus");
  assert.equal(plus.monthlyCoderCredits, 4_000);
  assert.equal(plus.rollover, true);
  assert.equal(plus.rolloverCap, 4_000);
  assert.equal(plus.premiumStagedAccessEnabled, false);
  assert.equal(plus.cooldownDays, 0);
  assert.equal(plus.stage1Credits, 0);
  assert.equal(plus.stage2Credits, 0);
  assert.equal(plus.monthlyCoderCredits + plus.rolloverCap, 8_000);
});

test("premium staged entitlement enters cooldown after stage 1 and unlocks stage 2 after cooldown", () => {
  const now = new Date("2026-03-14T00:00:00.000Z");
  const cooldownEndsAt = new Date("2026-03-20T00:00:00.000Z");
  const stagedWallet = buildWallet({
    totalUsed: 250,
    totalRemaining: 150,
    stage1Used: 250,
    stage1ExhaustedAt: new Date("2026-03-13T12:00:00.000Z"),
    cooldownEndsAt,
    stage2Used: 0,
  });

  const duringCooldown = __qwenTestOnly.deriveEntitlement({
    wallet: stagedWallet,
    planId: "premium",
    now,
  });
  assert.equal(duringCooldown.state, "cooldown");
  assert.equal(duringCooldown.selectable, false);
  assert.equal(duringCooldown.creditsRemaining, 0);

  const afterCooldown = __qwenTestOnly.deriveEntitlement({
    wallet: stagedWallet,
    planId: "premium",
    now: new Date("2026-03-22T00:00:00.000Z"),
  });
  assert.equal(afterCooldown.state, "available");
  assert.equal(afterCooldown.stage, "stage_2");
  assert.equal(afterCooldown.selectable, true);
  assert.equal(afterCooldown.creditsRemaining, 150);
});

test("premium and premium+ entitlement states lock at zero remaining credits", () => {
  const now = new Date("2026-03-25T00:00:00.000Z");
  const premiumExhaustedWallet = buildWallet({
    totalUsed: 400,
    totalRemaining: 0,
    stage1Used: 250,
    stage2Used: 150,
    stage1ExhaustedAt: new Date("2026-03-10T00:00:00.000Z"),
    cooldownEndsAt: new Date("2026-03-17T00:00:00.000Z"),
    exhaustedAt: new Date("2026-03-24T00:00:00.000Z"),
  });
  const premiumExhausted = __qwenTestOnly.deriveEntitlement({
    wallet: premiumExhaustedWallet,
    planId: "premium",
    now,
  });
  assert.equal(premiumExhausted.state, "premium_exhausted");
  assert.equal(premiumExhausted.selectable, false);

  const plusExhaustedWallet = buildWallet({
    planTier: "premium_plus",
    monthlyAllocation: 4_000,
    totalAvailable: 4_000,
    totalUsed: 4_000,
    totalRemaining: 0,
    stagedModeEnabled: false,
    stage1Allocation: 0,
    stage1Used: 0,
    stage1ExhaustedAt: null,
    cooldownEndsAt: null,
    stage2Allocation: 0,
    stage2Used: 0,
    exhaustedAt: new Date("2026-03-24T00:00:00.000Z"),
  });
  const plusExhausted = __qwenTestOnly.deriveEntitlement({
    wallet: plusExhaustedWallet,
    planId: "premium_plus",
    now,
  });
  assert.equal(plusExhausted.state, "premium_plus_exhausted");
  assert.equal(plusExhausted.selectable, false);
});

test("failure policy maps blocked/early/partial/success reasons to expected credit outcomes", () => {
  assert.equal(__qwenTestOnly.mapFailureFinalCredits({ reason: "failure_blocked", calculatedCredits: 75 }), 0);
  assert.equal(__qwenTestOnly.mapFailureFinalCredits({ reason: "failure_early", calculatedCredits: 0 }), 0);
  assert.equal(__qwenTestOnly.mapFailureFinalCredits({ reason: "failure_early", calculatedCredits: 3 }), 1);
  assert.equal(__qwenTestOnly.mapFailureFinalCredits({ reason: "failure_partial", calculatedCredits: 10 }), 5);
  assert.equal(__qwenTestOnly.mapFailureFinalCredits({ reason: "success", calculatedCredits: 10 }), 10);
});

test("finalize settlement keeps wallet and ledger charge aligned when additional debit cannot be fully covered", () => {
  const settled = __qwenTestOnly.settleFinalizedCredits({
    reservedCredits: 20,
    targetCredits: 32,
    remainingBefore: 5,
    remainingAfter: 0,
  });

  assert.equal(settled.additionalChargedCredits, 5);
  assert.equal(settled.refundedCredits, 0);
  assert.equal(settled.settledCredits, 25);
});

test("finalize settlement computes actual refund from wallet delta", () => {
  const settled = __qwenTestOnly.settleFinalizedCredits({
    reservedCredits: 40,
    targetCredits: 12,
    remainingBefore: 20,
    remainingAfter: 48,
  });

  assert.equal(settled.additionalChargedCredits, 0);
  assert.equal(settled.refundedCredits, 28);
  assert.equal(settled.settledCredits, 12);
});
