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

  assert.match(client, /if \(eC \|\| !memberRoleResolved \|\| "ANON" === memberRole \|\| collabLaunchGlobalIndexed/);
  assert.match(client, /fetch\("\/api\/cavcloud\/root"/);
  assert.match(client, /if \(401 === aRootRes\.status \|\| 403 === aRootRes\.status\) return;/);
  assert.match(client, /syncCavcloudReadHealth\(aRootRes\.status, lRootPayload\)/);
  assert.match(client, /if \(401 === aRes\.status \|\| 403 === aRes\.status\) return;/);
});

test("cavcloud blocks folder writes when degraded read health is detected", () => {
  const client = read("app/cavcloud/CavCloudClient.tsx");

  assert.match(client, /\[cavcloudWritesBlocked,\s*setCavcloudWritesBlocked\]\s*=\s*\(0,\s*c\.useState\)\(!1\)/);
  assert.match(client, /setCavcloudWritesBlocked\(!0\), setCavcloudWritesBlockedReason\(cavcloudWriteUnavailableMessage/);
  assert.match(client, /if \(cavcloudWritesBlocked\) \{\s*let e = getCavcloudWriteBlockMessage\(\);\s*av\(e\), l3\("bad", e\);\s*return;\s*\}/);
  assert.match(client, /if \(cavcloudWritesBlocked\) return l3\("bad", getCavcloudWriteBlockMessage\(\)\), !1;/);
  assert.match(client, /if \(cavcloudWritesBlocked\) throw Error\(getCavcloudWriteBlockMessage\(\)\);/);
});
