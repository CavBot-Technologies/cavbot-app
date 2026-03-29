import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const policyPath = path.resolve("src/lib/ai/ai.policy.ts");

test("companion-specific center actions are wired to companion_chat classification", () => {
  const source = fs.readFileSync(policyPath, "utf8");
  const requiredActions = [
    '"financial_advisor"',
    '"therapist_support"',
    '"mentor"',
    '"best_friend"',
    '"relationship_advisor"',
    '"philosopher"',
    '"focus_coach"',
    '"life_strategist"',
  ];

  for (const action of requiredActions) {
    assert.equal(source.includes(action), true, `Missing ${action} in companion action set.`);
  }

  assert.equal(source.includes("companionModeActions.has(action)"), true);
  assert.equal(source.includes("return \"companion_chat\";"), true);
});
