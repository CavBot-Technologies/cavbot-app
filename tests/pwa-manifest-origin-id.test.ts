import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("manifest uses a same-origin app id so multi-subdomain surfaces do not trigger Chrome id warnings", () => {
  const source = read("app/manifest.ts");

  assert.match(source, /id: "\/"/);
  assert.doesNotMatch(source, /id:\s*APP_ORIGIN/);
});
