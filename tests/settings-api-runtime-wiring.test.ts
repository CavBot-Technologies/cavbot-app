import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("settings api-key routes avoid Prisma runtime imports on deployed request paths", () => {
  const routePaths = [
    "app/api/settings/api-keys/route.ts",
    "app/api/settings/api-keys/rotate/route.ts",
    "app/api/settings/api-keys/revoke/route.ts",
    "app/api/settings/api-keys/usage/route.ts",
    "app/api/settings/sites/[siteId]/origins/route.ts",
  ];

  for (const relPath of routePaths) {
    const source = read(relPath);
    assert.equal(
      source.includes('from "@/lib/prisma"'),
      false,
      `${relPath} should not import the Prisma runtime client`,
    );
  }
});

test("settings history route avoids Prisma runtime imports on deployed request paths", () => {
  const source = read("app/api/settings/history/route.ts");

  assert.equal(source.includes('from "@/lib/prisma"'), false);
  assert.equal(source.includes("historyRuntime.server"), true);
});

test("settings api-key runtime helpers use the auth pool instead of Prisma", () => {
  const workspaceSource = read("lib/settings/apiKeyWorkspace.server.ts");
  const runtimeSource = read("lib/settings/apiKeysRuntime.server.ts");
  const historySource = read("lib/settings/historyRuntime.server.ts");

  assert.equal(workspaceSource.includes('from "@/lib/prisma"'), false);
  assert.equal(workspaceSource.includes("getAuthPool"), true);

  assert.equal(runtimeSource.includes('from "@/lib/prisma"'), false);
  assert.equal(runtimeSource.includes("getAuthPool"), true);
  assert.equal(runtimeSource.includes("withAuthTransaction"), true);

  assert.equal(historySource.includes('from "@/lib/prisma"'), false);
  assert.equal(historySource.includes("getAuthPool"), true);
});
