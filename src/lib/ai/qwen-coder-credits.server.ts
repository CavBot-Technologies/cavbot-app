import "server-only";

import { Prisma } from "@prisma/client";
import type { CoderCreditLedger, CoderCreditWallet, SubscriptionStatus } from "@prisma/client";

import { type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { ALIBABA_QWEN_CODER_MODEL_ID } from "@/src/lib/ai/model-catalog";

type Tx = Prisma.TransactionClient;

export type QwenCoderComplexity = "small" | "medium" | "heavy" | "agentic";

export type QwenCoderUsageMetrics = {
  inputTokens: number;
  retrievedContextTokens: number;
  outputTokens: number;
  compactionTokens: number;
  toolRuntimeSeconds: number;
  diffGenerated?: boolean;
  testsRun?: boolean;
  lintRun?: boolean;
  typecheckRun?: boolean;
  patchApplyAttempted?: boolean;
  complexity: QwenCoderComplexity;
};

export type QwenCoderCostBreakdown = {
  weightedTokens: number;
  tokenCredits: number;
  runtimeCredits: number;
  actionCredits: number;
  complexityMultiplier: number;
  finalCredits: number;
};

export type QwenCoderEstimateRequest = {
  actionClass?: string | null;
  taskType?: string | null;
  promptText?: string | null;
  contextJson?: Record<string, unknown> | null;
  maxOutputChars?: number | null;
  expectedRuntimeSeconds?: number | null;
  repoSizeFiles?: number | null;
  filesTouched?: number | null;
  toolCount?: number | null;
};

export type QwenCoderEntitlementState =
  | "available"
  | "locked_free"
  | "cooldown"
  | "premium_exhausted"
  | "premium_plus_exhausted";

export type QwenCoderEntitlement = {
  state: QwenCoderEntitlementState;
  selectable: boolean;
  planId: PlanId;
  planLabel: "Premium" | "Premium+" | "Free";
  creditsUsed: number;
  creditsRemaining: number;
  totalAvailable: number;
  totalRemaining: number;
  percentUsed: number;
  percentRemaining: number;
  stage: "stage_1" | "stage_2" | null;
  billingCycleStart: Date;
  billingCycleEnd: Date;
  resetAt: Date;
  cooldownEndsAt: Date | null;
  warningLevel: 50 | 75 | 90 | 100 | null;
  nextActionId:
    | "AI_QWEN_CODER_UNLOCK_REQUIRED"
    | "AI_QWEN_CODER_COOLDOWN"
    | "AI_QWEN_CODER_PREMIUM_EXHAUSTED"
    | "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED"
    | null;
};

export type QwenCoderReservation = {
  ledgerId: string;
  requestId: string;
  reservedCredits: number;
  estimatedCredits: number;
  walletId: string;
};

export type QwenCoderReserveResult =
  | { ok: true; reservation: QwenCoderReservation; entitlement: QwenCoderEntitlement }
  | { ok: false; code: "ENTITLEMENT_BLOCKED" | "INSUFFICIENT_CREDITS"; entitlement: QwenCoderEntitlement };

export type QwenCoderFinalizeInput = {
  accountId: string;
  userId: string;
  requestId: string;
  modelName: string;
  conversationId?: string | null;
  taskId?: string | null;
  usage: QwenCoderUsageMetrics;
  reason?: "success" | "failure_partial" | "failure_early" | "failure_blocked";
};

export type QwenCoderFinalizeResult = {
  ok: boolean;
  ledgerId: string | null;
  finalCredits: number;
  refundedCredits: number;
  chargedCredits: number;
};

export type QwenCoderPopoverState = {
  planId: PlanId;
  planLabel: "Free" | "Premium" | "Premium+";
  entitlement: QwenCoderEntitlement;
  billingCycleStart: string;
  billingCycleEnd: string;
  resetAt: string;
  cooldownEndsAt: string | null;
  usage: {
    creditsUsed: number;
    creditsLeft: number;
    creditsTotal: number;
    percentUsed: number;
    percentRemaining: number;
  };
  contextWindow: {
    currentTokens: number;
    maxTokens: number;
    percentFull: number;
    compactionCount: number;
  } | null;
  recentUsage: Array<{
    requestId: string;
    modelName: string;
    creditsCharged: number;
    createdAt: string;
    chargeState: string;
  }>;
};

type QwenPlanConfig = {
  monthlyCoderCredits: number;
  rollover: boolean;
  rolloverCap: number;
  premiumStagedAccessEnabled: boolean;
  stage1Credits: number;
  cooldownDays: number;
  stage2Credits: number;
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function asInt(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(0, Math.trunc(fallback));
  return Math.max(0, Math.trunc(parsed));
}

function asFloat(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function envInt(name: string, fallback: number): number {
  return asInt(process.env[name], fallback);
}

function envFloat(name: string, fallback: number): number {
  return asFloat(process.env[name], fallback);
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = s(process.env[name]).toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function utcMonthWindow(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

function isTrialActive(trialSeatActive: boolean | null | undefined, trialEndsAt: Date | null | undefined): boolean {
  if (!trialSeatActive || !trialEndsAt) return false;
  return new Date(trialEndsAt).getTime() > Date.now();
}

function planLabel(planId: PlanId): "Premium" | "Premium+" | "Free" {
  if (planId === "premium_plus") return "Premium+";
  if (planId === "premium") return "Premium";
  return "Free";
}

function qwenPlanConfig(planId: PlanId): QwenPlanConfig {
  if (planId === "premium_plus") {
    const monthlyCoderCredits = Math.max(1, envInt("QWEN_CODER_PREMIUM_PLUS_MONTHLY_CREDITS", 4_000));
    const rolloverCap = Math.max(0, envInt("QWEN_CODER_PREMIUM_PLUS_ROLLOVER_CAP", 4_000));
    return {
      monthlyCoderCredits,
      rollover: envBool("QWEN_CODER_PREMIUM_PLUS_ROLLOVER_ENABLED", true),
      rolloverCap,
      premiumStagedAccessEnabled: false,
      stage1Credits: 0,
      cooldownDays: 0,
      stage2Credits: 0,
    };
  }
  if (planId === "premium") {
    const monthlyCoderCredits = Math.max(1, envInt("QWEN_CODER_PREMIUM_MONTHLY_CREDITS", 400));
    const stage1CreditsDefault = Math.min(monthlyCoderCredits, envInt("QWEN_CODER_PREMIUM_STAGE1_CREDITS", 250));
    const stage2CreditsDefault = Math.max(0, monthlyCoderCredits - stage1CreditsDefault);
    return {
      monthlyCoderCredits,
      rollover: envBool("QWEN_CODER_PREMIUM_ROLLOVER_ENABLED", false),
      rolloverCap: 0,
      premiumStagedAccessEnabled: envBool("QWEN_CODER_PREMIUM_STAGED_ACCESS_ENABLED", true),
      stage1Credits: stage1CreditsDefault,
      cooldownDays: Math.max(0, envInt("QWEN_CODER_PREMIUM_COOLDOWN_DAYS", 7)),
      stage2Credits: Math.max(0, envInt("QWEN_CODER_PREMIUM_STAGE2_CREDITS", stage2CreditsDefault)),
    };
  }
  return {
    monthlyCoderCredits: 0,
    rollover: false,
    rolloverCap: 0,
    premiumStagedAccessEnabled: false,
    stage1Credits: 0,
    cooldownDays: 0,
    stage2Credits: 0,
  };
}

const CREDIT_CONFIG = {
  inputTokenWeight: envFloat("QWEN_CODER_INPUT_TOKEN_WEIGHT", 1.0),
  retrievedContextWeight: envFloat("QWEN_CODER_RETRIEVED_CONTEXT_WEIGHT", 1.25),
  outputTokenWeight: envFloat("QWEN_CODER_OUTPUT_TOKEN_WEIGHT", 1.5),
  compactionWeight: envFloat("QWEN_CODER_COMPACTION_WEIGHT", 0.75),
  tokenCreditUnit: Math.max(1, envInt("QWEN_CODER_TOKEN_CREDIT_UNIT", 25_000)),
  runtimeCreditSeconds: Math.max(1, envInt("QWEN_CODER_RUNTIME_CREDIT_SECONDS", 20)),
  minimumChargePerRun: Math.max(1, envInt("QWEN_CODER_MINIMUM_CHARGE_PER_RUN", 1)),
  actionCredits: {
    diffGenerated: Math.max(0, envInt("QWEN_CODER_ACTION_CREDIT_DIFF_GENERATED", 1)),
    testsRun: Math.max(0, envInt("QWEN_CODER_ACTION_CREDIT_TESTS_RUN", 1)),
    lintRun: Math.max(0, envInt("QWEN_CODER_ACTION_CREDIT_LINT_RUN", 1)),
    typecheckRun: Math.max(0, envInt("QWEN_CODER_ACTION_CREDIT_TYPECHECK_RUN", 1)),
    patchApplyAttempted: Math.max(0, envInt("QWEN_CODER_ACTION_CREDIT_PATCH_APPLY_ATTEMPTED", 1)),
  },
  complexityMultiplier: {
    small: envFloat("QWEN_CODER_COMPLEXITY_SMALL_MULTIPLIER", 1.0),
    medium: envFloat("QWEN_CODER_COMPLEXITY_MEDIUM_MULTIPLIER", 1.25),
    heavy: envFloat("QWEN_CODER_COMPLEXITY_HEAVY_MULTIPLIER", 1.5),
    agentic: envFloat("QWEN_CODER_COMPLEXITY_AGENTIC_MULTIPLIER", 2.0),
  },
  charsPerToken: Math.max(1, envInt("QWEN_CODER_ESTIMATION_CHARS_PER_TOKEN", 4)),
  maxContextTokens: Math.max(1, envInt("QWEN_CODER_MAX_CONTEXT_TOKENS", 258_000)),
};

function estimateTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.max(0, Math.ceil(chars / CREDIT_CONFIG.charsPerToken));
}

function jsonLength(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function complexityMultiplier(complexity: QwenCoderComplexity): number {
  return CREDIT_CONFIG.complexityMultiplier[complexity];
}

function inferComplexityFromEstimate(args: {
  actionClass?: string | null;
  taskType?: string | null;
  retrievedContextTokens: number;
  toolCount: number;
  repoSizeFiles: number;
  filesTouched: number;
}): QwenCoderComplexity {
  const actionClass = s(args.actionClass).toLowerCase();
  const taskType = s(args.taskType).toLowerCase();
  const heavyAction = actionClass.includes("heavy_coding") || actionClass.includes("research");
  const heavyTask =
    taskType.includes("refactor")
    || taskType.includes("code_generate")
    || taskType.includes("code_fix")
    || taskType.includes("code_review");
  if (
    args.retrievedContextTokens >= 90_000
    || args.toolCount >= 5
    || args.filesTouched >= 14
    || args.repoSizeFiles >= 4_000
  ) {
    return "agentic";
  }
  if (
    args.retrievedContextTokens >= 30_000
    || args.toolCount >= 3
    || args.filesTouched >= 7
    || heavyAction
    || heavyTask
  ) {
    return "heavy";
  }
  if (args.retrievedContextTokens >= 10_000 || args.toolCount >= 2 || args.filesTouched >= 3) {
    return "medium";
  }
  return "small";
}

function warningLevel(percentUsed: number): 50 | 75 | 90 | 100 | null {
  if (percentUsed >= 100) return 100;
  if (percentUsed >= 90) return 90;
  if (percentUsed >= 75) return 75;
  if (percentUsed >= 50) return 50;
  return null;
}

function cycleDateIso(date: Date): string {
  return new Date(date).toISOString();
}

function toPercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  const value = (Math.max(0, numerator) / denominator) * 100;
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function nextCooldownDate(exhaustedAt: Date, cooldownDays: number): Date {
  return new Date(exhaustedAt.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
}

function applyCreditCharge(args: {
  wallet: CoderCreditWallet;
  credits: number;
  now: Date;
  planId: PlanId;
}): Partial<CoderCreditWallet> {
  const credits = Math.max(0, Math.trunc(args.credits));
  if (credits <= 0) {
    return {
      lastRecomputedAt: args.now,
    };
  }
  const wallet = args.wallet;
  const planCfg = qwenPlanConfig(args.planId);
  let totalUsed = Math.max(0, wallet.totalUsed);
  let totalRemaining = Math.max(0, wallet.totalRemaining);
  let stage1Used = Math.max(0, wallet.stage1Used);
  let stage2Used = Math.max(0, wallet.stage2Used);
  let stage1ExhaustedAt = wallet.stage1ExhaustedAt;
  let cooldownEndsAt = wallet.cooldownEndsAt;
  let exhaustedAt = wallet.exhaustedAt;

  let toSpend = Math.min(credits, totalRemaining);

  if (wallet.stagedModeEnabled && args.planId === "premium") {
    const stage1Remaining = Math.max(0, wallet.stage1Allocation - stage1Used);
    if (stage1Remaining > 0) {
      const useStage1 = Math.min(stage1Remaining, toSpend);
      stage1Used += useStage1;
      totalUsed += useStage1;
      totalRemaining -= useStage1;
      toSpend -= useStage1;
      if (stage1Used >= wallet.stage1Allocation && !stage1ExhaustedAt) {
        stage1ExhaustedAt = args.now;
        cooldownEndsAt = planCfg.cooldownDays > 0
          ? nextCooldownDate(args.now, planCfg.cooldownDays)
          : args.now;
      }
    }
    if (toSpend > 0) {
      const stage2Remaining = Math.max(0, wallet.stage2Allocation - stage2Used);
      const useStage2 = Math.min(stage2Remaining, toSpend);
      stage2Used += useStage2;
      totalUsed += useStage2;
      totalRemaining -= useStage2;
      toSpend -= useStage2;
    }
  } else {
    totalUsed += toSpend;
    totalRemaining -= toSpend;
    toSpend = 0;
  }

  if (totalRemaining <= 0 && !exhaustedAt) {
    exhaustedAt = args.now;
  }

  return {
    totalUsed,
    totalRemaining,
    stage1Used,
    stage2Used,
    stage1ExhaustedAt,
    cooldownEndsAt,
    exhaustedAt,
    lastRecomputedAt: args.now,
  };
}

function applyCreditRefund(args: {
  wallet: CoderCreditWallet;
  refundCredits: number;
  now: Date;
  planId: PlanId;
}): Partial<CoderCreditWallet> {
  const refundCredits = Math.max(0, Math.trunc(args.refundCredits));
  if (refundCredits <= 0) {
    return { lastRecomputedAt: args.now };
  }
  const wallet = args.wallet;
  const maxRefund = Math.min(refundCredits, Math.max(0, wallet.totalUsed));
  let totalUsed = Math.max(0, wallet.totalUsed) - maxRefund;
  let totalRemaining = Math.max(0, wallet.totalRemaining) + maxRefund;
  const totalCap = Math.max(0, wallet.totalAvailable);
  if (totalRemaining > totalCap) {
    totalRemaining = totalCap;
    totalUsed = Math.max(0, totalCap - totalRemaining);
  }

  let stage1Used = Math.max(0, wallet.stage1Used);
  let stage2Used = Math.max(0, wallet.stage2Used);
  let refundable = maxRefund;
  if (wallet.stagedModeEnabled && args.planId === "premium") {
    const stage2Refund = Math.min(stage2Used, refundable);
    stage2Used -= stage2Refund;
    refundable -= stage2Refund;
    if (refundable > 0) {
      const stage1Refund = Math.min(stage1Used, refundable);
      stage1Used -= stage1Refund;
      refundable -= stage1Refund;
    }
  }

  const stage1ExhaustedAt = stage1Used < wallet.stage1Allocation ? null : wallet.stage1ExhaustedAt;
  const exhaustedAt = totalRemaining > 0 ? null : wallet.exhaustedAt;

  return {
    totalUsed,
    totalRemaining,
    stage1Used,
    stage2Used,
    stage1ExhaustedAt,
    exhaustedAt,
    lastRecomputedAt: args.now,
  };
}

function deriveEntitlement(args: {
  wallet: CoderCreditWallet;
  planId: PlanId;
  now: Date;
}): QwenCoderEntitlement {
  const { wallet, planId, now } = args;
  const totalAvailable = Math.max(0, wallet.totalAvailable);
  const totalUsed = Math.max(0, wallet.totalUsed);
  const totalRemaining = Math.max(0, wallet.totalRemaining);

  if (planId === "free") {
    return {
      state: "locked_free",
      selectable: false,
      planId,
      planLabel: planLabel(planId),
      creditsUsed: 0,
      creditsRemaining: 0,
      totalAvailable: 0,
      totalRemaining: 0,
      percentUsed: 0,
      percentRemaining: 0,
      stage: null,
      billingCycleStart: wallet.billingCycleStart,
      billingCycleEnd: wallet.billingCycleEnd,
      resetAt: wallet.billingCycleEnd,
      cooldownEndsAt: null,
      warningLevel: null,
      nextActionId: "AI_QWEN_CODER_UNLOCK_REQUIRED",
    };
  }

  let state: QwenCoderEntitlementState = "available";
  let selectable = true;
  let creditsRemaining = totalRemaining;
  let stage: "stage_1" | "stage_2" | null = null;
  let nextActionId: QwenCoderEntitlement["nextActionId"] = null;

  if (planId === "premium" && wallet.stagedModeEnabled) {
    const stage1Remaining = Math.max(0, wallet.stage1Allocation - wallet.stage1Used);
    const stage2Remaining = Math.max(0, wallet.stage2Allocation - wallet.stage2Used);
    if (stage1Remaining > 0) {
      stage = "stage_1";
      creditsRemaining = Math.min(totalRemaining, stage1Remaining);
    } else {
      const cooldownEndsAt = wallet.cooldownEndsAt;
      const cooldownActive = Boolean(cooldownEndsAt && cooldownEndsAt.getTime() > now.getTime() && stage2Remaining > 0);
      if (cooldownActive) {
        state = "cooldown";
        selectable = false;
        creditsRemaining = 0;
        nextActionId = "AI_QWEN_CODER_COOLDOWN";
      } else if (stage2Remaining > 0 && totalRemaining > 0) {
        stage = "stage_2";
        creditsRemaining = Math.min(totalRemaining, stage2Remaining);
      } else {
        state = "premium_exhausted";
        selectable = false;
        creditsRemaining = 0;
        nextActionId = "AI_QWEN_CODER_PREMIUM_EXHAUSTED";
      }
    }
  } else if (totalRemaining <= 0) {
    selectable = false;
    creditsRemaining = 0;
    if (planId === "premium_plus") {
      state = "premium_plus_exhausted";
      nextActionId = "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED";
    } else {
      state = "premium_exhausted";
      nextActionId = "AI_QWEN_CODER_PREMIUM_EXHAUSTED";
    }
  }

  if (planId === "premium_plus" && totalRemaining <= 0) {
    state = "premium_plus_exhausted";
    nextActionId = "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED";
  }

  const percentUsed = totalAvailable > 0 ? toPercent(totalUsed, totalAvailable) : 0;
  const percentRemaining = Math.max(0, Number((100 - percentUsed).toFixed(2)));

  return {
    state,
    selectable,
    planId,
    planLabel: planLabel(planId),
    creditsUsed: totalUsed,
    creditsRemaining: Math.max(0, creditsRemaining),
    totalAvailable,
    totalRemaining,
    percentUsed,
    percentRemaining,
    stage,
    billingCycleStart: wallet.billingCycleStart,
    billingCycleEnd: wallet.billingCycleEnd,
    resetAt: wallet.billingCycleEnd,
    cooldownEndsAt: wallet.cooldownEndsAt || null,
    warningLevel: warningLevel(percentUsed),
    nextActionId,
  };
}

async function resolveBillingHealth(args: {
  tx: Tx;
  accountId: string;
  planId: PlanId;
  now: Date;
}): Promise<{ canReplenish: boolean }> {
  if (args.planId === "free") return { canReplenish: false };
  const account = await args.tx.account.findUnique({
    where: { id: args.accountId },
    select: {
      trialSeatActive: true,
      trialEndsAt: true,
    },
  });
  if (isTrialActive(account?.trialSeatActive, account?.trialEndsAt)) {
    return { canReplenish: true };
  }
  const subscription = await args.tx.subscription.findFirst({
    where: { accountId: args.accountId },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  const status = s(subscription?.status).toUpperCase() as SubscriptionStatus | "";
  return { canReplenish: status === "ACTIVE" || status === "TRIALING" };
}

async function upsertUsageSnapshotTx(args: {
  tx: Tx;
  wallet: CoderCreditWallet;
}): Promise<void> {
  const wallet = args.wallet;
  const percentUsed = wallet.totalAvailable > 0 ? toPercent(wallet.totalUsed, wallet.totalAvailable) : 0;
  const percentRemaining = Math.max(0, Number((100 - percentUsed).toFixed(2)));
  const finalizedCount = await args.tx.coderCreditLedger.count({
    where: {
      walletId: wallet.id,
      chargeState: { in: ["FINALIZED", "ADJUSTED"] },
    },
  });
  const average = finalizedCount > 0 ? Math.max(1, Math.ceil(wallet.totalUsed / finalizedCount)) : 8;
  const estimatedTasksLeft = Math.max(0, Math.floor(wallet.totalRemaining / Math.max(1, average)));

  await args.tx.coderUsageSnapshot.upsert({
    where: {
      coder_usage_snapshot_cycle_unique: {
        accountId: wallet.accountId,
        userId: wallet.userId,
        billingCycleStart: wallet.billingCycleStart,
      },
    },
    create: {
      walletId: wallet.id,
      accountId: wallet.accountId,
      userId: wallet.userId,
      billingCycleStart: wallet.billingCycleStart,
      percentUsed,
      percentRemaining,
      estimatedTasksLeft,
    },
    update: {
      walletId: wallet.id,
      percentUsed,
      percentRemaining,
      estimatedTasksLeft,
      updatedAt: new Date(),
    },
  });
}

async function ensureWalletTx(args: {
  tx: Tx;
  accountId: string;
  userId: string;
  planId: PlanId;
  now: Date;
}): Promise<CoderCreditWallet> {
  const { start, end } = utcMonthWindow(args.now);
  const existing = await args.tx.coderCreditWallet.findUnique({
    where: {
      coder_wallet_cycle_unique: {
        accountId: args.accountId,
        userId: args.userId,
        billingCycleStart: start,
        billingCycleEnd: end,
      },
    },
  });
  if (existing) return existing;

  const planCfg = qwenPlanConfig(args.planId);
  const billing = await resolveBillingHealth({
    tx: args.tx,
    accountId: args.accountId,
    planId: args.planId,
    now: args.now,
  });
  const previous = await args.tx.coderCreditWallet.findFirst({
    where: {
      accountId: args.accountId,
      userId: args.userId,
      billingCycleEnd: { lte: start },
    },
    orderBy: [{ billingCycleEnd: "desc" }],
  });

  const monthlyAllocation = args.planId === "free"
    ? 0
    : billing.canReplenish
      ? planCfg.monthlyCoderCredits
      : 0;

  let rolloverAllocation = 0;
  if (planCfg.rollover && previous) {
    rolloverAllocation = Math.min(planCfg.rolloverCap, Math.max(0, previous.totalRemaining));
  }
  if (args.planId !== "premium_plus") {
    rolloverAllocation = 0;
  }

  const totalAvailable = Math.max(0, monthlyAllocation + rolloverAllocation);
  const stagedModeEnabled = args.planId === "premium" && planCfg.premiumStagedAccessEnabled;
  const stage1Allocation = stagedModeEnabled
    ? Math.min(monthlyAllocation, planCfg.stage1Credits)
    : 0;
  const stage2Allocation = stagedModeEnabled
    ? Math.max(0, monthlyAllocation - stage1Allocation)
    : 0;

  try {
    return await args.tx.coderCreditWallet.create({
      data: {
        accountId: args.accountId,
        userId: args.userId,
        planTier: args.planId,
        billingCycleStart: start,
        billingCycleEnd: end,
        monthlyAllocation,
        rolloverAllocation,
        totalAvailable,
        totalUsed: 0,
        totalRemaining: totalAvailable,
        stagedModeEnabled,
        stage1Allocation,
        stage1Used: 0,
        stage2Allocation,
        stage2Used: 0,
        resetSource: billing.canReplenish ? "billing_cycle" : "billing_unpaid",
        lastRecomputedAt: args.now,
      },
    });
  } catch {
    const concurrent = await args.tx.coderCreditWallet.findUnique({
      where: {
        coder_wallet_cycle_unique: {
          accountId: args.accountId,
          userId: args.userId,
          billingCycleStart: start,
          billingCycleEnd: end,
        },
      },
    });
    if (concurrent) return concurrent;
    throw new Error("QWEN_WALLET_CREATE_FAILED");
  }
}

function mapFailureFinalCredits(args: {
  reason: "success" | "failure_partial" | "failure_early" | "failure_blocked";
  calculatedCredits: number;
}): number {
  if (args.reason === "failure_blocked") return 0;
  if (args.reason === "failure_early") return Math.min(1, Math.max(0, args.calculatedCredits));
  if (args.reason === "failure_partial") return Math.max(1, Math.ceil(args.calculatedCredits * 0.5));
  return Math.max(1, args.calculatedCredits);
}

function settleFinalizedCredits(args: {
  reservedCredits: number;
  targetCredits: number;
  remainingBefore: number;
  remainingAfter: number;
}): {
  settledCredits: number;
  refundedCredits: number;
  additionalChargedCredits: number;
} {
  const reservedCredits = Math.max(0, Math.trunc(args.reservedCredits));
  const targetCredits = Math.max(0, Math.trunc(args.targetCredits));
  const remainingBefore = Math.max(0, Math.trunc(args.remainingBefore));
  const remainingAfter = Math.max(0, Math.trunc(args.remainingAfter));

  if (targetCredits < reservedCredits) {
    const expectedRefund = reservedCredits - targetCredits;
    const actualRefund = Math.max(0, remainingAfter - remainingBefore);
    const refundedCredits = Math.min(expectedRefund, actualRefund);
    return {
      settledCredits: Math.max(0, reservedCredits - refundedCredits),
      refundedCredits,
      additionalChargedCredits: 0,
    };
  }

  if (targetCredits > reservedCredits) {
    const expectedAdditional = targetCredits - reservedCredits;
    const actualAdditional = Math.max(0, remainingBefore - remainingAfter);
    const additionalChargedCredits = Math.min(expectedAdditional, actualAdditional);
    return {
      settledCredits: reservedCredits + additionalChargedCredits,
      refundedCredits: 0,
      additionalChargedCredits,
    };
  }

  return {
    settledCredits: reservedCredits,
    refundedCredits: 0,
    additionalChargedCredits: 0,
  };
}

export function calculateQwenCoderCredits(metrics: QwenCoderUsageMetrics): QwenCoderCostBreakdown {
  const weightedTokens =
    Math.max(0, metrics.inputTokens)
    + (Math.max(0, metrics.retrievedContextTokens) * CREDIT_CONFIG.retrievedContextWeight)
    + (Math.max(0, metrics.outputTokens) * CREDIT_CONFIG.outputTokenWeight)
    + (Math.max(0, metrics.compactionTokens) * CREDIT_CONFIG.compactionWeight);

  const tokenCredits = Math.ceil(weightedTokens / CREDIT_CONFIG.tokenCreditUnit);
  const runtimeCredits = Math.ceil(Math.max(0, metrics.toolRuntimeSeconds) / CREDIT_CONFIG.runtimeCreditSeconds);
  const actionCredits =
    (metrics.diffGenerated ? CREDIT_CONFIG.actionCredits.diffGenerated : 0)
    + (metrics.testsRun ? CREDIT_CONFIG.actionCredits.testsRun : 0)
    + (metrics.lintRun ? CREDIT_CONFIG.actionCredits.lintRun : 0)
    + (metrics.typecheckRun ? CREDIT_CONFIG.actionCredits.typecheckRun : 0)
    + (metrics.patchApplyAttempted ? CREDIT_CONFIG.actionCredits.patchApplyAttempted : 0);
  const complexity = complexityMultiplier(metrics.complexity);

  const finalCredits = Math.max(
    CREDIT_CONFIG.minimumChargePerRun,
    Math.ceil((tokenCredits + runtimeCredits + actionCredits) * complexity),
  );

  return {
    weightedTokens: Math.ceil(weightedTokens),
    tokenCredits,
    runtimeCredits,
    actionCredits,
    complexityMultiplier: complexity,
    finalCredits,
  };
}

export function estimateQwenCoderCost(request: QwenCoderEstimateRequest): QwenCoderCostBreakdown {
  const promptTokens = estimateTokensFromChars(s(request.promptText).length);
  const contextChars = jsonLength(request.contextJson || null);
  const retrievedContextTokens = estimateTokensFromChars(contextChars);
  const maxOutputChars = Math.max(0, asInt(request.maxOutputChars, 4_000));
  const outputTokens = estimateTokensFromChars(
    maxOutputChars > 0
      ? maxOutputChars
      : s(request.actionClass).toLowerCase().includes("heavy")
        ? 12_000
        : 4_000
  );
  const expectedRuntimeSeconds = Math.max(
    1,
    asInt(
      request.expectedRuntimeSeconds,
      s(request.actionClass).toLowerCase().includes("heavy")
        ? 42
        : 18
    ),
  );

  const complexity = inferComplexityFromEstimate({
    actionClass: request.actionClass,
    taskType: request.taskType,
    retrievedContextTokens,
    toolCount: Math.max(0, asInt(request.toolCount, s(request.actionClass).toLowerCase().includes("research") ? 3 : 1)),
    repoSizeFiles: Math.max(0, asInt(request.repoSizeFiles, 0)),
    filesTouched: Math.max(0, asInt(request.filesTouched, s(request.taskType).toLowerCase().includes("code") ? 3 : 1)),
  });

  const lowerTaskType = s(request.taskType).toLowerCase();
  const diffGenerated = lowerTaskType.includes("code") || lowerTaskType.includes("patch") || lowerTaskType.includes("refactor");

  return calculateQwenCoderCredits({
    inputTokens: promptTokens,
    retrievedContextTokens,
    outputTokens,
    compactionTokens: 0,
    toolRuntimeSeconds: expectedRuntimeSeconds,
    diffGenerated,
    testsRun: lowerTaskType.includes("test"),
    lintRun: lowerTaskType.includes("lint"),
    typecheckRun: lowerTaskType.includes("typecheck"),
    patchApplyAttempted: diffGenerated,
    complexity,
  });
}

export async function getQwenCoderWallet(args: {
  accountId: string;
  userId: string;
  planId: PlanId;
  now?: Date;
}): Promise<CoderCreditWallet> {
  const now = args.now || new Date();
  return prisma.$transaction(async (tx) => {
    const wallet = await ensureWalletTx({
      tx,
      accountId: s(args.accountId),
      userId: s(args.userId),
      planId: args.planId,
      now,
    });
    await upsertUsageSnapshotTx({ tx, wallet });
    return wallet;
  });
}

export async function getQwenCoderEntitlement(args: {
  accountId: string;
  userId: string;
  planId: PlanId;
  now?: Date;
}): Promise<{ wallet: CoderCreditWallet; entitlement: QwenCoderEntitlement }> {
  const now = args.now || new Date();
  const wallet = await getQwenCoderWallet({
    accountId: args.accountId,
    userId: args.userId,
    planId: args.planId,
    now,
  });
  const entitlement = deriveEntitlement({
    wallet,
    planId: args.planId,
    now,
  });
  return { wallet, entitlement };
}

export async function reserveQwenCoderCredits(args: {
  accountId: string;
  userId: string;
  planId: PlanId;
  requestId: string;
  modelName: string;
  conversationId?: string | null;
  taskId?: string | null;
  estimate: QwenCoderCostBreakdown;
  now?: Date;
}): Promise<QwenCoderReserveResult> {
  const now = args.now || new Date();
  return prisma.$transaction(async (tx) => {
    const accountId = s(args.accountId);
    const userId = s(args.userId);
    const requestId = s(args.requestId);

    const existing = await tx.coderCreditLedger.findUnique({
      where: {
        coder_ledger_request_unique: {
          accountId,
          userId,
          requestId,
        },
      },
    });
    if (existing) {
      const wallet = await tx.coderCreditWallet.findUnique({ where: { id: existing.walletId } });
      if (!wallet) {
        return { ok: false, code: "ENTITLEMENT_BLOCKED", entitlement: deriveEntitlementFromFallback(args.planId, now) };
      }
      const entitlement = deriveEntitlement({ wallet, planId: args.planId, now });
      return {
        ok: true,
        reservation: {
          ledgerId: existing.id,
          requestId,
          reservedCredits: Math.max(0, existing.creditsCharged),
          estimatedCredits: Math.max(0, existing.estimatedCredits),
          walletId: existing.walletId,
        },
        entitlement,
      };
    }

    const wallet = await ensureWalletTx({
      tx,
      accountId,
      userId,
      planId: args.planId,
      now,
    });

    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "coder_credit_wallets" WHERE "id" = ${wallet.id} FOR UPDATE`,
    );
    const lockedWallet = await tx.coderCreditWallet.findUnique({ where: { id: wallet.id } });
    if (!lockedWallet) {
      return { ok: false, code: "ENTITLEMENT_BLOCKED", entitlement: deriveEntitlementFromFallback(args.planId, now) };
    }

    const entitlement = deriveEntitlement({
      wallet: lockedWallet,
      planId: args.planId,
      now,
    });
    if (!entitlement.selectable) {
      return { ok: false, code: "ENTITLEMENT_BLOCKED", entitlement };
    }

    const reservedCredits = Math.max(1, Math.ceil(args.estimate.finalCredits * 1.2));
    if (reservedCredits > entitlement.creditsRemaining) {
      return { ok: false, code: "INSUFFICIENT_CREDITS", entitlement };
    }

    const nextWalletFields = applyCreditCharge({
      wallet: lockedWallet,
      credits: reservedCredits,
      now,
      planId: args.planId,
    });
    const updatedWallet = await tx.coderCreditWallet.update({
      where: { id: lockedWallet.id },
      data: nextWalletFields,
    });

    const ledger = await tx.coderCreditLedger.create({
      data: {
        walletId: lockedWallet.id,
        accountId,
        userId,
        conversationId: s(args.conversationId) || null,
        taskId: s(args.taskId) || null,
        requestId,
        modelName: s(args.modelName).slice(0, 120) || ALIBABA_QWEN_CODER_MODEL_ID,
        estimatedCredits: Math.max(0, args.estimate.finalCredits),
        creditsCharged: reservedCredits,
        chargeReason: "preflight_reservation",
        chargeState: "RESERVED",
        reservedAt: now,
      },
    });

    await upsertUsageSnapshotTx({ tx, wallet: updatedWallet });
    const nextEntitlement = deriveEntitlement({
      wallet: updatedWallet,
      planId: args.planId,
      now,
    });

    return {
      ok: true,
      reservation: {
        ledgerId: ledger.id,
        requestId,
        reservedCredits,
        estimatedCredits: Math.max(0, args.estimate.finalCredits),
        walletId: lockedWallet.id,
      },
      entitlement: nextEntitlement,
    };
  });
}

function deriveEntitlementFromFallback(planId: PlanId, now: Date): QwenCoderEntitlement {
  const { start, end } = utcMonthWindow(now);
  const isPlus = planId === "premium_plus";
  const isPremium = planId === "premium";
  const state: QwenCoderEntitlementState = planId === "free"
    ? "locked_free"
    : isPlus
      ? "premium_plus_exhausted"
      : "premium_exhausted";
  return {
    state,
    selectable: false,
    planId,
    planLabel: planLabel(planId),
    creditsUsed: 0,
    creditsRemaining: 0,
    totalAvailable: 0,
    totalRemaining: 0,
    percentUsed: 0,
    percentRemaining: 0,
    stage: null,
    billingCycleStart: start,
    billingCycleEnd: end,
    resetAt: end,
    cooldownEndsAt: null,
    warningLevel: null,
    nextActionId: planId === "free"
      ? "AI_QWEN_CODER_UNLOCK_REQUIRED"
      : isPremium
        ? "AI_QWEN_CODER_PREMIUM_EXHAUSTED"
        : "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED",
  };
}

async function loadLedgerAndWalletForFinalize(args: {
  tx: Tx;
  accountId: string;
  userId: string;
  requestId: string;
}): Promise<{ ledger: CoderCreditLedger; wallet: CoderCreditWallet } | null> {
  const ledger = await args.tx.coderCreditLedger.findUnique({
    where: {
      coder_ledger_request_unique: {
        accountId: args.accountId,
        userId: args.userId,
        requestId: args.requestId,
      },
    },
  });
  if (!ledger) return null;
  const wallet = await args.tx.coderCreditWallet.findUnique({ where: { id: ledger.walletId } });
  if (!wallet) return null;
  return { ledger, wallet };
}

function resolvePlanIdFromWalletTier(planTier: string): PlanId {
  const tier = s(planTier).toLowerCase();
  if (tier.includes("premium_plus")) return "premium_plus";
  if (tier.includes("premium")) return "premium";
  return "free";
}

export async function finalizeQwenCoderCharge(input: QwenCoderFinalizeInput): Promise<QwenCoderFinalizeResult> {
  return prisma.$transaction(async (tx) => {
    const accountId = s(input.accountId);
    const userId = s(input.userId);
    const requestId = s(input.requestId);
    const loaded = await loadLedgerAndWalletForFinalize({ tx, accountId, userId, requestId });
    if (!loaded) {
      return { ok: false, ledgerId: null, finalCredits: 0, refundedCredits: 0, chargedCredits: 0 };
    }
    const { ledger, wallet } = loaded;
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "coder_credit_wallets" WHERE "id" = ${wallet.id} FOR UPDATE`,
    );
    const lockedWallet = await tx.coderCreditWallet.findUnique({ where: { id: wallet.id } });
    if (!lockedWallet) {
      return { ok: false, ledgerId: null, finalCredits: 0, refundedCredits: 0, chargedCredits: 0 };
    }

    const calculated = calculateQwenCoderCredits(input.usage);
    const reason = input.reason || "success";
    const targetFinalCredits = mapFailureFinalCredits({
      reason,
      calculatedCredits: calculated.finalCredits,
    });
    const reservedCredits = Math.max(0, ledger.creditsCharged);
    const delta = targetFinalCredits - reservedCredits;
    const planId = resolvePlanIdFromWalletTier(lockedWallet.planTier);

    let updatedWallet = lockedWallet;
    const remainingBefore = Math.max(0, lockedWallet.totalRemaining);
    let refundedCredits = 0;
    let settledCredits = reservedCredits;

    if (delta < 0) {
      const refundRequested = Math.abs(delta);
      const refundFields = applyCreditRefund({
        wallet: lockedWallet,
        refundCredits: refundRequested,
        now: new Date(),
        planId,
      });
      updatedWallet = await tx.coderCreditWallet.update({
        where: { id: lockedWallet.id },
        data: refundFields,
      });
      const settled = settleFinalizedCredits({
        reservedCredits,
        targetCredits: targetFinalCredits,
        remainingBefore,
        remainingAfter: Math.max(0, updatedWallet.totalRemaining),
      });
      refundedCredits = settled.refundedCredits;
      settledCredits = settled.settledCredits;
    } else if (delta > 0) {
      const chargeFields = applyCreditCharge({
        wallet: lockedWallet,
        credits: delta,
        now: new Date(),
        planId,
      });
      updatedWallet = await tx.coderCreditWallet.update({
        where: { id: lockedWallet.id },
        data: chargeFields,
      });
      const settled = settleFinalizedCredits({
        reservedCredits,
        targetCredits: targetFinalCredits,
        remainingBefore,
        remainingAfter: Math.max(0, updatedWallet.totalRemaining),
      });
      refundedCredits = settled.refundedCredits;
      settledCredits = settled.settledCredits;
    } else {
      const settled = settleFinalizedCredits({
        reservedCredits,
        targetCredits: targetFinalCredits,
        remainingBefore,
        remainingAfter: remainingBefore,
      });
      refundedCredits = settled.refundedCredits;
      settledCredits = settled.settledCredits;
    }

    const chargeState = delta === 0 && settledCredits === targetFinalCredits
      ? "FINALIZED"
      : "ADJUSTED";

    await tx.coderCreditLedger.update({
      where: { id: ledger.id },
      data: {
        conversationId: s(input.conversationId) || ledger.conversationId,
        taskId: s(input.taskId) || ledger.taskId,
        modelName: s(input.modelName).slice(0, 120) || ledger.modelName,
        rawInputTokens: Math.max(0, input.usage.inputTokens),
        rawContextTokens: Math.max(0, input.usage.retrievedContextTokens),
        rawOutputTokens: Math.max(0, input.usage.outputTokens),
        compactionTokens: Math.max(0, input.usage.compactionTokens),
        runtimeSeconds: Math.max(0, input.usage.toolRuntimeSeconds),
        creditsCharged: Math.max(0, settledCredits),
        chargeReason: reason,
        chargeState,
        finalizedAt: new Date(),
      },
    });

    await upsertUsageSnapshotTx({ tx, wallet: updatedWallet });

    return {
      ok: true,
      ledgerId: ledger.id,
      finalCredits: Math.max(0, settledCredits),
      refundedCredits,
      chargedCredits: Math.max(0, settledCredits),
    };
  });
}

export async function refundOrAdjustQwenCoderCharge(input: QwenCoderFinalizeInput): Promise<QwenCoderFinalizeResult> {
  return finalizeQwenCoderCharge(input);
}

export async function getQwenCoderPopoverState(args: {
  accountId: string;
  userId: string;
  planId: PlanId;
  sessionId?: string | null;
  now?: Date;
}): Promise<QwenCoderPopoverState> {
  const now = args.now || new Date();
  const { wallet, entitlement } = await getQwenCoderEntitlement({
    accountId: args.accountId,
    userId: args.userId,
    planId: args.planId,
    now,
  });

  const sessionId = s(args.sessionId);
  const [contextSnapshot, recentLedger] = await Promise.all([
    prisma.coderContextSnapshot.findFirst({
      where: {
        accountId: s(args.accountId),
        userId: s(args.userId),
        ...(sessionId ? { sessionId } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
    }),
    prisma.coderCreditLedger.findMany({
      where: {
        accountId: s(args.accountId),
        userId: s(args.userId),
        walletId: wallet.id,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 8,
      select: {
        requestId: true,
        modelName: true,
        creditsCharged: true,
        createdAt: true,
        chargeState: true,
      },
    }),
  ]);

  return {
    planId: args.planId,
    planLabel: args.planId === "premium_plus" ? "Premium+" : args.planId === "premium" ? "Premium" : "Free",
    entitlement,
    billingCycleStart: cycleDateIso(wallet.billingCycleStart),
    billingCycleEnd: cycleDateIso(wallet.billingCycleEnd),
    resetAt: cycleDateIso(entitlement.resetAt),
    cooldownEndsAt: entitlement.cooldownEndsAt ? cycleDateIso(entitlement.cooldownEndsAt) : null,
    usage: {
      creditsUsed: entitlement.creditsUsed,
      creditsLeft: entitlement.creditsRemaining,
      creditsTotal: entitlement.totalAvailable,
      percentUsed: entitlement.percentUsed,
      percentRemaining: entitlement.percentRemaining,
    },
    contextWindow: contextSnapshot
      ? {
          currentTokens: Math.max(0, contextSnapshot.currentContextTokens),
          maxTokens: Math.max(1, contextSnapshot.maxContextTokens),
          percentFull: Math.max(0, Math.min(100, Number(contextSnapshot.percentFull.toFixed(2)))),
          compactionCount: Math.max(0, contextSnapshot.compactionCount),
        }
      : null,
    recentUsage: recentLedger.map((row) => ({
      requestId: row.requestId,
      modelName: row.modelName,
      creditsCharged: Math.max(0, row.creditsCharged),
      createdAt: cycleDateIso(row.createdAt),
      chargeState: row.chargeState,
    })),
  };
}

export async function captureQwenCoderContextSnapshot(args: {
  accountId: string;
  userId: string;
  sessionId?: string | null;
  conversationId?: string | null;
  activeModel: string;
  currentContextTokens: number;
  maxContextTokens?: number;
  compactionCount?: number;
}): Promise<void> {
  const maxContextTokens = Math.max(1, asInt(args.maxContextTokens, CREDIT_CONFIG.maxContextTokens));
  const currentContextTokens = Math.max(0, asInt(args.currentContextTokens, 0));
  const percentFull = Math.max(0, Math.min(100, Number(((currentContextTokens / maxContextTokens) * 100).toFixed(2))));

  await prisma.coderContextSnapshot.create({
    data: {
      accountId: s(args.accountId),
      userId: s(args.userId),
      sessionId: s(args.sessionId) || null,
      conversationId: s(args.conversationId) || null,
      activeModel: s(args.activeModel).slice(0, 120),
      currentContextTokens,
      maxContextTokens,
      percentFull,
      compactionCount: Math.max(0, asInt(args.compactionCount, 0)),
    },
  }).catch(() => {
    // Non-blocking telemetry snapshot.
  });
}

export async function handleBillingCycleReset(args: {
  accountId: string;
  userId?: string | null;
  planId: PlanId;
  now?: Date;
}): Promise<{ processedUsers: number }> {
  const now = args.now || new Date();
  const accountId = s(args.accountId);
  const users = s(args.userId)
    ? [{ userId: s(args.userId) }]
    : await prisma.membership.findMany({
        where: { accountId },
        select: { userId: true },
      });

  for (const row of users) {
    await getQwenCoderWallet({
      accountId,
      userId: s(row.userId),
      planId: args.planId,
      now,
    });
    await prisma.coderPlanEvent.create({
      data: {
        accountId,
        userId: s(row.userId),
        oldPlan: null,
        newPlan: args.planId,
        eventType: "billing_cycle_reset",
        eventSource: "billing_reset",
      },
    }).catch(() => {});
  }
  return { processedUsers: users.length };
}

export async function applyPlanTransition(args: {
  accountId: string;
  userId: string;
  oldPlan: PlanId;
  newPlan: PlanId;
  eventType: "upgrade" | "downgrade" | "sync";
  eventSource: string;
  now?: Date;
}): Promise<void> {
  const now = args.now || new Date();
  const accountId = s(args.accountId);
  const userId = s(args.userId);

  await prisma.$transaction(async (tx) => {
    await tx.coderPlanEvent.create({
      data: {
        accountId,
        userId,
        oldPlan: args.oldPlan,
        newPlan: args.newPlan,
        eventType: args.eventType,
        eventSource: s(args.eventSource) || "unknown",
      },
    });

    const wallet = await ensureWalletTx({
      tx,
      accountId,
      userId,
      planId: args.newPlan,
      now,
    });

    if (args.oldPlan === args.newPlan) {
      const synced = await tx.coderCreditWallet.update({
        where: { id: wallet.id },
        data: {
          planTier: args.newPlan,
          lastRecomputedAt: now,
        },
      });
      await upsertUsageSnapshotTx({ tx, wallet: synced });
      return;
    }

    if (args.oldPlan === "premium" && args.newPlan === "premium_plus") {
      const cfg = qwenPlanConfig("premium_plus");
      const boostedTotal = Math.max(wallet.totalAvailable, cfg.monthlyCoderCredits + wallet.rolloverAllocation);
      const nextRemaining = Math.max(0, boostedTotal - wallet.totalUsed);
      const upgraded = await tx.coderCreditWallet.update({
        where: { id: wallet.id },
        data: {
          planTier: "premium_plus",
          monthlyAllocation: cfg.monthlyCoderCredits,
          rolloverAllocation: Math.min(cfg.rolloverCap, wallet.rolloverAllocation),
          totalAvailable: boostedTotal,
          totalRemaining: nextRemaining,
          stagedModeEnabled: false,
          stage1Allocation: 0,
          stage1Used: 0,
          stage1ExhaustedAt: null,
          cooldownEndsAt: null,
          stage2Allocation: 0,
          stage2Used: 0,
          exhaustedAt: nextRemaining > 0 ? null : wallet.exhaustedAt,
          lastRecomputedAt: now,
        },
      });
      await upsertUsageSnapshotTx({ tx, wallet: upgraded });
      return;
    }

    if (args.oldPlan === "premium_plus" && args.newPlan === "premium") {
      // Downgrades are applied on the next monthly cycle window.
      return;
    }

    if (args.newPlan === "free") {
      const reset = await tx.coderCreditWallet.update({
        where: { id: wallet.id },
        data: {
          planTier: "free",
          monthlyAllocation: 0,
          rolloverAllocation: 0,
          totalAvailable: 0,
          totalUsed: 0,
          totalRemaining: 0,
          stagedModeEnabled: false,
          stage1Allocation: 0,
          stage1Used: 0,
          stage1ExhaustedAt: null,
          cooldownEndsAt: null,
          stage2Allocation: 0,
          stage2Used: 0,
          exhaustedAt: now,
          lastRecomputedAt: now,
        },
      });
      await upsertUsageSnapshotTx({ tx, wallet: reset });
      return;
    }

    if (args.newPlan === "premium") {
      const cfg = qwenPlanConfig("premium");
      const monthlyAllocation = cfg.monthlyCoderCredits;
      const totalAvailable = Math.max(0, monthlyAllocation);
      const totalUsed = Math.max(0, Math.min(wallet.totalUsed, totalAvailable));
      const totalRemaining = Math.max(0, totalAvailable - totalUsed);
      const stagedModeEnabled = cfg.premiumStagedAccessEnabled;
      const stage1Allocation = stagedModeEnabled ? Math.min(monthlyAllocation, cfg.stage1Credits) : 0;
      const stage2Allocation = stagedModeEnabled ? Math.max(0, monthlyAllocation - stage1Allocation) : 0;
      const stage1Used = stagedModeEnabled ? Math.min(stage1Allocation, totalUsed) : 0;
      const stage2Used = stagedModeEnabled ? Math.min(stage2Allocation, Math.max(0, totalUsed - stage1Used)) : 0;
      const stage1ExhaustedAt = stagedModeEnabled && stage1Used >= stage1Allocation && stage1Allocation > 0
        ? (wallet.stage1ExhaustedAt || now)
        : null;
      const cooldownEndsAt = stagedModeEnabled && stage1ExhaustedAt && stage2Used < stage2Allocation
        ? (wallet.cooldownEndsAt || (cfg.cooldownDays > 0 ? nextCooldownDate(now, cfg.cooldownDays) : now))
        : null;
      const refreshed = await tx.coderCreditWallet.update({
        where: { id: wallet.id },
        data: {
          planTier: "premium",
          monthlyAllocation,
          rolloverAllocation: 0,
          totalAvailable,
          totalUsed,
          totalRemaining,
          stagedModeEnabled,
          stage1Allocation,
          stage1Used,
          stage1ExhaustedAt,
          cooldownEndsAt,
          stage2Allocation,
          stage2Used,
          exhaustedAt: totalRemaining > 0 ? null : wallet.exhaustedAt || now,
          lastRecomputedAt: now,
        },
      });
      await upsertUsageSnapshotTx({ tx, wallet: refreshed });
      return;
    }

    if (args.newPlan === "premium_plus") {
      const cfg = qwenPlanConfig("premium_plus");
      const rolloverAllocation = cfg.rollover
        ? Math.min(cfg.rolloverCap, Math.max(0, wallet.totalRemaining))
        : 0;
      const totalAvailable = Math.max(0, cfg.monthlyCoderCredits + rolloverAllocation);
      const totalUsed = Math.max(0, Math.min(wallet.totalUsed, totalAvailable));
      const totalRemaining = Math.max(0, totalAvailable - totalUsed);
      const refreshed = await tx.coderCreditWallet.update({
        where: { id: wallet.id },
        data: {
          planTier: "premium_plus",
          monthlyAllocation: cfg.monthlyCoderCredits,
          rolloverAllocation,
          totalAvailable,
          totalUsed,
          totalRemaining,
          stagedModeEnabled: false,
          stage1Allocation: 0,
          stage1Used: 0,
          stage1ExhaustedAt: null,
          cooldownEndsAt: null,
          stage2Allocation: 0,
          stage2Used: 0,
          exhaustedAt: totalRemaining > 0 ? null : wallet.exhaustedAt || now,
          lastRecomputedAt: now,
        },
      });
      await upsertUsageSnapshotTx({ tx, wallet: refreshed });
      return;
    }
  });
}

export const __qwenTestOnly = {
  qwenPlanConfig,
  applyCreditCharge,
  applyCreditRefund,
  deriveEntitlement,
  utcMonthWindow,
  mapFailureFinalCredits,
  settleFinalizedCredits,
};

export function estimateContextTokensForSnapshot(payload: unknown): number {
  return estimateTokensFromChars(jsonLength(payload));
}
