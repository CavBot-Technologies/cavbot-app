import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const cavcodePath = path.resolve("app/cavcode/page.tsx");

test("cavcode agent catalog includes companion and new general agents", () => {
  const source = fs.readFileSync(cavcodePath, "utf8");

  const required = [
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

  for (const needle of required) {
    assert.equal(source.includes(needle), true, `Missing ${needle} in CavCode catalog.`);
  }

  assert.equal(source.includes('minimumPlan: "premium"'), true);
  assert.equal(source.includes('/icons/finance-symbol-of-four-currencies-on-a-hand-svgrepo-com.svg'), true);
  assert.equal(source.includes('/icons/pdf-file-svgrepo-com.svg'), true);
  assert.equal(source.includes('/icons/link-broken-svgrepo-com.svg'), true);
});
