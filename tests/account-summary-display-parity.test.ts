import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("shared account-summary helpers define the canonical display name and plan label language", () => {
  const source = read("lib/profileIdentity.ts");

  assert.match(source, /export function resolveAccountDisplayName\(input: \{/);
  assert.match(source, /export function resolveAccountPlanLabel\(input: \{/);
  assert.match(source, /if \(planId === "premium_plus"\) return "Premium\+";/);
  assert.match(source, /if \(planId === "premium"\) return "Premium";/);
  assert.match(source, /return "Free";/);
});

test("app shell and CavAi center both consume the same canonical account-summary helpers", () => {
  const appShellSource = read("components/AppShell.tsx");
  const cavaiSource = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.match(appShellSource, /return resolveAccountDisplayName\(\{/);
  assert.match(appShellSource, /return resolveAccountPlanLabel\(\{/);
  assert.match(cavaiSource, /return resolveAccountDisplayName\(\{/);
  assert.match(cavaiSource, /const accountPlanLabel = useMemo\(\(\) => resolveAccountPlanLabel\(\{/);
  assert.doesNotMatch(cavaiSource, /function toPlanTierLabel/);
});
