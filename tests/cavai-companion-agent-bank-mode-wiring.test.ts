import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const centerPath = path.resolve("components/cavai/CavAiCenterWorkspace.tsx");

test("center agent bank scopes visibility by companion/general mode", () => {
  const source = fs.readFileSync(centerPath, "utf8");

  assert.equal(source.includes('mode: "companion"'), true);
  assert.equal(source.includes('const centerAgentMode = useMemo<"general" | "companion">'), true);
  assert.equal(source.includes('selectedModel === ALIBABA_QWEN_CHARACTER_MODEL_ID ? "companion" : "general"'), true);
  assert.equal(source.includes('const scopedCenterAgentBankCatalog = useMemo('), true);
  assert.equal(source.includes('agent.mode === centerAgentMode'), true);
  assert.equal(source.includes('const centerPrimaryFamilyLabel = centerAgentMode === "companion" ? "CavBot Companion" : "CavAi";'), true);
});

test("center built-in catalog includes required companion and new general agents", () => {
  const source = fs.readFileSync(centerPath, "utf8");

  const requiredAgentIds = [
    'id: "financial_advisor"',
    'id: "therapist_support"',
    'id: "mentor"',
    'id: "best_friend"',
    'id: "relationship_advisor"',
    'id: "philosopher"',
    'id: "focus_coach"',
    'id: "life_strategist"',
    'id: "email_text_agent"',
    'id: "content_creator"',
    'id: "legal_privacy_terms_ethics_agent"',
    'id: "pdf_create_edit_preview_agent"',
    'id: "page_404_builder_agent"',
    'id: "doc_edit_review_agent"',
  ];

  for (const needle of requiredAgentIds) {
    assert.equal(source.includes(needle), true, `Missing ${needle} in center agent catalog.`);
  }
});
