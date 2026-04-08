import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcloud settings route degrades without operator-context lookups", () => {
  const source = read("app/api/cavcloud/settings/route.ts");
  const degradedHelper = source.match(/async function buildDegradedSettingsResponse\(req: Request\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.equal(source.includes("getCavCloudOperatorContext"), false);
  assert.match(degradedHelper, /memberRole: resolveSessionMemberRole\(sess\)/);
  assert.doesNotMatch(degradedHelper, /requireAccountRole\(sess, \["OWNER"\]\)/);
  assert.match(source, /const \[settings, collabPolicy\] = await Promise\.all\(\[/);
});

test("cavcloud client skips owner-only settings fetches for non-owner sessions", () => {
  const source = read("app/cavcloud/CavCloudClient.tsx");

  assert.match(source, /updateCavcloudSettingsPatch = \(0, c\.useCallback\)\(async \(patch, options = \{\}\) => \{\s*if \(!isOwner\) return;/);
  assert.match(source, /loadCavcloudSettings = \(0, c\.useCallback\)\(async \(\) => \{\s*if \(!isOwner\) \{/);
});
