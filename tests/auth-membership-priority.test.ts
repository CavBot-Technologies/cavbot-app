import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("membership priority ranks tiers before role and createdAt", () => {
  const source = read("lib/authDb.ts");

  assert.equal(source.includes("export function membershipTierRank"), true);
  assert.equal(source.includes('normalized.includes("PREMIUM_PLUS")'), true);
  assert.equal(source.includes('normalized.includes("ENTERPRISE")'), true);
  assert.equal(source.includes('normalized.includes("PREMIUM")'), true);
  assert.equal(source.includes("const tierRank = membershipTierRank(right.accountTier) - membershipTierRank(left.accountTier);"), true);
  assert.equal(source.includes("const roleRank = membershipRoleRank(right.role) - membershipRoleRank(left.role);"), true);
  assert.equal(source.includes("return left.createdAt.getTime() - right.createdAt.getTime();"), true);
  assert.equal(source.includes("return compareMembershipPriority(a, b);"), true);
});

test("membership lookups include account tier so primary selection can prefer Premium+", () => {
  const source = read("lib/authDb.ts");

  assert.equal(source.includes('a."tier" AS "accountTier"'), true);
  assert.equal(source.includes('JOIN "Account" a ON a."id" = m."accountId"'), true);
  assert.equal(source.includes("accountTier: typeof row.accountTier === \"string\" ? row.accountTier : null,"), true);
});
