import assert from "node:assert/strict";
import test from "node:test";
import { classifyAiTaskType } from "@/src/lib/ai/ai.quality";

test("task taxonomy classifies explicit note intent only when requested", () => {
  assert.equal(
    classifyAiTaskType({
      surface: "general",
      action: "technical_recap",
      prompt: "Write me a note about next week's release schedule.",
    }),
    "note_writing"
  );
  assert.equal(
    classifyAiTaskType({
      surface: "general",
      action: "technical_recap",
      prompt: "Write me a birthday message for my friend.",
    }),
    "writing"
  );
});

test("task taxonomy keeps SEO-in-code prompts in code lane", () => {
  assert.equal(
    classifyAiTaskType({
      surface: "general",
      action: "technical_recap",
      prompt: "Write me full HTML/CSS/JS for an SEO-ready landing page.",
    }),
    "code_generate"
  );
});

test("task taxonomy covers CavCloud/CavSafe/dashboard/productivity classes", () => {
  assert.equal(
    classifyAiTaskType({
      surface: "general",
      action: "technical_recap",
      prompt: "Organize my CavCloud folder structure by project and retention.",
    }),
    "cavcloud_organization"
  );
  assert.equal(
    classifyAiTaskType({
      surface: "general",
      action: "technical_recap",
      prompt: "Explain the errors showing in my dashboard and what to check first.",
    }),
    "dashboard_error_explanation"
  );
  assert.equal(
    classifyAiTaskType({
      surface: "general",
      action: "technical_recap",
      prompt: "Help me plan my week and prioritize tasks.",
    }),
    "planning"
  );
});

test("task taxonomy recognizes new cavcode competitor and accessibility lanes", () => {
  assert.equal(
    classifyAiTaskType({
      surface: "cavcode",
      action: "competitor_research",
      prompt: "Run a competitor benchmark for pricing, roadmap, and feature gaps.",
    }),
    "research"
  );
  assert.equal(
    classifyAiTaskType({
      surface: "cavcode",
      action: "accessibility_audit",
      prompt: "Audit this component for WCAG issues and list keyboard/focus fixes.",
    }),
    "code_review"
  );
});
