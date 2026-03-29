import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(file: string) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

test("app shell uses shared CavAi route awareness resolver", () => {
  const source = read("components/AppShell.tsx");
  assert.equal(source.includes("resolveCavAiRouteAwareness"), true);
  assert.equal(source.includes("buildCavAiRouteContextPayload"), true);
  assert.equal(source.includes("context={aiRouteContext}"), true);
});

test("center launcher forwards route context into center workspace", () => {
  const source = read("components/cavai/CavAiCenterLauncher.tsx");
  assert.equal(source.includes("context?: Record<string, unknown>"), true);
  assert.equal(source.includes("context={props.context}"), true);
});

test("center workspace merges route context into assist requests", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");
  assert.equal(source.includes("buildCenterRouteContextPayload"), true);
  assert.equal(source.includes("...routeContextForRequest"), true);
  assert.equal(source.includes("...launcherContext"), true);
});

test("cavcode workspace injects route awareness payload into coding requests", () => {
  const source = read("components/cavai/CavAiCodeWorkspace.tsx");
  assert.equal(source.includes("buildCavCodeRouteContextPayload"), true);
  assert.equal(source.includes("...buildCavCodeRouteContextPayload"), true);
});
