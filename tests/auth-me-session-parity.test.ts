import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("auth me bootstrap keeps raw session fallback while still using strict session validation", () => {
  const source = read("app/api/auth/me/route.ts");

  assert.match(source, /getSession,/);
  assert.match(source, /requireSession,/);
  assert.match(source, /let sess: CavbotSession \| null = await getSession\(req\)\.catch\(\(\) => null\);/);
  assert.match(source, /sess = await requireSession\(req\);/);
  assert.match(source, /return json\(\{ ok: true, authenticated: false, signedOut: true, error: error\.code, capabilities: \{ aiReady: false \} \}, 200\);/);
});
