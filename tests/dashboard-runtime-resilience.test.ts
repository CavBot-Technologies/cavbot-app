import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("low-risk dashboard writes use signed-session fallback instead of strict auth backend gating", () => {
  const authSource = read("lib/apiAuth.ts");
  const selectProjectRoute = read("app/api/workspaces/select-project/route.ts");
  const selectionRoute = read("app/api/workspaces/selection/route.ts");
  const cavpadSettingsRoute = read("app/api/cavpad/settings/route.ts");

  assert.match(authSource, /export async function requireLowRiskWriteSession\(req: Request\)/);
  assert.match(selectProjectRoute, /requireLowRiskWriteSession/);
  assert.match(selectionRoute, /requireLowRiskWriteSession/);
  assert.match(cavpadSettingsRoute, /const sess = await requireLowRiskWriteSession\(req\);/);
});

test("workspace guardrails and scan status routes avoid the Prisma runtime path", () => {
  const guardrailsRoute = read("app/api/workspaces/[projectId]/guardrails/route.ts");
  const scanStatusRoute = read("app/api/workspaces/[projectId]/scan/status/route.ts");
  const guardrailsHelper = read("lib/workspaceGuardrails.server.ts");
  const scanHelper = read("lib/workspaceScans.server.ts");

  assert.match(guardrailsRoute, /ensureWorkspaceProjectGuardrails/);
  assert.doesNotMatch(guardrailsRoute, /prisma\.projectGuardrails/);
  assert.match(scanStatusRoute, /getWorkspaceProjectScanStatus/);
  assert.doesNotMatch(scanStatusRoute, /getProjectScanStatus/);
  assert.match(guardrailsHelper, /INSERT INTO "ProjectGuardrails"/);
  assert.match(scanHelper, /FROM "ScanJob" job/);
});

test("oauth providers use the canonical app origin for redirect URIs", () => {
  const googleStart = read("app/api/auth/oauth/google/start/route.ts");
  const googleCallback = read("app/api/auth/oauth/google/callback/route.ts");
  const githubStart = read("app/api/auth/oauth/github/start/route.ts");
  const githubCallback = read("app/api/auth/oauth/github/callback/route.ts");

  assert.match(googleStart, /getAppOrigin/);
  assert.match(googleCallback, /getAppOrigin/);
  assert.match(githubStart, /getAppOrigin/);
  assert.match(githubCallback, /getAppOrigin/);
});

test("the dashboard tools icon path exists for deployed bundles", () => {
  assert.equal(fs.existsSync(path.resolve("public/icons/app/tools-svgrepo-com.svg")), true);
});
