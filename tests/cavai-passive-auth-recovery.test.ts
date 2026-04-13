import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("CavAi center revalidates auth before passive protected bootstrap and resume loads", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.match(source, /const applyUnauthenticatedCenterState = useCallback\(\(\) => \{/);
  assert.match(source, /const refreshAuthProfile = useCallback\(async \(opts\?: \{ cancelled\?: \(\) => boolean \}\): Promise<boolean> => \{/);
  assert.match(source, /if \(!shouldWarm \|\| !authProbeReady\) return;/);
  assert.match(source, /const authenticated = await refreshAuthProfile\(\);/);
  assert.match(source, /if \(isAuthRequiredLikeResponse\(res\.status, body\)\) \{\s*applyUnauthenticatedCenterState\(\);/);
  assert.doesNotMatch(source, /if \(nextAuthenticatedHint\) \{\s*setIsAuthenticated\(true\);\s*\}/);
  assert.match(source, /if \(!shouldWarm \|\| !authProbeReady \|\| !isAuthenticated\) return;/);
});

test("CavAi code workspace gates passive settings and session bootstrap behind auth readiness", () => {
  const source = read("components/cavai/CavAiCodeWorkspace.tsx");

  assert.match(source, /const \[isAuthenticated, setIsAuthenticated\] = useState\(\(\) => bootAuthenticatedHint\);/);
  assert.match(source, /const \[authProbeReady, setAuthProbeReady\] = useState\(false\);/);
  assert.match(source, /const applyUnauthenticatedCodeState = useCallback\(\(\) => \{/);
  assert.match(source, /const refreshCodeAuthState = useCallback\(async \(opts\?: \{ cancelled\?: \(\) => boolean \}\): Promise<boolean> => \{/);
  assert.match(source, /if \(!authProbeReady \|\| !isAuthenticated\) \{/);
  assert.match(source, /if \(isAuthRequiredLikeResponse\(res\.status, body\)\) \{\s*applyUnauthenticatedCodeState\(\);/);
});

test("CavCode page still performs a silent installed-agent refresh on mount", () => {
  const source = read("app/cavcode/page.tsx");

  assert.match(source, /const refreshInstalledAgentsFromSettings = useCallback\(async \(silent = false\) => \{/);
  assert.match(source, /void refreshInstalledAgentsFromSettings\(true\);/);
});
