import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcloud tree loader skips permanent-status retry storms", () => {
  const source = read("app/cavcloud/CavCloudClient.tsx");

  assert.match(source, /function shouldRetryCavcloudTreeLoad/);
  assert.match(source, /if \(401 === l \|\| 403 === l \|\| 404 === l\) return !1;/);
  assert.match(source, /shouldRetryCavcloudTreeLoad\(a\.status, t\)/);
});

test("cavcloud global share index stops auto-retrying after a server failure and exposes retry", () => {
  const source = read("app/cavcloud/CavCloudClient.tsx");

  assert.match(source, /\[collabLaunchGlobalIndexError, setCollabLaunchGlobalIndexError\]/);
  assert.match(source, /collabLaunchGlobalIndexBusy \|\| collabLaunchGlobalIndexError \|\| collabLaunchGlobalIndexInFlightRef\.current/);
  assert.match(source, /setCollabLaunchGlobalIndexError\(e\), l3\("bad", e\)/);
  assert.match(source, /retryCollabLaunchGlobalIndex = \(0, c\.useCallback\)\(\(\) => \{/);
  assert.match(source, /children:\s*"Retry"/);
  assert.match(source, /Indexing stopped after a server error\. Retry to continue\./);
});
