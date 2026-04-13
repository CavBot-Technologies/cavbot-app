import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("auth me bootstrap uses strict session validation and degrades to signed-out bootstrap on auth failure", () => {
  const source = read("app/api/auth/me/route.ts");

  assert.match(source, /requireSession,/);
  assert.match(source, /sess = await requireSession\(req\);/);
  assert.doesNotMatch(source, /const sess: CavbotSession \| null = await getSession\(req\);/);
  assert.match(source, /return json\(\{ ok: true, authenticated: false, error: error\.code, capabilities: \{ aiReady: false \} \}, 200\);/);
});
