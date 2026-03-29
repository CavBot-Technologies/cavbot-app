import assert from "node:assert/strict";
import test from "node:test";

import { inferCenterActionFromPrompt, resolveCenterActionForTask } from "@/src/lib/ai/ai.center-routing";

test("general prompt inference is semantic and not locked to default write_note", () => {
  assert.equal(
    inferCenterActionFromPrompt(
      "Summarize this thread into decisions and next steps.",
      "write_note"
    ),
    "summarize_thread"
  );
  assert.equal(
    inferCenterActionFromPrompt(
      "Research recent SERP changes and cite sources for CavBot SEO strategy.",
      "write_note"
    ),
    "web_research"
  );
  assert.equal(
    inferCenterActionFromPrompt(
      "Write a full HTML front page with CSS and JavaScript in one file.",
      "write_note"
    ),
    "technical_recap"
  );
  assert.equal(
    inferCenterActionFromPrompt(
      "Write me a note to my team about this release timeline.",
      "technical_recap"
    ),
    "write_note"
  );
  assert.equal(
    inferCenterActionFromPrompt(
      "Help me budget this month and plan spending tradeoffs.",
      "technical_recap"
    ),
    "financial_advisor"
  );
  assert.equal(
    inferCenterActionFromPrompt(
      "Draft a professional email and a short text follow-up.",
      "technical_recap"
    ),
    "email_text_agent"
  );
});

test("server-side general action routing maps generic actions to task-appropriate lanes", () => {
  assert.equal(
    resolveCenterActionForTask({
      surface: "general",
      requestedAction: "write_note",
      taskType: "cavsafe_policy",
      researchModeRequested: false,
    }),
    "explain_access_restrictions"
  );
  assert.equal(
    resolveCenterActionForTask({
      surface: "general",
      requestedAction: "write_note",
      taskType: "planning",
      researchModeRequested: false,
    }),
    "recommend_next_steps"
  );
  assert.equal(
    resolveCenterActionForTask({
      surface: "general",
      requestedAction: "write_note",
      taskType: "general_chat",
      researchModeRequested: false,
    }),
    "technical_recap"
  );
});

test("non-general surfaces preserve explicit selected action", () => {
  assert.equal(
    resolveCenterActionForTask({
      surface: "cavsafe",
      requestedAction: "audit_access_context",
      taskType: "security_policy",
      researchModeRequested: false,
    }),
    "audit_access_context"
  );
});
