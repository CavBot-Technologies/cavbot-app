import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relPath: string) {
  return fs.readFileSync(path.resolve(relPath), "utf8");
}

test("app host runtime mounts the local analytics client with first-party bootstrap", () => {
  const source = read("app/_components/AppHostRuntimeMounts.tsx");

  assert.equal(source.includes('resolveCavbotAssetPolicy("internal_runtime")'), true);
  assert.equal(source.includes("NEXT_PUBLIC_CAVBOT_PROJECT_KEY"), true);
  assert.equal(source.includes('window.CAVBOT_API_URL=window.CAVBOT_API_URL||"/api/embed/analytics"'), true);
  assert.equal(source.includes('id="cavbot-app-analytics-runtime"'), true);
});
