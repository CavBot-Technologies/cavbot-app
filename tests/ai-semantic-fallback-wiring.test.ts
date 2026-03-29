import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("center and surface assist paths keep semantic fallback for non-code tasks", () => {
  const source = read("src/lib/ai/ai.service.ts");

  assert.equal(source.includes("checksPerformed.push(\"semantic_fallback_response\")"), true);
  assert.equal(source.includes("data = buildSafeCenterFallbackResponse({"), true);
  assert.equal(source.includes("data = buildSafeSurfaceFallbackResponse({"), true);
  assert.equal(source.includes("if (!isCodeTaskType(taskType)) {"), true);
});

