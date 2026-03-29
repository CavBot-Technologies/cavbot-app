import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test("ai service persists reasoning execution meta for cavcode/surface/center flows", () => {
  const serviceSource = read("src/lib/ai/ai.service.ts");

  assert.equal(count(serviceSource, "executionMeta = buildExecutionMeta({"), 5);
  assert.equal(count(serviceSource, "__cavAiMeta: executionMeta"), 5);
  assert.equal(count(serviceSource, "meta: executionMeta || undefined"), 5);

  assert.equal(serviceSource.includes("AI_SEMANTIC_VALIDATION_FAILED"), true);
  assert.equal(serviceSource.includes("checksPerformed.push(\"semantic_repair_pass\")"), true);
});

test("center and cavcode UIs resolve persisted __cavAiMeta and expose reasoning panel", () => {
  const centerSource = read("components/cavai/CavAiCenterWorkspace.tsx");
  const cavcodeSource = read("components/cavai/CavAiCodeWorkspace.tsx");

  assert.equal(centerSource.includes("row.__cavAiMeta || row.meta || null"), true);
  assert.equal(cavcodeSource.includes("row.__cavAiMeta || row.meta || null"), true);

  assert.equal(centerSource.includes("const [reasoningPanelMessageId, setReasoningPanelMessageId] = useState(\"\");"), true);
  assert.equal(cavcodeSource.includes("const [reasoningPanelMessageId, setReasoningPanelMessageId] = useState(\"\");"), true);
  assert.equal(centerSource.includes("Reasoned in ${formatReasoningDuration"), true);
  assert.equal(cavcodeSource.includes("Reasoned in ${formatReasoningDuration"), true);
});
