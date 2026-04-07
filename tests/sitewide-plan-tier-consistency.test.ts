import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relPath: string) {
  return fs.readFileSync(path.resolve(relPath), "utf8");
}

test("site-wide plan gates resolve from the effective account plan context", () => {
  const files = [
    "src/lib/ai/ai.guard.ts",
    "lib/workspaceTeam.server.ts",
    "lib/security/authorize.ts",
    "app/api/members/invite/route.ts",
    "app/api/members/accept/route.ts",
    "app/api/workspaces/[projectId]/sites/route.ts",
    "lib/integrations/googleDriveImport.server.ts",
    "app/api/billing/summary/route.ts",
    "lib/moduleGate.server.ts",
    "lib/scanner.ts",
    "app/api/auth/session/route.ts",
    "app/api/settings/arcade/config/route.ts",
  ];

  for (const relPath of files) {
    const source = read(relPath);
    assert.equal(source.includes("getEffectiveAccountPlanContext"), true, relPath);
  }
});

test("auth session bootstrap exposes effective tier instead of only the raw membership tier", () => {
  const source = read("app/api/auth/session/route.ts");
  assert.equal(source.includes("tierEffective: planTierToken(effectivePlan?.planId)"), true);
});

test("CavAi and CavCode clients clamp models and reasoning to the resolved plan", () => {
  const center = read("components/cavai/CavAiCenterWorkspace.tsx");
  const code = read("components/cavai/CavAiCodeWorkspace.tsx");
  const cavcode = read("app/cavcode/page.tsx");

  assert.equal(center.includes("clampCenterModelOptionsToPlan"), true);
  assert.equal(center.includes("clampCenterReasoningLevelsToPlan"), true);
  assert.equal(center.includes("setAccountPlanId(authPlanId);"), true);
  assert.equal(
    center.includes("planTierRank(authPlanId) >= planTierRank(prev) ? authPlanId : prev"),
    false,
  );

  assert.equal(code.includes("if (!coder) return [];"), true);
  assert.equal(code.includes('accountPlanId === "free" || s(qwenPopoverState?.entitlement?.state).toLowerCase() === "locked_free"'), true);
  assert.equal(code.includes("cavCodePlanModelOptions(accountPlanId)"), true);
  assert.equal(
    code.includes("planTierRank(authPlanId) >= planTierRank(prev) ? authPlanId : prev"),
    false,
  );

  assert.equal(cavcode.includes("resolveServerPlanId(body.planId, accountPlanId)"), true);
  assert.equal(cavcode.includes("clampAgentBuilderModelOptionsToPlan"), true);
  assert.equal(cavcode.includes("clampAgentBuilderReasoningOptionsToPlan"), true);
  assert.equal(cavcode.includes("mergeAgentBuilderModelOptionsWithPlan"), false);
});
