import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import {
  ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
  ALIBABA_QWEN_ASR_MODEL_ID,
  ALIBABA_QWEN_CHARACTER_MODEL_ID,
  ALIBABA_QWEN_CODER_MODEL_ID,
  ALIBABA_QWEN_FLASH_MODEL_ID,
  ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID,
  ALIBABA_QWEN_IMAGE_MODEL_ID,
  ALIBABA_QWEN_MAX_MODEL_ID,
  ALIBABA_QWEN_PLUS_MODEL_ID,
  ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
  DEEPSEEK_CHAT_MODEL_ID,
  DEEPSEEK_REASONER_MODEL_ID,
  type AiModelRoleHint,
} from "@/src/lib/ai/model-catalog";

function loadAiPolicyModule() {
  const req = createRequire(import.meta.url);
  const prevDatabaseUrl = process.env.DATABASE_URL;
  if (!prevDatabaseUrl) {
    process.env.DATABASE_URL = "postgresql://localhost:5432/cavbot_test";
  }
  const moduleLoader = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return req(path.resolve("src/lib/ai/ai.policy.ts")) as typeof import("../src/lib/ai/ai.policy");
  } finally {
    moduleLoader._load = originalLoad;
    if (!prevDatabaseUrl) {
      delete process.env.DATABASE_URL;
    }
  }
}

const {
  classifyAiActionClass,
  resolveMaxReasoningLevelForPlan,
  resolveResearchToolBundle,
  resolveVisibleModelCatalogForContext,
  resolveVisibleModelCatalogForPlan,
} = loadAiPolicyModule();

function textModel(args: {
  id: string;
  label: string;
  providerId: "deepseek" | "alibaba_qwen";
  role: "chat" | "reasoning";
  codingDefault?: boolean;
  premiumPlusOnly?: boolean;
  researchCapable?: boolean;
  requiresWebResearchMode?: boolean;
  supportsResearchTools?: boolean;
}) {
  return {
    id: args.id,
    label: args.label,
    providerId: args.providerId,
    roles: [args.role] as AiModelRoleHint[],
    metadata: {
      provider: args.providerId,
      researchCapable: args.researchCapable === true,
      codingDefault: args.codingDefault === true,
      premiumPlusOnly: args.premiumPlusOnly === true,
      requiresWebResearchMode: args.requiresWebResearchMode === true,
      supportsThinkingMode: true,
      supportsResearchTools: args.supportsResearchTools === true,
    },
  };
}

function buildCatalog() {
  return {
    text: [
      textModel({ id: DEEPSEEK_CHAT_MODEL_ID, label: "DeepSeek Chat", providerId: "deepseek", role: "chat" }),
      textModel({ id: ALIBABA_QWEN_FLASH_MODEL_ID, label: "Qwen3.5-Flash", providerId: "alibaba_qwen", role: "chat" }),
      textModel({ id: DEEPSEEK_REASONER_MODEL_ID, label: "DeepSeek Reasoner", providerId: "deepseek", role: "reasoning", researchCapable: true }),
      textModel({ id: ALIBABA_QWEN_PLUS_MODEL_ID, label: "Qwen3.5-Plus", providerId: "alibaba_qwen", role: "chat", researchCapable: true }),
      textModel({
        id: ALIBABA_QWEN_MAX_MODEL_ID,
        label: "Qwen3-Max",
        providerId: "alibaba_qwen",
        role: "reasoning",
        premiumPlusOnly: true,
        researchCapable: true,
        requiresWebResearchMode: true,
        supportsResearchTools: true,
      }),
      textModel({ id: ALIBABA_QWEN_CODER_MODEL_ID, label: "Caven (powered by Qwen3-Coder)", providerId: "alibaba_qwen", role: "reasoning", codingDefault: true }),
      textModel({ id: ALIBABA_QWEN_CHARACTER_MODEL_ID, label: "CavBot Companion", providerId: "alibaba_qwen", role: "chat" }),
    ],
    audio: [
      {
        id: ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
        label: "Qwen3-ASR-Flash-Realtime",
        providerId: "alibaba_qwen" as const,
        capability: "transcription" as const,
      },
      {
        id: ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
        label: "Qwen3-TTS-Instruct-Flash-Realtime",
        providerId: "alibaba_qwen" as const,
        capability: "speech" as const,
      },
      {
        id: ALIBABA_QWEN_ASR_MODEL_ID,
        label: "Qwen3-ASR-Flash",
        providerId: "alibaba_qwen" as const,
        capability: "transcription" as const,
      },
    ],
    image: [
      {
        id: ALIBABA_QWEN_IMAGE_MODEL_ID,
        label: "Image Studio (Qwen-Image-2.0-Pro)",
        providerId: "alibaba_qwen" as const,
        capability: "generation" as const,
      },
      {
        id: ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID,
        label: "Image Edit (Qwen-Image-Edit-Max)",
        providerId: "alibaba_qwen" as const,
        capability: "edit" as const,
      },
    ],
  };
}

