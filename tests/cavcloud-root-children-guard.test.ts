import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcloud shell greeting and brand spacing are tuned for readable title-case UI", () => {
  const controls = read("components/cavcloud/CavSurfaceShellControls.tsx");
  const css = read("app/cavcloud/cavcloud.css");

  assert.match(controls, /cavcloud-headerGreetingPrefix">Hi,<\/span>/);
  assert.match(css, /\.cavcloud-headerGreeting\{[\s\S]*gap:\s*6px;/);
  assert.match(css, /\.cavcloud-headerGreeting\{[\s\S]*font-size:\s*16px;/);
  assert.match(css, /\.cavcloud-brandMenuSurface\{[\s\S]*font-size:\s*13px;/);
  assert.match(css, /\.cavcloud-brandMenuSurface\{[\s\S]*text-transform:\s*none;/);
});

test("cavcloud folder children resolution accepts the synthetic root alias", () => {
  const storage = read("lib/cavcloud/storage.server.ts");

  assert.match(storage, /async function resolveFolderIdWithRootAlias/);
  assert.match(storage, /if \(normalizedFolderId\.toLowerCase\(\) !== "root"\) return normalizedFolderId;/);
  assert.match(storage, /const folderId = await resolveFolderIdWithRootAlias\(accountId, args\.folderId\);/);
});

test("cavcloud global share index waits for an authenticated real root folder id", () => {
  const client = read("app/cavcloud/CavCloudClient.tsx");

  assert.match(client, /if \(eC \|\| "ANON" === memberRole \|\| collabLaunchGlobalIndexed/);
  assert.match(client, /fetch\("\/api\/cavcloud\/root"/);
  assert.match(client, /if \(401 === aRootRes\.status \|\| 403 === aRootRes\.status\) return;/);
  assert.match(client, /if \(401 === aRes\.status \|\| 403 === aRes\.status\) return;/);
});
