export type CavGuardCode =
  | "AUTH_REQUIRED"
  | "OWNER_ONLY"
  | "ROLE_BLOCKED"
  | "PLAN_REQUIRED"
  | "FEATURE_DISABLED"
  | "ACL_DENIED";

export type CavGuardActorRole = "OWNER" | "ADMIN" | "MEMBER" | "ANON";
export type CavGuardActorPlan = "FREE" | "PREMIUM" | "PREMIUM_PLUS";

export type CavGuardDecision = {
  code: CavGuardCode;
  actionId: string;
  actorRole?: CavGuardActorRole;
  actorPlan?: CavGuardActorPlan;
  title: string;
  request: string;
  reason: string;
  cta?: { label: string; href: string } | null;
  stepUp?: { kind: "CAVERIFY"; reason: string } | null;
};

