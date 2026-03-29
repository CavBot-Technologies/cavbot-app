import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

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
    if (!prevDatabaseUrl) delete process.env.DATABASE_URL;
  }
}

const { classifyAiActionClass } = loadAiPolicyModule();

test("task-aware action classing upgrades heavy code and research lanes", () => {
  assert.equal(
    classifyAiActionClass({
      surface: "center",
      action: "technical_recap",
      taskType: "code_generate",
    }),
    "heavy"
  );
  assert.equal(
    classifyAiActionClass({
      surface: "center",
      action: "web_research",
      taskType: "research",
    }),
    "premium_plus_web_research"
  );
  assert.equal(
    classifyAiActionClass({
      surface: "cavcode",
      action: "technical_recap",
      taskType: "code_fix",
    }),
    "premium_plus_heavy_coding"
  );
  assert.equal(
    classifyAiActionClass({
      surface: "cavcode",
      action: "accessibility_audit",
      taskType: "code_review",
    }),
    "premium_plus_heavy_coding"
  );
  assert.equal(
    classifyAiActionClass({
      surface: "cavcode",
      action: "competitor_research",
      taskType: "research",
    }),
    "premium_plus_web_research"
  );
});
