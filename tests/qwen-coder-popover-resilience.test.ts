import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

function loadQwenCreditsModule() {
  const req = createRequire(import.meta.url);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  if (!previousDatabaseUrl) {
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
    return req(path.resolve("src/lib/ai/qwen-coder-credits.server.ts")) as typeof import("../src/lib/ai/qwen-coder-credits.server");
  } finally {
    moduleLoader._load = originalLoad;
    if (!previousDatabaseUrl) {
      delete process.env.DATABASE_URL;
    }
  }
}

const { buildQwenCoderPopoverFallbackState, isQwenCoderCreditSchemaMismatchError } = loadQwenCreditsModule();

test("qwen popover fallback state returns a valid degraded shape without ledger data", () => {
  const state = buildQwenCoderPopoverFallbackState({
    planId: "premium_plus",
    now: new Date("2026-04-06T08:00:00.000Z"),
  });

  assert.equal(state.planId, "premium_plus");
  assert.equal(state.planLabel, "Premium+");
  assert.equal(state.contextWindow, null);
  assert.deepEqual(state.recentUsage, []);
  assert.equal(state.usage.creditsTotal, 0);
  assert.equal(state.entitlement.state, "premium_plus_exhausted");
});

test("qwen schema mismatch detector recognizes missing tables and missing columns", () => {
  assert.equal(isQwenCoderCreditSchemaMismatchError({ code: "P2021" }), true);
  assert.equal(
    isQwenCoderCreditSchemaMismatchError({
      meta: {
        code: "42703",
        message: 'column "percentUsed" of relation "coder_usage_snapshots" does not exist',
      },
    }),
    true,
  );
  assert.equal(isQwenCoderCreditSchemaMismatchError(new Error("QWEN_WALLET_CREATE_FAILED")), true);
  assert.equal(isQwenCoderCreditSchemaMismatchError(new Error("totally unrelated failure")), false);
});

test("qwen popover route degrades instead of surfacing a 500 for schema drift or state-load failures", () => {
  const routeSource = fs.readFileSync(path.resolve("app/api/ai/qwen-coder/popover/route.ts"), "utf8");
  assert.equal(routeSource.includes("buildQwenCoderPopoverFallbackState"), true);
  assert.equal(routeSource.includes("isQwenCoderCreditSchemaMismatchError"), true);
  assert.equal(routeSource.includes("buildDegradedPopoverPayload"), true);
  assert.equal(routeSource.includes("degraded after unexpected state load failure"), true);
  assert.equal(routeSource.includes("degraded before AI context resolution"), true);
  assert.equal(routeSource.includes("QWEN_CODER_POPOVER_FAILED"), false);
});
