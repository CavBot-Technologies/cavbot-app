import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../lib/analyticsConsole.server.ts", import.meta.url), "utf8");

test("analytics console carries Command Center workspace sites into dashboard tools", () => {
  assert.equal(source.includes("function workspaceSiteRows"), true);
  assert.equal(source.includes("function mergeSiteRows"), true);
  assert.equal(source.includes("const workspaceSites = workspaceSiteRows(workspace);"), true);
  assert.equal(source.includes("const sites = mergeSiteRows(dbSiteRows, workspaceSites);"), true);
});

test("analytics console uses the same effective workspace session as Command Center", () => {
  assert.equal(source.includes('from "@/lib/workspaceAuth.server"'), true);
  assert.equal(source.includes("requireWorkspaceResilientSession(req)"), true);
  assert.equal(source.includes("requireSession(req)"), false);
});

test("analytics console keeps workspace sites when project or site reads fail", () => {
  const emptySiteReturns = source.match(/sites:\s*\[\]/g) ?? [];
  assert.equal(emptySiteReturns.length, 1, "only unauthenticated context should return no dashboard sites");
  assert.equal(source.includes("sites: workspaceSites"), true);
  assert.equal(
    source.includes("activeSite: pickActiveSite({ searchParams: args?.searchParams, sites: workspaceSites, workspace })"),
    true,
  );
});
