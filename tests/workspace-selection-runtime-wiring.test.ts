import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("workspace store uses runtime-safe helpers instead of Prisma", () => {
  const source = read("lib/workspaceStore.server.ts");

  assert.equal(source.includes('from "@/lib/prisma"'), false);
  assert.equal(source.includes('from "@/lib/workspaceProjects.server"'), false);
  assert.equal(source.includes('from "@prisma/client"'), false);
  assert.equal(source.includes('SELECT "id", "topSiteId"'), true);
  assert.equal(source.includes("listActiveWorkspaceSites"), true);
  assert.equal(source.includes("findAccountTier"), true);
  assert.equal(source.includes("getAuthPool"), true);
});

test("command center syncs active site selection back to server cookies", () => {
  const source = read("app/page.tsx");

  assert.equal(source.includes("persistWorkspaceSelection"), true);
  assert.equal(source.includes('fetch("/api/workspaces/selection"'), true);
  assert.equal(source.includes("activeSiteOrigin"), true);
  assert.equal(source.includes("topSiteOrigin"), true);
});

test("command center hydrates cached workspace sites before background refresh", () => {
  const source = read("app/page.tsx");

  assert.equal(source.includes("cb_workspace_projects_snapshot_v1"), true);
  assert.equal(source.includes("cb_workspace_snapshot__"), true);
  assert.equal(source.includes("readCachedWorkspaceProjects"), true);
  assert.equal(source.includes("readCachedWorkspaceSnapshot"), true);
  assert.equal(source.includes("hydrateProjectStateFromCache"), true);
  assert.equal(source.includes("loadWorkspaceBootstrap"), true);
  assert.equal(source.includes("writeCachedWorkspaceSnapshot"), true);
  assert.equal(source.includes("clearCachedWorkspaceSnapshot"), true);
  assert.equal(source.includes("siteStateProjectId"), true);
});
