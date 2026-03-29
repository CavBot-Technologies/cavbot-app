import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(file: string) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

test("ai service enriches center/surface/cavcode contexts with route awareness", () => {
  const source = read("src/lib/ai/ai.service.ts");
  assert.equal(source.includes("resolveRouteAwarenessContext"), true);
  assert.equal(source.includes("buildCavAiRouteContextPayload"), true);
  assert.equal(source.includes("const inputContext: Record<string, unknown> = {"), true);
  assert.equal(source.includes("context: inputContext"), true);
  assert.equal(source.includes("loadRouteAndWebsiteContextEnrichments"), true);
  assert.equal(source.includes("routeManifestCoverageContext"), true);
  assert.equal(source.includes("websiteKnowledgeContext"), true);
  assert.equal(source.includes('toolId: "route_manifest_reader"'), true);
  assert.equal(source.includes('toolId: "website_knowledge_reader"'), true);
});
