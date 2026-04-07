import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("auth session bootstrap promotes users onto a stronger tier workspace when available", () => {
  const authDb = read("lib/authDb.ts");
  const authSession = read("app/api/auth/session/route.ts");
  const authMe = read("app/api/auth/me/route.ts");

  assert.equal(authDb.includes('a."tier" AS "accountTier"'), true);
  assert.equal(authDb.includes("export function membershipTierRank"), true);
  assert.equal(authDb.includes("export function compareMembershipPriority"), true);

  assert.equal(
    authSession.includes("membershipTierRank(primaryMembership.accountTier) > membershipTierRank(membership.accountTier)"),
    true,
  );
  assert.equal(authSession.includes("const promotedMembership = shouldPromoteMembership && primaryMembership"), true);
  assert.equal(authSession.includes("return attachUserSessionCookie(req, response, token);"), true);

  assert.equal(
    authMe.includes("membershipTierRank(primaryMembership.accountTier) > membershipTierRank(currentMembershipRecord.accountTier)"),
    true,
  );
  assert.equal(authMe.includes("const promotedMembershipRecord = shouldPromoteMembership && primaryMembership"), true);
  assert.equal(authMe.includes("return attachUserSessionCookie(req, response, token);"), true);
});

test("workspace command center keeps plan and profile hydration even when one boot request fails", () => {
  const source = read("app/page.tsx");

  assert.equal(source.includes("const [profileResult, authMeResult, membersResult] = await Promise.allSettled(["), true);
  assert.equal(source.includes('const pRes = profileResult.status === "fulfilled" ? profileResult.value : null;'), true);
  assert.equal(source.includes('const meRes = authMeResult.status === "fulfilled" ? authMeResult.value : null;'), true);
  assert.equal(source.includes('const teamRes = membersResult.status === "fulfilled" ? membersResult.value : null;'), true);
  assert.equal(source.includes("if (meRes?.ok && meJson?.ok) {"), true);
  assert.equal(source.includes("function publishWorkspacePlanDetail("), true);
  assert.equal(source.includes('const summaryPlanId = resolvePlanIdFromTier(payload.summary.planId || "free");'), true);
  assert.equal(source.includes("publishWorkspacePlanDetail(summaryPlanId, {"), true);
  assert.equal(source.includes("preserveStrongerCached: true,"), true);
});

test("workspace command center profile card boots from the known workspace plan instead of hardcoded free defaults", () => {
  const source = read("app/page.tsx");

  assert.equal(source.includes("function ProfileCard(props: {"), true);
  assert.equal(source.includes("fallbackPlanId: PlanId;"), true);
  assert.equal(source.includes("fallbackPlanLabel: string;"), true);
  assert.equal(source.includes("const [plan, setPlan] = useState<string>(fallbackPlanLabel);"), true);
  assert.equal(source.includes("const [seatLimit, setSeatLimit] = useState<number | null>(fallbackSeatLimit);"), true);
  assert.equal(source.includes("setPlan(fallbackPlanLabel);"), true);
  assert.equal(source.includes("setSeatLimit(fallbackSeatLimit);"), true);
  assert.equal(source.includes("<ProfileCard"), true);
  assert.equal(source.includes("fallbackPlanId={planId}"), true);
  assert.equal(source.includes("fallbackPlanLabel={workspacePlanLabel}"), true);
});

test("workspace members route derives seat limits from the effective account plan", () => {
  const source = read("app/api/members/route.ts");

  assert.equal(source.includes('import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";'), true);
  assert.equal(source.includes('import { resolvePlanIdFromTier, getPlanLimits, type PlanId } from "@/lib/plans";'), true);
  assert.equal(source.includes('function degradedMembersPayload(planId: PlanId = resolvePlanIdFromTier("FREE")) {'), true);
  assert.equal(source.includes('let degradedPlanId: PlanId = resolvePlanIdFromTier("FREE");'), true);
  assert.equal(source.includes("const [planContext, account] = await Promise.all(["), true);
  assert.equal(source.includes("getEffectiveAccountPlanContext(accountId).catch(() => null)"), true);
  assert.equal(source.includes('const planId = planContext?.planId ?? resolvePlanIdFromTier(account?.tier || "FREE");'), true);
  assert.equal(source.includes("degradedPlanId = planId;"), true);
  assert.equal(source.includes("return json(degradedMembersPayload(degradedPlanId), 200);"), true);
});
