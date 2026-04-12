import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavtools resolves owner role and effective plan from live membership and subscription context", () => {
  const source = read("lib/cavtools/commandPlane.server.ts");

  assert.equal(source.includes('import { findLatestEntitledSubscription, resolveEffectivePlanId } from "@/lib/accountPlan.server";'), true);
  assert.equal(source.includes("async function resolveMembershipForExecContext(accountId: string, userId: string) {"), true);
  assert.equal(source.includes("const memberships = await prisma.membership.findMany({"), true);
  assert.equal(source.includes("const exact = memberships.find((membership) => membership.accountId === accountId) || null;"), true);
  assert.equal(source.includes("const primary = pickPrimaryExecMembership(memberships);"), true);
  assert.equal(source.includes("const entitledSubscription = await findLatestEntitledSubscription(accountId);"), true);
  assert.equal(source.includes("return resolveEffectivePlanId({"), true);
  assert.equal(source.includes("const membership = await resolveMembershipForExecContext(sessionAccountId, userId);"), true);
  assert.equal(source.includes("accountId,\n      memberRole,"), true);
});
