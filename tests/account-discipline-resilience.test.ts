import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("account discipline auth helper does not attempt runtime schema creation", () => {
  const source = read("lib/admin/accountDiscipline.server.ts");

  assert.doesNotMatch(source, /CREATE TABLE IF NOT EXISTS/);
  assert.doesNotMatch(source, /\$executeRawUnsafe/);
  assert.match(source, /isSchemaMismatchError/);
  assert.match(source, /return null;/);
});
