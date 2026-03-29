import type { CavGuardDecision } from "@/src/lib/cavguard/cavGuard.types";

export const CAV_GUARD_DECISION_EVENT = "cb:cavguard:decision";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function normalizeDecision(input: unknown): CavGuardDecision | null {
  if (!isObject(input)) return null;
  const code = stringValue(input.code);
  const actionId = stringValue(input.actionId);
  const title = stringValue(input.title);
  const request = stringValue(input.request);
  const reason = stringValue(input.reason);
  if (!code || !actionId || !title || !request || !reason) return null;

  const ctaRaw = isObject(input.cta) ? input.cta : null;
  const ctaLabel = stringValue(ctaRaw?.label);
  const ctaHref = stringValue(ctaRaw?.href);
  const stepRaw = isObject(input.stepUp) ? input.stepUp : null;
  const stepKind = stringValue(stepRaw?.kind);
  const stepReason = stringValue(stepRaw?.reason);

  return {
    code: code as CavGuardDecision["code"],
    actionId,
    actorRole: stringValue(input.actorRole) as CavGuardDecision["actorRole"],
    actorPlan: stringValue(input.actorPlan) as CavGuardDecision["actorPlan"],
    title,
    request,
    reason,
    cta: ctaLabel && ctaHref ? { label: ctaLabel, href: ctaHref } : null,
    stepUp: stepKind === "CAVERIFY" && stepReason ? { kind: "CAVERIFY", reason: stepReason } : null,
  };
}

export function readGuardDecisionFromPayload(payload: unknown): CavGuardDecision | null {
  if (!isObject(payload)) return null;
  return normalizeDecision(payload.guardDecision);
}

export function emitGuardDecision(decision: CavGuardDecision) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(CAV_GUARD_DECISION_EVENT, { detail: { decision } }));
  } catch {}
}

export function emitGuardDecisionFromPayload(payload: unknown): CavGuardDecision | null {
  const decision = readGuardDecisionFromPayload(payload);
  if (!decision) return null;
  emitGuardDecision(decision);
  return decision;
}

