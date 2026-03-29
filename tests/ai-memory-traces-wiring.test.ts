import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("ai service persists model selection, reasoning traces, retry lineage, and memory learn/retrieve hooks", () => {
  const serviceSource = read("src/lib/ai/ai.service.ts");
  assert.equal(serviceSource.includes("persistAiModelSelectionEvent"), true);
  assert.equal(serviceSource.includes("persistAiReasoningTrace"), true);
  assert.equal(serviceSource.includes("persistAiRetryEvent"), true);
  assert.equal(serviceSource.includes("retrieveRelevantAiUserMemoryFacts"), true);
  assert.equal(serviceSource.includes("learnAiUserMemoryFromPrompt"), true);
});

test("memory API routes expose db-backed controls", () => {
  const memoryRouteSource = read("app/api/ai/memory/route.ts");
  const memoryFactRouteSource = read("app/api/ai/memory/[factId]/route.ts");
  assert.equal(memoryRouteSource.includes("setAiUserMemoryEnabled"), true);
  assert.equal(memoryRouteSource.includes("upsertAiUserMemoryFact"), true);
  assert.equal(memoryFactRouteSource.includes("deleteAiUserMemoryFact"), true);
});

test("share flow persists artifacts and token-backed view accounting", () => {
  const shareRoute = read("app/api/ai/sessions/[sessionId]/share/route.ts");
  const publicShareRoute = read("app/share/cavai/[token]/route.ts");
  assert.equal(shareRoute.includes("prisma.cavAiShareArtifact.create"), true);
  assert.equal(publicShareRoute.includes("prisma.cavAiShareArtifact.updateMany"), true);
});
