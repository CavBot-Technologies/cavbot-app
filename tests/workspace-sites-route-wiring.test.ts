import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("command center workspace site route keeps secure site wiring parity", () => {
  const source = read("app/api/workspaces/[projectId]/sites/route.ts");

  assert.equal(source.includes("requireAccountRole(sess, [\"OWNER\", \"ADMIN\"])"), true);
  assert.equal(source.includes("registerWorkerSite(project.id, result.site.origin, result.site.label)"), true);
  assert.equal(source.includes("siteAllowedOrigin.createMany"), true);
  assert.equal(source.includes("getCavbotAppOrigins()"), true);
  assert.equal(source.includes("skipDuplicates: true"), true);
  assert.equal(source.includes("createProjectNoticeBestEffort"), true);
  assert.equal(source.includes("rollbackCreatedSiteSetup"), true);
});

test("command center add-site UI rethrows friendly errors so modal feedback stays visible", () => {
  const source = read("app/page.tsx");

  assert.equal(source.includes("function formatAddSiteErrorMessage"), true);
  assert.equal(source.includes("throw new Error(userMessage);"), true);
  assert.equal(source.includes("CavBot could not finish wiring this website for tracking."), true);
});
