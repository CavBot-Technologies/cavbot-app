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

test("workspace APIs auto-bootstrap the backing project so users never have to create one manually", () => {
  const listRoute = read("app/api/workspaces/route.ts");
  const stateRoute = read("app/api/workspace/route.ts");
  const helper = read("lib/workspaceProjects.server.ts");

  assert.equal(helper.includes("export async function ensureActiveWorkspaceProject"), true);
  assert.equal(listRoute.includes("await ensureActiveWorkspaceProject(sess.accountId!);"), true);
  assert.equal(stateRoute.includes("const ensured = await ensureActiveWorkspaceProject(sess.accountId!);"), true);
});

test("command center add-site flow retries project bootstrap instead of asking users to create a workspace", () => {
  const source = read("app/page.tsx");

  assert.equal(source.includes('const { next } = await loadProjects();'), true);
  assert.equal(source.includes('await refreshWorkspace(next, "refresh");'), true);
  assert.equal(
    source.includes("CavBot is preparing your command center. Please try adding the website again."),
    true,
  );
  assert.equal(source.includes("Create a workspace first."), false);
});
