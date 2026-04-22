import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("snippet generators do not throw at import time when app origin env is absent", () => {
  const source = read("lib/settings/snippetGenerators.ts");

  assert.doesNotMatch(source, /throw new Error\("Missing app origin env for snippet generation\."\)/);
  assert.match(source, /const EMBED_ANALYTICS_ENDPOINT = EMBED_API_BASE \? `\$\{EMBED_API_BASE\}\/api\/embed\/analytics` : "\/api\/embed\/analytics";/);
  assert.match(source, /const originAttr = origin \? ` data-config-origin="\$\{origin\}"` : "";/);
});
