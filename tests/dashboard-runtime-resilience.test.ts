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

  assert.match(guardrailsRoute, /getWorkspaceProjectGuardrails/);
  assert.doesNotMatch(guardrailsRoute, /prisma\.projectGuardrails/);
  assert.match(scanStatusRoute, /getWorkspaceProjectScanStatus/);
  assert.doesNotMatch(scanStatusRoute, /getProjectScanStatus/);
  assert.match(guardrailsHelper, /export async function getWorkspaceProjectGuardrails/);
  assert.match(guardrailsHelper, /INSERT INTO "ProjectGuardrails"/);
  assert.match(scanHelper, /FROM "ScanJob" job/);
});

test("workspace guardrails GET stays read-only while PATCH keeps the upsert path", () => {
  const guardrailsRoute = read("app/api/workspaces/[projectId]/guardrails/route.ts");

  assert.match(guardrailsRoute, /const guardrails = await getWorkspaceProjectGuardrails\(project\.id\);/);
  assert.match(guardrailsRoute, /const guardrails = await ensureWorkspaceProjectGuardrails\(project\.id, data\);/);
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

test("optional CavAI packs polling degrades to an empty response instead of throwing 500s", () => {
  const packsRoute = read("app/api/cavai/packs/route.ts");

  assert.match(packsRoute, /degraded empty response/);
  assert.match(packsRoute, /pack: null/);
  assert.match(packsRoute, /history: \[\]/);
  assert.match(packsRoute, /degraded: true/);
  assert.doesNotMatch(packsRoute, /return json\(\s*\{\s*ok: false,\s*requestId,\s*error: "SERVER_ERROR"/);
});

test("command center notices and removed-sites list render as signal text with capped scrolling", () => {
  const page = read("app/page.tsx");
  const css = read("app/workspace.css");

  assert.match(page, /cb-manage-site-list cb-manage-site-list--removed/);
  assert.match(css, /\.cb-noticeList \{/);
  assert.match(css, /max-height: 300px;/);
  assert.match(css, /\.cb-manage-site-list--removed \{/);
  assert.match(css, /max-height: 228px;/);
  assert.match(css, /\.cb-home-alert \{/);
  assert.doesNotMatch(css, /\.cb-noticeCard\[data-tone="good"\]\s*\{\s*border-color:/);
});