test("web_research action is classified into dedicated premium-plus research class", () => {
  const actionClass = classifyAiActionClass({
    surface: "center",
    action: "web_research",
  });
  assert.equal(actionClass, "premium_plus_web_research");
});

test("research tool bundle resolves to web_search + web_extractor + code_interpreter by default", () => {
  const previous = {
    webSearch: process.env.CAVAI_RESEARCH_TOOL_WEB_SEARCH_ENABLED,
    webExtractor: process.env.CAVAI_RESEARCH_TOOL_WEB_EXTRACTOR_ENABLED,
    codeInterpreter: process.env.CAVAI_RESEARCH_TOOL_CODE_INTERPRETER_ENABLED,
    researchEnabled: process.env.CAVAI_RESEARCH_ENABLED,
    researchKillSwitch: process.env.CAVAI_RESEARCH_KILL_SWITCH,
  };

  process.env.CAVAI_RESEARCH_ENABLED = "true";
  process.env.CAVAI_RESEARCH_KILL_SWITCH = "false";
  process.env.CAVAI_RESEARCH_TOOL_WEB_SEARCH_ENABLED = "true";
  process.env.CAVAI_RESEARCH_TOOL_WEB_EXTRACTOR_ENABLED = "true";
  process.env.CAVAI_RESEARCH_TOOL_CODE_INTERPRETER_ENABLED = "true";

  try {
    const bundle = resolveResearchToolBundle("premium_plus_web_research");
    assert.deepEqual(bundle, ["web_search", "web_extractor", "code_interpreter"]);
  } finally {
    process.env.CAVAI_RESEARCH_TOOL_WEB_SEARCH_ENABLED = previous.webSearch;
    process.env.CAVAI_RESEARCH_TOOL_WEB_EXTRACTOR_ENABLED = previous.webExtractor;
    process.env.CAVAI_RESEARCH_TOOL_CODE_INTERPRETER_ENABLED = previous.codeInterpreter;
    process.env.CAVAI_RESEARCH_ENABLED = previous.researchEnabled;
    process.env.CAVAI_RESEARCH_KILL_SWITCH = previous.researchKillSwitch;
  }
});

test("plan visibility maps to the approved model stack", () => {
  const previousQwenMaxEnabled = process.env.CAVAI_QWEN_MAX_ENABLED;
  process.env.CAVAI_QWEN_MAX_ENABLED = "true";

  const modelCatalog = buildCatalog();

  try {
    const free = resolveVisibleModelCatalogForPlan({
      planId: "free",
      memberRole: "OWNER",
      allowTeamAiAccess: true,
      modelCatalog,
    });
    assert.deepEqual(
      free.text.map((row) => row.id),
      [DEEPSEEK_CHAT_MODEL_ID, ALIBABA_QWEN_FLASH_MODEL_ID, ALIBABA_QWEN_CHARACTER_MODEL_ID]
    );
    assert.deepEqual(free.audio.map((row) => row.id), [
      ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
      ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
      ALIBABA_QWEN_ASR_MODEL_ID,
    ]);
    assert.deepEqual(free.image.map((row) => row.id), []);

    const premium = resolveVisibleModelCatalogForPlan({
      planId: "premium",
      memberRole: "OWNER",
      allowTeamAiAccess: true,
      modelCatalog,
    });
    assert.equal(premium.text.some((row) => row.id === DEEPSEEK_CHAT_MODEL_ID), true);
    assert.equal(premium.text.some((row) => row.id === ALIBABA_QWEN_FLASH_MODEL_ID), true);
    assert.equal(premium.text.some((row) => row.id === DEEPSEEK_REASONER_MODEL_ID), true);
    assert.equal(premium.text.some((row) => row.id === ALIBABA_QWEN_PLUS_MODEL_ID), true);
    assert.equal(premium.text.some((row) => row.id === ALIBABA_QWEN_CODER_MODEL_ID), true);
    assert.equal(premium.text.some((row) => row.id === ALIBABA_QWEN_MAX_MODEL_ID), false);
    assert.equal(premium.text.some((row) => row.id === ALIBABA_QWEN_CHARACTER_MODEL_ID), true);
    assert.deepEqual(premium.audio.map((row) => row.id), [
      ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
      ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
      ALIBABA_QWEN_ASR_MODEL_ID,
    ]);
    assert.deepEqual(premium.image.map((row) => row.id), [ALIBABA_QWEN_IMAGE_MODEL_ID]);

    const premiumPlus = resolveVisibleModelCatalogForPlan({
      planId: "premium_plus",
      memberRole: "OWNER",
      allowTeamAiAccess: true,
      modelCatalog,
    });
    assert.equal(premiumPlus.text.some((row) => row.id === DEEPSEEK_CHAT_MODEL_ID), true);
    assert.equal(premiumPlus.text.some((row) => row.id === ALIBABA_QWEN_FLASH_MODEL_ID), true);
    assert.equal(premiumPlus.text.some((row) => row.id === DEEPSEEK_REASONER_MODEL_ID), true);
    assert.equal(premiumPlus.text.some((row) => row.id === ALIBABA_QWEN_PLUS_MODEL_ID), true);
    assert.equal(premiumPlus.text.some((row) => row.id === ALIBABA_QWEN_MAX_MODEL_ID), true);
    assert.equal(premiumPlus.text.some((row) => row.id === ALIBABA_QWEN_CODER_MODEL_ID), true);
    assert.equal(premiumPlus.text.some((row) => row.id === ALIBABA_QWEN_CHARACTER_MODEL_ID), true);
    assert.deepEqual(premiumPlus.audio.map((row) => row.id), [
      ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
      ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
      ALIBABA_QWEN_ASR_MODEL_ID,
    ]);
    assert.deepEqual(premiumPlus.image.map((row) => row.id), [ALIBABA_QWEN_IMAGE_MODEL_ID, ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID]);
  } finally {
    process.env.CAVAI_QWEN_MAX_ENABLED = previousQwenMaxEnabled;
  }
});

