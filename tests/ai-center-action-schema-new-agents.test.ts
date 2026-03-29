import assert from "node:assert/strict";
import test from "node:test";

import { AI_CENTER_ASSIST_ACTION_SCHEMA } from "@/src/lib/ai/ai.types";

test("ai center action schema accepts new companion and general agent actions", () => {
  const actions = [
    "financial_advisor",
    "therapist_support",
    "mentor",
    "best_friend",
    "relationship_advisor",
    "philosopher",
    "focus_coach",
    "life_strategist",
    "email_text_agent",
    "content_creator",
    "legal_privacy_terms_ethics_agent",
    "pdf_create_edit_preview_agent",
    "page_404_builder_agent",
    "doc_edit_review_agent",
  ];

  for (const action of actions) {
    const parsed = AI_CENTER_ASSIST_ACTION_SCHEMA.safeParse(action);
    assert.equal(parsed.success, true, `Expected ${action} to be a valid center action.`);
  }
});
