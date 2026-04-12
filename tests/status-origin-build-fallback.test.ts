import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const checkerSource = readFileSync(path.join(process.cwd(), "lib/status/checker.ts"), "utf8");
const pipelineSource = readFileSync(path.join(process.cwd(), "lib/system-status/pipeline.ts"), "utf8");

test("status checker avoids import-time app-origin resolution", () => {
  assert.doesNotMatch(checkerSource, /const DEFAULT_SITE_ORIGIN = getAppOrigin\(\);/);
  assert.match(checkerSource, /function getDefaultSiteOrigin\(\)/);
  assert.match(checkerSource, /return DEFAULT_SITE_ORIGIN_FALLBACK;/);
});

test("system status pipeline avoids import-time app-origin resolution", () => {
  assert.doesNotMatch(pipelineSource, /const DEFAULT_SITE_ORIGIN = getAppOrigin\(\);/);
  assert.match(pipelineSource, /function getDefaultSiteOrigin\(\)/);
  assert.match(pipelineSource, /return DEFAULT_SITE_ORIGIN_FALLBACK;/);
});