test("Caven is premium-visible and cavcode context stays coder-only", () => {
  const modelCatalog = buildCatalog();

  const freeCavcodeCatalog = resolveVisibleModelCatalogForContext({
    planId: "free",
    memberRole: "OWNER",
    allowTeamAiAccess: true,
    surface: "cavcode",
    action: "explain_code",
    modelCatalog,
  });
  assert.deepEqual(freeCavcodeCatalog.text.map((row) => row.id), []);
  assert.deepEqual(freeCavcodeCatalog.image.map((row) => row.id), []);

  const centerCatalog = resolveVisibleModelCatalogForContext({
    planId: "premium_plus",
    memberRole: "OWNER",
    allowTeamAiAccess: true,
    surface: "center",
    action: "write_note",
    modelCatalog,
  });
  assert.equal(centerCatalog.text.some((row) => row.id === ALIBABA_QWEN_CODER_MODEL_ID), true);
  assert.deepEqual(centerCatalog.image.map((row) => row.id), [ALIBABA_QWEN_IMAGE_MODEL_ID, ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID]);

  const cavcodeCatalog = resolveVisibleModelCatalogForContext({
    planId: "premium_plus",
    memberRole: "OWNER",
    allowTeamAiAccess: true,
    surface: "cavcode",
    action: "explain_code",
    modelCatalog,
  });
  assert.deepEqual(cavcodeCatalog.text.map((row) => row.id), [ALIBABA_QWEN_CODER_MODEL_ID]);
  assert.deepEqual(cavcodeCatalog.image.map((row) => row.id), []);
});

test("Qwen3-Max visibility is disabled when qwen max kill switch env is false", () => {
  const previousQwenMaxEnabled = process.env.CAVAI_QWEN_MAX_ENABLED;
  process.env.CAVAI_QWEN_MAX_ENABLED = "false";
  const modelCatalog = buildCatalog();

  try {
    const premiumPlus = resolveVisibleModelCatalogForPlan({
      planId: "premium_plus",
      memberRole: "OWNER",
      allowTeamAiAccess: true,
      modelCatalog,
    });
    assert.equal(premiumPlus.text.some((row) => row.id === ALIBABA_QWEN_MAX_MODEL_ID), false);
  } finally {
    process.env.CAVAI_QWEN_MAX_ENABLED = previousQwenMaxEnabled;
  }
});

test("reasoning levels stay gated by plan tier", () => {
  assert.equal(resolveMaxReasoningLevelForPlan({ planId: "free" }), "medium");
  assert.equal(resolveMaxReasoningLevelForPlan({ planId: "premium" }), "high");
  assert.equal(resolveMaxReasoningLevelForPlan({ planId: "premium_plus" }), "extra_high");
});
