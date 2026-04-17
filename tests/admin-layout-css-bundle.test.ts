import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("hq styles are bundled from the root layout instead of the nested admin layout", () => {
  const rootLayout = read("app/layout.tsx");
  const adminLayout = read("app/admin-internal/layout.tsx");
  const adminRuntime = read("app/admin-internal/AdminHostRuntimeMounts.tsx");
  const adminBrainBoot = read("app/admin-internal/AdminRuntimeBrainBoot.tsx");

  assert.match(rootLayout, /import "\.\/admin-internal\/admin\.css";/);
  assert.equal(adminLayout.includes('import "./admin.css";'), false);
  assert.equal(adminLayout.includes('import "../globals.css";'), false);
  assert.equal(adminLayout.includes('import "../workspace.css";'), false);
  assert.equal(adminLayout.includes("cb-admin-dev-style-guard"), false);
  assert.equal(adminLayout.includes("AdminHostRuntimeMounts"), true);
  assert.equal(adminRuntime.includes('"use client";'), false);
  assert.equal(adminRuntime.includes("CavbotBadgeMotion"), true);
  assert.equal(adminRuntime.includes("CavAiBoot"), true);
  assert.equal(adminRuntime.includes("GlobalFooterMount"), true);
  assert.equal(adminRuntime.includes("AdminRuntimeBrainBoot"), true);
  assert.equal(adminBrainBoot.includes('"use client";'), true);
  assert.equal(adminBrainBoot.includes("bootAdminEyeTracking"), true);
  assert.equal(adminBrainBoot.includes("usePathname"), true);
  assert.equal(adminBrainBoot.includes("__cavbotHeadTrackingRefresh"), true);
  assert.equal(adminBrainBoot.includes("__cavbotEyeTrackingRefresh"), true);
  assert.equal(adminBrainBoot.includes("}, [pathname]);"), true);
});
