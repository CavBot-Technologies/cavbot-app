import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcloud page derives owner access from validated sessions", () => {
  const source = read("app/cavcloud/page.tsx");

  assert.match(source, /requireSession/);
  assert.match(source, /const sess = await requireSession\(req\);/);
  assert.doesNotMatch(source, /await getSession\(req\)/);
});

test("cavcloud client waits for membership before protected bootstrap fetches", () => {
  const source = read("app/cavcloud/CavCloudClient.tsx");

  assert.match(source, /if \(!cavcloudSettingsLoaded \|\| "ANON" === memberRole\) return;/);
  assert.match(source, /\(0, c\.useEffect\)\(\(\) => \{\s*if \("ANON" === memberRole\) return;\s*"Synced" === S && void te\(\);\s*\}, \[S, te, memberRole\]\);/);
  assert.match(source, /\(0, c\.useEffect\)\(\(\) => \{\s*if \("ANON" === memberRole\) return;\s*"Shared" === S && void l9\(\);\s*\}, \[S, l9, memberRole\]\);/);
  assert.match(source, /\(0, c\.useEffect\)\(\(\) => \{\s*if \("ANON" === memberRole\) return;\s*"Collab" === S && void loadCollabInbox\(\);\s*\}, \[S, loadCollabInbox, memberRole\]\);/);
});
