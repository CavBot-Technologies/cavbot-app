"use client";

import { readBootClientAuthBootstrap, readBootClientPlanState } from "@/lib/clientAuthBootstrap";

export type ClientPlanId = "free" | "premium" | "premium_plus";

export const SHELL_PLAN_SNAPSHOT_KEY = "cb_shell_plan_snapshot_v1";
export const PLAN_CONTEXT_KEY = "cb_plan_context_v1";
export const SHELL_PLAN_EVENT = "cb:shell-plan";
export const PLAN_EVENT = "cb:plan";

type PlanSnapshot = {
  planTier?: unknown;
  ts?: unknown;
};

type PlanContextDetail = {
  planKey?: unknown;
  planLabel?: unknown;
  planTier?: unknown;
};

export type ClientPlanBootstrap = {
  planId: ClientPlanId;
  authenticatedHint: boolean;
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function normalizeClientPlanId(value: unknown): ClientPlanId {
  const raw = s(value).toLowerCase();
  if (raw === "premium_plus" || raw === "premium+") return "premium_plus";
  if (raw === "premium") return "premium";
  return "free";
}

export function clientPlanRank(planId: ClientPlanId): number {
  if (planId === "premium_plus") return 3;
  if (planId === "premium") return 2;
  return 1;
}

function readPlanSnapshot(): ClientPlanBootstrap | null {
  const snapshotFromBoot = readBootClientPlanState();
  if (snapshotFromBoot) {
    const bootAuth = readBootClientAuthBootstrap();
    return {
      planId: normalizeClientPlanId(snapshotFromBoot.planId || snapshotFromBoot.planTier),
      authenticatedHint: bootAuth?.authenticated ?? true,
    };
  }

  if (typeof window === "undefined" || typeof globalThis.__cbLocalStore === "undefined") return null;
  const snapshot = safeJsonParse<PlanSnapshot>(globalThis.__cbLocalStore.getItem(SHELL_PLAN_SNAPSHOT_KEY));
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return {
    planId: normalizeClientPlanId(snapshot.planTier),
    authenticatedHint: true,
  };
}

function readLegacyPlanContext(): ClientPlanBootstrap | null {
  if (typeof window === "undefined" || typeof globalThis.__cbLocalStore === "undefined") return null;
  const detail = safeJsonParse<PlanContextDetail>(globalThis.__cbLocalStore.getItem(PLAN_CONTEXT_KEY));
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  return {
    planId: normalizeClientPlanId(detail.planKey || detail.planTier || detail.planLabel),
    authenticatedHint: true,
  };
}

function resolvePlanFromEventDetail(detail: unknown): ClientPlanId | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const row = detail as Record<string, unknown>;
  const raw = row.planTier ?? row.planKey ?? row.planLabel;
  if (!s(raw)) return null;
  return normalizeClientPlanId(raw);
}

export function readBootClientPlanBootstrap(): ClientPlanBootstrap {
  const snapshot = readPlanSnapshot();
  if (snapshot) return snapshot;
  const legacy = readLegacyPlanContext();
  if (legacy) return legacy;
  const boot = readBootClientAuthBootstrap();
  if (boot?.authenticated && boot.plan) {
    return {
      planId: normalizeClientPlanId(boot.plan.planId || boot.plan.planTier || boot.plan.planLabel),
      authenticatedHint: true,
    };
  }
  return {
    planId: "free",
    authenticatedHint: false,
  };
}

function strongerClientPlanId(a: ClientPlanId, b: ClientPlanId): ClientPlanId {
  return clientPlanRank(a) >= clientPlanRank(b) ? a : b;
}

function toPlanTier(planId: ClientPlanId): "FREE" | "PREMIUM" | "PREMIUM_PLUS" {
  if (planId === "premium_plus") return "PREMIUM_PLUS";
  if (planId === "premium") return "PREMIUM";
  return "FREE";
}

function toPlanLabel(planId: ClientPlanId): "FREE" | "PREMIUM" | "PREMIUM+" {
  if (planId === "premium_plus") return "PREMIUM+";
  if (planId === "premium") return "PREMIUM";
  return "FREE";
}

export function publishClientPlan(args: {
  planId: ClientPlanId;
  memberRole?: string | null;
  trialActive?: boolean;
  trialDaysLeft?: number;
  preserveStrongerCached?: boolean;
}) {
  const cachedSnapshot =
    typeof window === "undefined" || typeof globalThis.__cbLocalStore === "undefined"
      ? null
      : safeJsonParse<{
          planTier?: unknown;
          memberRole?: unknown;
          trialActive?: unknown;
          trialDaysLeft?: unknown;
        }>(globalThis.__cbLocalStore.getItem(SHELL_PLAN_SNAPSHOT_KEY));
  const cachedPlanId = cachedSnapshot ? normalizeClientPlanId(cachedSnapshot.planTier) : null;
  const planId =
    args.preserveStrongerCached && cachedPlanId
      ? strongerClientPlanId(args.planId, cachedPlanId)
      : args.planId;
  const planTier = toPlanTier(planId);
  const memberRole =
    typeof args.memberRole === "string"
      ? args.memberRole
      : typeof cachedSnapshot?.memberRole === "string"
        ? cachedSnapshot.memberRole
        : null;
  const trialActive =
    typeof args.trialActive === "boolean"
      ? args.trialActive
      : Boolean(cachedSnapshot?.trialActive);
  const trialDaysLeftRaw =
    typeof args.trialDaysLeft !== "undefined"
      ? Number(args.trialDaysLeft)
      : Number(cachedSnapshot?.trialDaysLeft || 0);
  const trialDaysLeft =
    trialActive && Number.isFinite(trialDaysLeftRaw) && trialDaysLeftRaw > 0
      ? Math.trunc(trialDaysLeftRaw)
      : 0;
  const snapshot = {
    planTier,
    memberRole,
    trialActive,
    trialDaysLeft,
    ts: Date.now(),
  };
  const detail = {
    planKey: planId,
    planLabel: toPlanLabel(planId),
    planTier,
    memberRole,
    trialActive,
    trialDaysLeft,
  };

  if (typeof window !== "undefined" && typeof globalThis.__cbLocalStore !== "undefined") {
    try {
      globalThis.__cbLocalStore.setItem(SHELL_PLAN_SNAPSHOT_KEY, JSON.stringify(snapshot));
      globalThis.__cbLocalStore.setItem(PLAN_CONTEXT_KEY, JSON.stringify(detail));
      window.dispatchEvent(new CustomEvent(SHELL_PLAN_EVENT, { detail: snapshot }));
      window.dispatchEvent(new CustomEvent(PLAN_EVENT, { detail }));
    } catch {}
  }

  return { snapshot, detail };
}

export function subscribeClientPlan(handler: (planId: ClientPlanId) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onShellPlan = (event: Event) => {
    const planId = resolvePlanFromEventDetail((event as CustomEvent).detail);
    if (planId) handler(planId);
  };

  const onPlan = (event: Event) => {
    const planId = resolvePlanFromEventDetail((event as CustomEvent).detail);
    if (planId) handler(planId);
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== SHELL_PLAN_SNAPSHOT_KEY && event.key !== PLAN_CONTEXT_KEY) return;
    const next = readBootClientPlanBootstrap();
    handler(next.planId);
  };

  window.addEventListener(SHELL_PLAN_EVENT, onShellPlan as EventListener);
  window.addEventListener(PLAN_EVENT, onPlan as EventListener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SHELL_PLAN_EVENT, onShellPlan as EventListener);
    window.removeEventListener(PLAN_EVENT, onPlan as EventListener);
    window.removeEventListener("storage", onStorage);
  };
}
