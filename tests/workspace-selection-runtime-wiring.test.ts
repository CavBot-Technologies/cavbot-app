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
  assert.equal(source.includes("resolveAccountWorkspaceProject"), true);
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
