import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSemanticRepairDirective,
  buildSurfaceContextPack,
  classifyAiTaskType,
  evaluateAiAnswerQuality,
  formatReasoningDuration,
  shouldShowReasoningChip,
} from "@/src/lib/ai/ai.quality";
import {
  ALIBABA_QWEN_CODER_MODEL_ID,
  DEEPSEEK_CHAT_MODEL_ID,
} from "@/src/lib/ai/model-catalog";

test("task classification routes SEO intent to seo", () => {
  const task = classifyAiTaskType({
    surface: "center",
    action: "write_note",
    prompt: "Write me a note that helps me rank #1 on Google for CavBot.",
  });
  assert.equal(task, "seo");
});

test("task classification prioritizes concrete code generation even with SEO wording", () => {
  const task = classifyAiTaskType({
    surface: "general",
    action: "write_note",
    prompt: "Write me a full HTML front page with CSS and JS together, and make it SEO ready.",
  });
  assert.equal(task, "code_generate");
});

test("surface context pack keeps scope focused for cavcode", () => {
  const pack = buildSurfaceContextPack({
    surface: "cavcode",
    taskType: "code_fix",
    prompt: "Fix this failing TypeScript function",
    context: {
      selectedCode: "function bad(){return true as unknown as string;}",
      diagnostics: [{ message: "Type 'boolean' is not assignable to type 'string'" }],
      filePath: "/app/page.tsx",
      billingStatus: "trial",
    },
  });
  assert.equal(pack.scope, "cavcode:code_fix");
  assert.equal(pack.signalsUsed.includes("selectedCode"), true);
  assert.equal(pack.signalsUsed.includes("diagnostics"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(pack.context, "billingStatus"), false);
});

test("surface context pack preserves route/page awareness keys for general requests", () => {
  const pack = buildSurfaceContextPack({
    surface: "general",
    taskType: "writing",
    prompt: "Rewrite this title",
    context: {
      pageAwareness: {
        routeCategory: "settings",
        routePathname: "/settings",
      },
      routePathname: "/settings",
      randomBlob: "drop-me",
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(pack.context, "pageAwareness"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(pack.context, "routePathname"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(pack.context, "randomBlob"), false);
});

test("semantic validation rejects SEO answers that drift into CavSafe", () => {
  const quality = evaluateAiAnswerQuality({
    prompt: "Write me a note that will help me rank number 1 on Google. What do I need to do on CavBot?",
    answer: "Enable CavSafe ACL policies first, then lock private access in CavSafe.",
    surface: "center",
    taskType: "seo",
  });
  assert.equal(quality.passed, false);
  assert.equal(quality.hardFail, true);
  assert.equal(quality.reasons.some((reason) => reason.toLowerCase().includes("drifted into security")), true);
});

test("diagnostics answers stay valid when they remain in diagnostics domain", () => {
  const quality = evaluateAiAnswerQuality({
    prompt: "Explain this latency spike and what to check next.",
    answer: [
      "The spike matches a database timeout pattern and queue saturation.",
      "1. Check error logs for timeout bursts.",
      "2. Verify p95 latency by endpoint and compare to baseline.",
      "3. Re-run diagnostics after reducing concurrent worker load.",
    ].join("\n"),
    surface: "console",
    taskType: "diagnostics_explanation",
  });
  assert.equal(quality.passed, true);
  assert.equal(quality.hardFail, false);
});

test("code answers fail when they drift into marketing language", () => {
  const quality = evaluateAiAnswerQuality({
    prompt: "Fix this TypeScript compile error in my component.",
    answer: "Upgrade to a premium billing plan for better support and discounts.",
    surface: "cavcode",
    taskType: "code_fix",
  });
  assert.equal(quality.passed, false);
  assert.equal(quality.hardFail, true);
});

test("code answers are not falsely marked as marketing when using technical plan wording", () => {
  const quality = evaluateAiAnswerQuality({
    prompt: "Fix this TypeScript compile error in my component.",
    answer: [
      "Code fix plan:",
      "1. Update the function return type.",
      "2. Run typecheck and tests.",
      "```ts",
      "export function ok(value: string): string {",
      "  return value.trim();",
      "}",
      "```",
    ].join("\n"),
    surface: "cavcode",
    taskType: "code_fix",
  });
  assert.equal(quality.hardFail, false);
  assert.equal(quality.reasons.some((reason) => /marketing\/billing/i.test(reason)), false);
});

test("code generation answers fail when prompt asks for code but no concrete code is returned", () => {
  const quality = evaluateAiAnswerQuality({
    prompt: "Write a single-file HTML+CSS+JS landing page template for my app.",
    answer: "Use a clean hero, then add cards and a footer with a modern style.",
    surface: "general",
    taskType: "code_generate",
  });
  assert.equal(quality.passed, false);
  assert.equal(quality.hardFail, true);
  assert.equal(quality.reasons.some((reason) => reason.includes("missing concrete code")), true);
});

test("reasoning chip gating uses real model/task/duration rules", () => {
  assert.equal(
    shouldShowReasoningChip({
      model: DEEPSEEK_CHAT_MODEL_ID,
      reasoningLevel: "high",
      taskType: "code_fix",
      durationMs: 4_800,
      researchMode: false,
    }),
    true
  );
  assert.equal(
    shouldShowReasoningChip({
      model: DEEPSEEK_CHAT_MODEL_ID,
      reasoningLevel: "low",
      taskType: "general_question",
      durationMs: 3_000,
      researchMode: false,
    }),
    false
  );
  assert.equal(
    shouldShowReasoningChip({
      model: ALIBABA_QWEN_CODER_MODEL_ID,
      reasoningLevel: "medium",
      taskType: "code_generate",
      durationMs: 1_200,
      researchMode: false,
    }),
    true
  );
});

test("reasoning duration formatting is stable", () => {
  assert.equal(formatReasoningDuration(950), "950ms");
  assert.equal(formatReasoningDuration(17_400), "17.400s");
  assert.equal(formatReasoningDuration(62_200), "1m 2.200s");
});

test("repair directive carries explicit failure context", () => {
  const directive = buildSemanticRepairDirective({
    taskType: "seo",
    surface: "center",
    reasons: ["SEO request drifted into security domain."],
  });
  assert.equal(directive.includes("Task type: seo."), true);
  assert.equal(directive.includes("Surface: center."), true);
  assert.equal(directive.includes("drifted into security"), true);
});
