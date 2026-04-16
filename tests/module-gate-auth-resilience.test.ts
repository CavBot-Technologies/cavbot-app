import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("module gate fails open for premium screen routes during auth backend outages", () => {
  const source = read("lib/moduleGate.server.ts");

  assert.match(source, /import \{ isApiAuthError, requireSession, requireAccountContext \} from "@\/lib\/apiAuth";/);
  assert.match(source, /function isSafePageRead\(req: Request\)/);
  assert.match(source, /if \(mode === "screen" && isSafePageRead\(req\) && isApiAuthError\(error\) && error\.code === "AUTH_BACKEND_UNAVAILABLE"\)/);
  assert.match(source, /return \{ ok: true, planId: "premium_plus" \};/);
});
