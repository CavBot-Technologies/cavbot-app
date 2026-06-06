import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("arcade entertainment token minting uses signed-session auth resilience", () => {
  const source = read("app/api/arcade-ent/token/route.ts");

  assert.match(source, /requireLowRiskWriteSession/);
  assert.match(source, /const sess = await requireLowRiskWriteSession\(req\);/);
  assert.doesNotMatch(source, /requireSession\(req\)/);
});
