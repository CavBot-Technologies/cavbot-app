import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavsafe auth falls back to tier-only plan lookup when trial columns drift", () => {
  const source = read("lib/cavsafe/auth.server.ts");

  assert.match(source, /findLatestEntitledSubscription\(accountId\)/);
  assert.match(source, /select:\s*\{\s*tier: true,\s*trialSeatActive: true,\s*trialEndsAt: true,\s*\}/);
  assert.match(source, /select:\s*\{\s*tier: true,\s*\}/);
  assert.match(source, /resolveEffectiveAccountPlanId\(\{\s*account,\s*subscription: entitledSubscription,\s*\}\)/);
  assert.match(source, /export async function requireCavsafeOwnerContext\(req: Request\)/);
  assert.match(source, /export async function resolveCavsafePlanIdOrDefault/);
});

test("cavsafe settings route degrades instead of surfacing bootstrap 500s", () => {
  const source = read("app/api/cavsafe/settings/route.ts");

  assert.match(source, /async function buildDegradedSettingsResponse\(req: Request\)/);
  assert.match(source, /degraded: true/);
  assert.match(source, /settings: \{ \.\.\.DEFAULT_CAVSAFE_SETTINGS \}/);
  assert.match(source, /if \(isApiAuthError\(err\)\)/);
  assert.match(source, /if \(isCavSafeSettingsReadSchemaMismatch\(err\)\)/);
  assert.match(source, /resolveCavsafePlanIdOrDefault\(String\(sess\.accountId \|\| ""\), "premium"\)/);
});

test("cavsafe tree and root routes degrade on schema drift without bypassing auth errors", () => {
  const treeSource = read("app/api/cavsafe/tree/route.ts");
  const rootSource = read("app/api/cavsafe/root/route.ts");

  assert.match(treeSource, /async function buildDegradedTreeResponse\(req: Request\)/);
  assert.match(treeSource, /degraded: true/);
  assert.match(treeSource, /if \(isApiAuthError\(err\)\)/);
  assert.match(treeSource, /if \(isMissingCavSafeTablesError\(err\) \|\| isCavSafeTreeSchemaMismatch\(err\)\)/);
  assert.match(treeSource, /return await buildDegradedTreeResponse\(req\);/);

  assert.match(rootSource, /async function buildDegradedRootResponse\(req: Request\)/);
  assert.match(rootSource, /degraded: true/);
  assert.match(rootSource, /if \(isApiAuthError\(err\)\)/);
  assert.match(rootSource, /if \(isMissingCavSafeTablesError\(err\) \|\| isCavSafeRootSchemaMismatch\(err\)\)/);
});

test("cavsafe gallery and dashboard routes degrade on schema drift without bypassing auth errors", () => {
  const gallerySource = read("app/api/cavsafe/gallery/route.ts");
  const dashboardSource = read("app/api/cavsafe/dashboard/route.ts");

  assert.match(gallerySource, /async function buildDegradedGalleryResponse\(req: Request\)/);
  assert.match(gallerySource, /degraded: true/);
  assert.match(gallerySource, /files: \[\]/);
  assert.match(gallerySource, /if \(isApiAuthError\(err\)\)/);
  assert.match(gallerySource, /if \(isCavSafeGallerySchemaMismatch\(err\)\)/);

  assert.match(dashboardSource, /async function buildDegradedDashboardResponse\(req: Request\)/);
  assert.match(dashboardSource, /function degradedDashboardPayload\(tier: "PREMIUM" \| "PREMIUM_PLUS", limitBytes: number\)/);
  assert.match(dashboardSource, /degraded: true/);
  assert.match(dashboardSource, /trendPoints: \[\{ t: Date\.now\(\), usedBytes: 0 \}\]/);
  assert.match(dashboardSource, /if \(isApiAuthError\(err\)\)/);
  assert.match(dashboardSource, /if \(isMissingUsagePointTableError\(err\) \|\| isCavSafeDashboardSchemaMismatch\(err\)\)/);
});

test("cavsafe settings server falls back to defaults when settings columns drift", () => {
  const source = read("lib/cavsafe/settings.server.ts");

  assert.match(source, /export function isCavSafeSettingsSchemaMismatchError\(err: unknown\)/);
  assert.match(source, /function mergeSettingsPatch\(base: CavSafeSettings, patch: PatchInput\): CavSafeSettings/);
  assert.match(source, /if \(isMissingSettingsTableError\(err\) \|\| isCavSafeSettingsSchemaMismatchError\(err\)\) return null;/);
  assert.match(source, /if \(isCavSafeSettingsSchemaMismatchError\(err\)\) \{\s*return sanitizeForTier\(\{ \.\.\.DEFAULT_CAVSAFE_SETTINGS \}, premiumPlus\);/);
  assert.match(source, /if \(isCavSafeSettingsSchemaMismatchError\(err\)\) return fallbackSettings\(row as Partial<Record<string, unknown>>\);/);
});
