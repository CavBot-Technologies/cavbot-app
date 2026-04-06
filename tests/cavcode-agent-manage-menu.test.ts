import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcode inline agent manage menu keeps only actions and marks disable as danger", () => {
  const source = read("app/cavcode/page.tsx");

  assert.doesNotMatch(source, /cc-popover-title">Manage \{agentName\}/);
  assert.doesNotMatch(source, /cc-agentManageInlineMeta/);
  assert.doesNotMatch(source, /cc-agentManageInlineSummary/);
  assert.doesNotMatch(source, /cc-agentManageInlineNote/);
  assert.match(source, /className=\{`cc-pm-item\$\{managedAgentInstalled \? " cc-pm-itemDanger" : ""\}`\}/);
});
