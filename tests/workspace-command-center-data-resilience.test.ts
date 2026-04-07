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
});
