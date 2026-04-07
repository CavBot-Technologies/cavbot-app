import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("workspace command center welcome badge boots from shell snapshot and label fallback", () => {
  const source = read("app/page.tsx");

  assert.equal(source.includes('const SHELL_PLAN_SNAPSHOT_KEY = "cb_shell_plan_snapshot_v1";'), true);
  assert.equal(source.includes("function readBootWorkspacePlanDetail()"), true);
  assert.equal(source.includes("globalThis.__cbLocalStore.getItem(SHELL_PLAN_SNAPSHOT_KEY)"), true);
  assert.equal(source.includes("resolvePlanIdFromTier(detail?.planKey || detail?.planLabel || \"free\")"), true);
  assert.equal(source.includes("resolvePlanIdFromTier(detail.planKey || detail.planLabel || \"free\")"), true);
});

test("workspace command center shows Premium+ verified badge to the right of the name", () => {
  const source = read("app/page.tsx");

  assert.equal(
    source.includes(
      'const welcomeShowsPremiumPlus = useMemo(() => {\n    return planId === "premium_plus" || resolvePlanIdFromTier(workspacePlanLabel) === "premium_plus";\n  }, [planId, workspacePlanLabel]);',
    ),
    true,
  );
  assert.equal(source.includes('<span className="cb-welcome-nameWrap">'), true);
  assert.equal(source.includes('className="cb-welcome-verifiedBadge"'), true);
  assert.equal(source.includes('title="Premium+ verified"'), true);
});
