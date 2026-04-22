import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcode production page does not expose diagnostics self-test hooks", () => {
  const source = read("app/cavcode/page.tsx");

  assert.doesNotMatch(source, /__CAVCODE_SELF_TEST/);
  assert.doesNotMatch(source, /CavCode diagnostics self-test ready/);
  assert.doesNotMatch(source, /SELF_TEST_FOLDER_PATH/);
  assert.doesNotMatch(source, /injectDiagnosticsSelfTestFiles/);
});
