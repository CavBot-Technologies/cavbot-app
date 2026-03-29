import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("qwen coder UI telemetry events are wired for popover, blocked/allowed selection, warnings, and upgrade CTA", () => {
  const cavcodeUi = fs.readFileSync(path.resolve("components/cavai/CavAiCodeWorkspace.tsx"), "utf8");
  const billingUi = fs.readFileSync(path.resolve("app/settings/sections/BillingClient.tsx"), "utf8");
  const merged = `${cavcodeUi}\n${billingUi}`;

  const requiredEvents = [
    "qwen_coder_popover_open",
    "qwen_coder_selection_blocked",
    "qwen_coder_selection_allowed",
    "qwen_coder_low_balance_warning_impression",
    "qwen_coder_upgrade_cta_click",
  ];

  for (const eventName of requiredEvents) {
    assert.equal(merged.includes(eventName), true);
  }
});
