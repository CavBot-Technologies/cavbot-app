import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("auth session bootstrap uses strict requireSession validation", () => {
  const source = read("app/api/auth/session/route.ts");

  assert.match(source, /requireSession,/);
  assert.match(source, /let sess: CavbotSession \| null = await getSession\(req\)\.catch\(\(\) => null\);/);
  assert.match(source, /sess = await requireSession\(req\);/);
  assert.doesNotMatch(source, /const sess: CavbotSession \| null = await getSession\(req\);/);
});
