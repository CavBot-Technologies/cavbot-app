import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(file: string) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

test("left-nav pages include deterministic recommendation wiring", () => {
  const commandCenter = read("app/page.tsx");
  const consolePage = read("app/console/page.tsx");
  const errorsPage = read("app/errors/page.tsx");
  const seoPage = read("app/seo/page.tsx");
  const routesPage = read("app/routes/page.tsx");
  const a11yPage = read("app/a11y/page.tsx");
  const controlRoomPage = read("app/404-control-room/page.tsx");

  assert.equal(commandCenter.includes('panelId="command-center"'), true);
  assert.equal(consolePage.includes('panelId="console"'), true);
  assert.equal(errorsPage.includes('panelId="errors"'), true);
  assert.equal(seoPage.includes('panelId="seo"'), true);
  assert.equal(routesPage.includes('panelId="routes"'), true);
  assert.equal(a11yPage.includes('panelId="a11y"'), true);
  assert.equal(controlRoomPage.includes('panelId="control-room"'), true);
});

test("insights page pulls persisted deterministic packs before legacy fallback", () => {
  const source = read("app/insights/page.tsx");
  assert.equal(source.includes("/api/cavai/packs?origin="), true);
  assert.equal(source.includes("requestPersistedPack"), true);
  assert.equal(source.includes("applyPack(pack);"), true);
});

test("shared recommendations component enforces evidence-linked deterministic actions", () => {
  const source = read("components/CavAiRouteRecommendations.tsx");
  assert.equal(source.includes("/api/cavai/packs?origin="), true);
  assert.equal(source.includes("Evidence IDs:"), true);
  assert.equal(source.includes("intel.fixPlan"), true);
  assert.equal(source.includes("priorityToCavPadNote"), true);
  assert.equal(source.includes("resolveOpenTarget"), true);
});

test("pack retrieval endpoint is account-scoped and origin-scoped", () => {
  const source = read("app/api/cavai/packs/route.ts");
  assert.equal(source.includes("requireSession"), true);
  assert.equal(source.includes("requireAccountContext"), true);
  assert.equal(source.includes("normalizeOriginStrict"), true);
  assert.equal(source.includes("accountId: String(session.accountId || \"\")"), true);
});

test("metrics endpoint no longer returns hardcoded placeholder scores", () => {
  const source = read("app/api/metrics/route.ts");
  assert.equal(source.includes("guardianScore: 100"), false);
  assert.equal(source.includes("recovered404Rate"), false);
  assert.equal(source.includes("INSUFFICIENT_DATA"), true);
});
