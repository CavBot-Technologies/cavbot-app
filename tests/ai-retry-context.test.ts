import assert from "node:assert/strict";
import test from "node:test";
import { buildCavCodeRetryUserJson, buildCenterRetryUserJson } from "@/src/lib/ai/ai.retry";
import { ALIBABA_QWEN_CODER_MODEL_ID, CAVAI_AUTO_MODEL_ID } from "@/src/lib/ai/model-catalog";
import type { AiCenterAssistRequest, CavCodeAssistRequest } from "@/src/lib/ai/ai.types";

test("retry payload preserves model, reasoning, attachments, and context", () => {
  const input: CavCodeAssistRequest = {
    action: "suggest_fix",
    filePath: "/app/page.tsx",
    prompt: "Fix this compile issue.",
    selectedCode: "export default function Page(){ return <main/>; }",
    diagnostics: [{ message: "Cannot find name 'main'", severity: "error" }],
  };

  const payload = buildCavCodeRetryUserJson({
    input,
    model: ALIBABA_QWEN_CODER_MODEL_ID,
    reasoningLevel: "high",
    queueEnabled: true,
    imageAttachments: [
      {
        id: "img_1",
        name: "screenshot.png",
        mimeType: "image/png",
        sizeBytes: 1123,
        dataUrl: "data:image/png;base64,AAA",
      },
    ],
    taskType: "code_fix",
    contextPack: {
      scope: "cavcode:code_fix",
      context: { filePath: "/app/page.tsx", language: "tsx" },
      signalsUsed: ["filePath", "selectedCode", "diagnostics"],
      promptSignals: ["mentions_errors"],
    },
    context: {
      activeProjectRootPath: "/app",
      mountedFolder: "/app",
    },
  });

  assert.equal(payload.model, ALIBABA_QWEN_CODER_MODEL_ID);
  assert.equal(payload.reasoningLevel, "high");
  assert.equal(payload.queueEnabled, true);
  assert.equal(payload.taskType, "code_fix");
  assert.equal(payload.imageAttachments.length, 1);
  assert.equal(payload.imageAttachments[0]?.dataUrl?.startsWith("data:image/png"), true);
  assert.equal(payload.context.activeProjectRootPath, "/app");
  assert.equal(payload.contextPack.scope, "cavcode:code_fix");
});

test("retry payload keeps stable defaults for optional fields", () => {
  const input: CavCodeAssistRequest = {
    action: "explain_code",
    filePath: "/app/utils.ts",
    prompt: "Explain this function.",
    diagnostics: [],
  };
  const payload = buildCavCodeRetryUserJson({
    input,
    model: null,
    reasoningLevel: "medium",
    queueEnabled: false,
    imageAttachments: [],
    taskType: "code_explanation",
    contextPack: {
      scope: "cavcode:code_explanation",
      context: {},
      signalsUsed: [],
      promptSignals: [],
    },
    context: {},
  });

  assert.equal(payload.selectedCode, "");
  assert.deepEqual(payload.diagnostics, []);
  assert.equal(payload.language, null);
});

test("center retry payload preserves selected mode, reasoning, and attachments", () => {
  const input: AiCenterAssistRequest = {
    action: "web_research",
    surface: "cavcode",
    prompt: "Research best ways to optimize this TypeScript build pipeline.",
    contextLabel: "CavCode context",
  };

  const payload = buildCenterRetryUserJson({
    input,
    effectiveAction: "web_research",
    model: CAVAI_AUTO_MODEL_ID,
    reasoningLevel: "high",
    actionClass: "premium_plus_web_research",
    taskType: "research",
    researchMode: true,
    researchToolBundle: ["web_search", "web_extractor"],
    researchUrls: ["https://example.com/docs"],
    imageAttachments: [
      {
        id: "img_1",
        name: "architecture.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        dataUrl: "data:image/png;base64,AAA",
      },
    ],
    contextPack: {
      scope: "cavcode:research",
      context: { launchSurface: "cavcode" },
      signalsUsed: ["launchSurface", "contextLabel"],
      promptSignals: ["contains_url"],
    },
    context: { launchSurface: "cavcode" },
  });

  assert.equal(payload.model, CAVAI_AUTO_MODEL_ID);
  assert.equal(payload.researchMode, true);
  assert.equal(payload.reasoningLevel, "high");
  assert.deepEqual(payload.researchToolBundle, ["web_search", "web_extractor"]);
  assert.equal(payload.imageAttachments[0]?.dataUrl?.startsWith("data:image/png"), true);
});
