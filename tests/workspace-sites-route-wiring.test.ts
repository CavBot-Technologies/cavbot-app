import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("command center workspace site route keeps secure site wiring parity", () => {
  const source = read("app/api/workspaces/[projectId]/sites/route.ts");
  const helper = read("lib/workspaceSites.server.ts");

  assert.equal(source.includes("requireAccountRole(sess, [\"OWNER\", \"ADMIN\"])"), true);
  assert.equal(source.includes("assertWorkerSiteRegistrationConfig()"), true);
  assert.equal(source.includes("registerWorkerSite(project.id, result.site.origin, result.site.label)"), true);
  assert.equal(source.includes("createDefaultAllowedOriginsForSite"), true);
  assert.equal(source.includes("getCavbotAppOrigins()"), true);
  assert.equal(helper.includes("ON CONFLICT (\"siteId\", \"origin\") DO NOTHING"), true);
  assert.equal(source.includes("createProjectNoticeBestEffort"), true);
  assert.equal(source.includes("rollbackCreatedWorkspaceSite"), true);
  assert.equal(source.includes("SITE_WIRING_CONFIG_INVALID"), true);
  assert.equal(source.includes("DB_PERMISSION_DENIED"), true);
});

test("command center add-site UI rethrows friendly errors so modal feedback stays visible", () => {
  const source = read("app/page.tsx");

  assert.equal(source.includes("function formatAddSiteErrorMessage"), true);
  assert.equal(source.includes("throw new Error(userMessage);"), true);
  assert.equal(source.includes("CavBot could not finish wiring this website for tracking."), true);
  assert.equal(source.includes("WORKSPACE_BOOTSTRAP_FAILED"), true);
  assert.equal(source.includes("DB_PERMISSION_DENIED"), true);
  assert.equal(source.includes("SITE_WIRING_CONFIG_INVALID"), true);
  assert.equal(source.includes("Reference:"), true);
});

test("workspace APIs auto-bootstrap the backing project so users never have to create one manually", () => {
  const listRoute = read("app/api/workspaces/route.ts");
  const stateRoute = read("app/api/workspace/route.ts");
  const helper = read("lib/workspaceProjects.server.ts");

  assert.equal(helper.includes("export async function ensureActiveWorkspaceProject"), true);
  assert.equal(helper.includes("export async function resolveAccountWorkspaceProject"), true);
  assert.equal(helper.includes("withAuthTransaction"), true);
  assert.equal(listRoute.includes("resolveAccountWorkspaceProject"), true);
  assert.equal(stateRoute.includes("resolveWorkspaceProjectForRead"), true);
});

test("workspace bootstrap no longer degrades to empty success payloads on critical failures", () => {
  const listRoute = read("app/api/workspaces/route.ts");
  const stateRoute = read("app/api/workspace/route.ts");
  const helper = read("lib/workspaceProjects.server.ts");

  assert.equal(listRoute.includes("degradedWorkspacesResponse"), false);
  assert.equal(listRoute.includes("degraded: true"), false);
  assert.equal(stateRoute.includes("degraded: true"), false);
  assert.equal(helper.includes("DB_PERMISSION_DENIED"), true);
  assert.equal(helper.includes("WORKSPACE_BOOTSTRAP_FAILED"), true);
  assert.equal(stateRoute.includes("workspaceBootstrapFailureResponse"), true);
});

test("workspace bootstrap list route keeps the critical path flat", () => {
  const listRoute = read("app/api/workspaces/route.ts");

  assert.equal(listRoute.includes("listAccountWorkspaceProjects"), true);
  assert.equal(listRoute.includes('_count: { select: { sites: true } }'), false);
  assert.equal(listRoute.includes("topSite: { select:"), false);
  assert.equal(listRoute.includes("WorkspaceBootstrapStageError"), true);
});

test("workspace selection routes never fall back to project 1 and stay ownership-safe", () => {
  const selectionRoute = read("app/api/workspaces/selection/route.ts");
  const selectProjectRoute = read("app/api/workspaces/select-project/route.ts");

  assert.doesNotMatch(selectionRoute, /\?\?\s*1/);
  assert.equal(selectionRoute.includes("PROJECT_NOT_FOUND"), true);
  assert.equal(selectionRoute.includes("resolveAccountWorkspaceProject"), true);
  assert.equal(selectProjectRoute.includes("findAccountWorkspaceProject"), true);
});

test("command center add-site flow retries bootstrap but surfaces real bootstrap failures", () => {
  const source = read("app/page.tsx");
  const listRoute = read("app/api/workspaces/route.ts");

  assert.equal(source.includes('const { next } = await loadProjects();'), true);
  assert.equal(source.includes('await refreshWorkspace(next, "refresh");'), true);
  assert.equal(source.includes("Workspace bootstrap returned no active project."), true);
  assert.equal(listRoute.includes("listAccountWorkspaceProjects"), true);
  assert.equal(listRoute.includes("prisma.project.findMany"), false);
  assert.equal(
    source.includes("CavBot is preparing your command center. Please try adding the website again."),
    false,
  );
});

test("workspace project resolution keeps auto-bootstrap inside the shared resolver", () => {
  const listRoute = read("app/api/workspaces/route.ts");
  const stateRoute = read("app/api/workspace/route.ts");
  const helper = read("lib/workspaceProjects.server.ts");

  assert.equal(helper.includes("export async function ensureActiveWorkspaceProject"), true);
  assert.equal(helper.includes("const ensured = await ensureActiveWorkspaceProject(args.accountId);"), true);
  assert.equal(listRoute.includes("ensureActive: true"), true);
  assert.equal(stateRoute.includes("ensureActive: true"), true);
});

test("command center add-site flow retries project bootstrap instead of asking users to create a workspace", () => {
  const source = read("app/page.tsx");

  assert.equal(source.includes('const { next } = await loadProjects();'), true);
  assert.equal(source.includes('await refreshWorkspace(next, "refresh");'), true);
  assert.equal(
    source.includes("CavBot is preparing your command center. Please try adding the website again."),
    false,
  );
  assert.equal(source.includes("Create a workspace first."), false);
});
