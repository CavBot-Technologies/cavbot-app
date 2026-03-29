import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("reasoning display mapping keeps internal enums and exposes new user labels", () => {
  const mapping = read("src/lib/ai/reasoning-display.ts");

  assert.equal(mapping.includes("export type ReasoningDisplayLevel = \"low\" | \"medium\" | \"high\" | \"extra_high\";"), true);
  assert.equal(mapping.includes("low: \"Fast\""), true);
  assert.equal(mapping.includes("medium: \"Balanced\""), true);
  assert.equal(mapping.includes("high: \"Deep\""), true);
  assert.equal(mapping.includes("extra_high: \"Max\""), true);
});

test("center, caven, cavpad and cavcode UIs consume display mapping labels", () => {
  const center = read("components/cavai/CavAiCenterWorkspace.tsx");
  const caven = read("components/cavai/CavAiCodeWorkspace.tsx");
  const cavpad = read("components/CavPad.tsx");
  const cavcodePage = read("app/cavcode/page.tsx");

  assert.equal(center.includes("toReasoningDisplayLabel(\"low\")"), true);
  assert.equal(center.includes("const levelLabel = toReasoningDisplayLabel(args.level);"), true);

  assert.equal(caven.includes("toReasoningDisplayLabel(\"low\")"), true);
  assert.equal(caven.includes("const levelLabel = toReasoningDisplayLabel(args.level);"), true);

  assert.equal(cavpad.includes("toReasoningDisplayLabel(\"low\")"), true);
  assert.equal(cavpad.includes("const cavAiReasoningLabel = React.useMemo("), true);
  assert.equal(cavpad.includes("Reasoning selector. Current: ${cavAiReasoningLabel}"), true);
  assert.equal(cavpad.includes("Reasoning: ${cavAiReasoningLabel}"), true);

  assert.equal(cavcodePage.includes("toReasoningDisplayLabel(\"low\")"), true);
  assert.equal(cavcodePage.includes("|| toReasoningDisplayLabel(createAgentAiReasoningLevel)"), true);
  assert.equal(cavcodePage.includes("|| toReasoningDisplayLabel(option);"), true);
});

test("plan and pricing compare tables use Fast/Balanced/Deep/Max language", () => {
  const planPage = read("app/plan/page.tsx");
  const pricing = read("app/CAVBOT-2.0/pricing.html");

  assert.equal(planPage.includes("Fast-Balanced"), true);
  assert.equal(planPage.includes("Fast-Deep"), true);
  assert.equal(planPage.includes("Fast-Max"), true);

  assert.equal(pricing.includes("Fast-Balanced"), true);
  assert.equal(pricing.includes("Fast-Deep"), true);
  assert.equal(pricing.includes("Fast-Max"), true);

  assert.equal(planPage.includes("Low-Medium"), false);
  assert.equal(planPage.includes("Low-High"), false);
  assert.equal(planPage.includes("Low-Extra High"), false);

  assert.equal(pricing.includes("Low-Medium"), false);
  assert.equal(pricing.includes("Low-High"), false);
  assert.equal(pricing.includes("Low-Extra High"), false);
});
