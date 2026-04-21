import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("settings api-key routes avoid Prisma runtime imports on deployed request paths", () => {
  const routePaths = [
    "app/api/settings/api-keys/route.ts",
    "app/api/settings/api-keys/rotate/route.ts",
    "app/api/settings/api-keys/revoke/route.ts",
    "app/api/settings/api-keys/usage/route.ts",
    "app/api/settings/sites/[siteId]/origins/route.ts",
    "app/api/settings/arcade/config/route.ts",
    "app/api/settings/integrations/cavbot/install-state/route.ts",
  ];

  for (const relPath of routePaths) {
    const source = read(relPath);
    assert.equal(
      source.includes('from "@/lib/prisma"'),
      false,
      `${relPath} should not import the Prisma runtime client`,
    );
  }
});

test("settings history route avoids Prisma runtime imports on deployed request paths", () => {
  const source = read("app/api/settings/history/route.ts");

  assert.equal(source.includes('from "@/lib/prisma"'), false);
  assert.equal(source.includes("historyRuntime.server"), true);
});

test("settings api-key runtime helpers use the auth pool instead of Prisma", () => {
  const workspaceSource = read("lib/settings/apiKeyWorkspace.server.ts");
  const runtimeSource = read("lib/settings/apiKeysRuntime.server.ts");
  const historySource = read("lib/settings/historyRuntime.server.ts");
  const arcadeRuntimeSource = read("lib/settings/arcadeRuntime.server.ts");
  const installStateRuntimeSource = read("lib/settings/installStateRuntime.server.ts");
  const ownerAuthSource = read("lib/settings/ownerAuth.server.ts");
  const apiKeyRouteSource = read("app/api/settings/api-keys/route.ts");
  const rotateRouteSource = read("app/api/settings/api-keys/rotate/route.ts");
  const usageRouteSource = read("app/api/settings/api-keys/usage/route.ts");
  const originsRouteSource = read("app/api/settings/sites/[siteId]/origins/route.ts");
  const arcadeRouteSource = read("app/api/settings/arcade/config/route.ts");
  const installStateRouteSource = read("app/api/settings/integrations/cavbot/install-state/route.ts");

  assert.equal(workspaceSource.includes('from "@/lib/prisma"'), false);
  assert.equal(workspaceSource.includes("getAuthPool"), true);
  assert.equal(workspaceSource.includes("readApiKeyWorkspaceCookieHints"), true);
  assert.equal(workspaceSource.includes("preferredProjectId"), true);
  assert.equal(workspaceSource.includes("activeSiteIdHint"), true);
  assert.equal(workspaceSource.includes("activeSiteOriginHint"), true);

  assert.equal(runtimeSource.includes('from "@/lib/prisma"'), false);
  assert.equal(runtimeSource.includes("getAuthPool"), true);
  assert.equal(runtimeSource.includes("withAuthTransaction"), true);
  assert.equal(runtimeSource.includes('"updatedAt"'), true);
  assert.equal(runtimeSource.includes("NOW(), NOW()"), true);

  assert.equal(historySource.includes('from "@/lib/prisma"'), false);
  assert.equal(historySource.includes("getAuthPool"), true);

  assert.equal(arcadeRuntimeSource.includes('from "@/lib/prisma"'), false);
  assert.equal(arcadeRuntimeSource.includes("getAuthPool"), true);
  assert.equal(arcadeRuntimeSource.includes("withAuthTransaction"), true);
  assert.equal(arcadeRuntimeSource.includes("resolveCavCloudEffectivePlan"), true);

  assert.equal(installStateRuntimeSource.includes('from "@/lib/prisma"'), false);
  assert.equal(installStateRuntimeSource.includes("getAuthPool"), true);
  assert.equal(installStateRuntimeSource.includes('"EmbedInstall"'), true);

  assert.equal(ownerAuthSource.includes("requireSettingsOwnerResilientSession"), true);
  assert.equal(ownerAuthSource.includes("requireLowRiskWriteSession"), true);
  assert.equal(ownerAuthSource.includes('error.code !== "AUTH_BACKEND_UNAVAILABLE"'), true);

  for (const source of [apiKeyRouteSource, rotateRouteSource, usageRouteSource, originsRouteSource, arcadeRouteSource, installStateRouteSource]) {
    assert.equal(source.includes("requireSettingsOwnerResilientSession"), true);
  }
  assert.equal(apiKeyRouteSource.includes("readApiKeyWorkspaceCookieHints"), true);
  assert.equal(apiKeyRouteSource.includes("findSiteForAccount"), true);
  assert.equal(rotateRouteSource.includes("readApiKeyWorkspaceCookieHints"), true);
  assert.equal(usageRouteSource.includes("readApiKeyWorkspaceCookieHints"), true);
  assert.equal(arcadeRouteSource.includes("readSettingsAccountTier"), true);
  assert.equal(arcadeRouteSource.includes("readSiteArcadeConfig"), true);
  assert.equal(arcadeRouteSource.includes("saveSiteArcadeConfig"), true);
  assert.equal(arcadeRouteSource.includes("findSiteForAccount"), true);
  assert.equal(installStateRouteSource.includes("listSiteInstallState"), true);
  assert.equal(installStateRouteSource.includes("findSiteForAccount"), true);
});
