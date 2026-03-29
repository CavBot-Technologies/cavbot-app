import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { formatPlanLabelForUi, getPlanPrice } from "../lib/plans";

test("plan UI label maps plan ids to Cav plan names", () => {
  assert.equal(formatPlanLabelForUi("premium_plus"), "CavElite");
  assert.equal(formatPlanLabelForUi("premium+"), "CavElite");
  assert.equal(formatPlanLabelForUi("enterprise"), "CavElite");
  assert.equal(formatPlanLabelForUi("premium"), "CavControl");
  assert.equal(formatPlanLabelForUi("free"), "CavTower");
});

test("scanner card does not render raw planId slug", () => {
  const source = fs.readFileSync(path.resolve("components/ScannerControlCard.tsx"), "utf8");
  assert.equal(source.includes("Plan: <strong>{planId}</strong>"), false);
  assert.equal(source.includes("formatPlanLabelForUi(planId)"), true);
});

test("plan pricing reflects updated CavControl and CavElite pricing", () => {
  assert.equal(getPlanPrice("premium", "monthly").price, "19.99");
  assert.equal(getPlanPrice("premium", "annual").price, "199.99");
  assert.equal(getPlanPrice("premium_plus", "monthly").price, "39.99");
  assert.equal(getPlanPrice("premium_plus", "annual").price, "399.99");
});

test("plan pages surface Caven credit entitlements across free, premium, and premium plus", () => {
  const planPage = fs.readFileSync(path.resolve("app/plan/page.tsx"), "utf8");
  assert.equal(planPage.includes("Caven Credits"), true);
  assert.equal(planPage.includes("Not included on Free"), true);
  assert.equal(planPage.includes("400 credits / month"), true);
  assert.equal(planPage.includes("4,000 credits / month"), true);
  assert.equal(planPage.includes("even on yearly billing"), true);
  assert.equal(planPage.includes("Rollover up to one extra month"), true);
  assert.equal(planPage.includes("Caven (Powered by Qwen3-Coder)"), true);
  assert.equal(planPage.includes("DeepSeek Chat"), true);
  assert.equal(planPage.includes("DeepSeek Reasoner"), true);
  assert.equal(planPage.includes("Qwen3.5-Plus"), true);
  assert.equal(planPage.includes("Qwen3-Max"), true);
  assert.equal(planPage.includes("Qwen3.5-Flash"), true);
  assert.equal(planPage.includes("Qwen3-ASR-Flash-Realtime"), true);
  assert.equal(planPage.includes("Qwen3-TTS-Instruct-Flash-Realtime"), true);
  assert.equal(planPage.includes("Qwen3-ASR-Flash"), true);
  assert.equal(planPage.includes("CavBot Companion (Qwen-Plus-Character)"), true);
  assert.equal(planPage.includes("Image Studio (Qwen-Image-2.0-Pro)"), true);
  assert.equal(planPage.includes("Image Edit (Qwen-Image-Edit-Max)"), true);
  assert.equal(
    planPage.includes(
      "Caven credits are consumed based on real coding usage, including context size and task complexity. Caven is powered by Qwen3-Coder."
    ),
    true
  );

  const staticPricing = fs.readFileSync(path.resolve("app/CAVBOT-2.0/pricing.html"), "utf8");
  assert.equal(staticPricing.includes("Caven Credits"), true);
  assert.equal(staticPricing.includes("Not included on Free"), true);
  assert.equal(staticPricing.includes("400 credits / month"), true);
  assert.equal(staticPricing.includes("4,000 credits / month"), true);
  assert.equal(staticPricing.includes("even on yearly billing"), true);
  assert.equal(staticPricing.includes("Rollover up to one extra month"), true);
  assert.equal(staticPricing.includes("Caven (Powered by Qwen3-Coder)"), true);
  assert.equal(staticPricing.includes("DeepSeek Chat"), true);
  assert.equal(staticPricing.includes("DeepSeek Reasoner"), true);
  assert.equal(staticPricing.includes("Qwen3.5-Plus"), true);
  assert.equal(staticPricing.includes("Qwen3-Max"), true);
  assert.equal(staticPricing.includes("Qwen3.5-Flash"), true);
  assert.equal(staticPricing.includes("Qwen3-ASR-Flash-Realtime"), true);
  assert.equal(staticPricing.includes("Qwen3-TTS-Instruct-Flash-Realtime"), true);
  assert.equal(staticPricing.includes("Qwen3-ASR-Flash"), true);
  assert.equal(staticPricing.includes("CavBot Companion (Qwen-Plus-Character)"), true);
  assert.equal(staticPricing.includes("Image Studio (Qwen-Image-2.0-Pro)"), true);
  assert.equal(staticPricing.includes("Image Edit (Qwen-Image-Edit-Max)"), true);
});

test("qwen pricing copy does not regress to stale scale values or stale heavy-session examples", () => {
  const planPage = fs.readFileSync(path.resolve("app/plan/page.tsx"), "utf8");
  const staticPricing = fs.readFileSync(path.resolve("app/CAVBOT-2.0/pricing.html"), "utf8");
  const merged = `${planPage}\n${staticPricing}`;

  const stalePhrases = [
    "1,860 / 3,000",
    "24,000 bank",
    "12,000 bank",
    "48,000",
    "8–20 heavy sessions",
    "80–200 heavy sessions",
    "8-20 heavy sessions",
    "80-200 heavy sessions",
  ];

  for (const phrase of stalePhrases) {
    assert.equal(merged.includes(phrase), false);
  }
});
