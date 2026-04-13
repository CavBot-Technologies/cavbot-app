import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("AppShell keeps the last known auth state during indeterminate auth refreshes and dedupes passive refreshes", () => {
  const source = read("components/AppShell.tsx");

  assert.match(source, /const authRefreshInFlightRef = useRef<Promise<void> \| null>\(null\);/);
  assert.match(source, /const authRefreshLastAtRef = useRef\(0\);/);
  assert.match(source, /if \(data\?\.indeterminate === true\) \{/);
  assert.match(source, /if \(sessionAuthenticated \|\| memberRole \|\| bootSnapshot\) \{/);
  assert.match(source, /const requestAuthRefresh = useCallback\(\(options\?: \{ force\?: boolean \}\) => \{/);
  assert.match(source, /if \(authRefreshInFlightRef\.current\) return authRefreshInFlightRef\.current;/);
  assert.match(source, /if \(authRefreshLastAtRef\.current && now - authRefreshLastAtRef\.current < 8_000\) \{/);
  assert.match(source, /void requestAuthRefresh\(\{ force: true \}\);/);
  assert.match(source, /void requestAuthRefresh\(\);/);
});
