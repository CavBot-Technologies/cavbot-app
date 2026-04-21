import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const tenantScopedFiles = [
  "app/console/page.tsx",
  "app/routes/page.tsx",
  "app/seo/page.tsx",
  "app/errors/page.tsx",
  "app/a11y/page.tsx",
  "app/insights/page.tsx",
  "app/404-control-room/page.tsx",
  "app/api/errors/export/route.ts",
  "app/api/seo/export/route.ts",
  "app/api/summary/route.ts",
  "app/console/report/route.ts",
];

test("dashboard surfaces use tenant-scoped summary reads", () => {
  for (const relPath of tenantScopedFiles) {
    const source = fs.readFileSync(new URL(`../${relPath}`, import.meta.url), "utf8");
    assert.equal(
      source.includes("getTenantProjectSummary"),
      true,
      `${relPath} should use tenant-scoped summary reads`,
    );
    assert.equal(
      source.includes('from "@/lib/cavbotApi.server"') && source.includes("getProjectSummary"),
      false,
      `${relPath} should not import raw getProjectSummary`,
    );
  }
});

test("tenant summary helper resolves per-project auth", () => {
  const source = fs.readFileSync(new URL("../lib/projectSummary.server.ts", import.meta.url), "utf8");
  assert.equal(source.includes("getAuthPool"), true);
  assert.equal(source.includes("decryptAesGcm"), true);
  assert.equal(source.includes("getEnv"), true);
  assert.equal(source.includes("summaryAuth"), true);
  assert.equal(source.includes("adminToken"), true);
  assert.equal(source.includes("getProjectSummaryForTenant"), true);
  assert.equal(source.includes("projectAuth.server"), false);
  assert.equal(source.includes("lib/prisma"), false);
});

test("workspace and module gating use effective session account resolution", () => {
  const workspace = fs.readFileSync(new URL("../lib/workspaceStore.server.ts", import.meta.url), "utf8");
  const gate = fs.readFileSync(new URL("../lib/moduleGate.server.ts", import.meta.url), "utf8");
  const apiConsole = fs.readFileSync(new URL("../app/api/console/route.ts", import.meta.url), "utf8");

  assert.equal(workspace.includes("resolveEffectiveAccountIdFromHeaders"), true);
  assert.equal(gate.includes("resolveEffectiveAccountIdForSession"), true);
  assert.equal(apiConsole.includes("resolveEffectiveAccountIdForSession"), true);
});

test("project creation paths persist encrypted server keys", () => {
  const files = [
    "lib/workspaceProjects.server.ts",
    "lib/currentProject.server.ts",
    "app/api/auth/register/route.ts",
    "app/api/auth/oauth/google/callback/route.ts",
    "app/api/auth/oauth/github/callback/route.ts",
  ];

  for (const relPath of files) {
    const source = fs.readFileSync(new URL(`../${relPath}`, import.meta.url), "utf8");
    assert.equal(
      source.includes("serverKeyEnc"),
      true,
      `${relPath} should persist encrypted server key ciphertext`,
    );
    assert.equal(
      source.includes("serverKeyEncIv"),
      true,
      `${relPath} should persist encrypted server key IV`,
    );
    assert.equal(
      source.includes("createProjectKeyMaterial"),
      true,
      `${relPath} should use shared project key material generation`,
    );
  }
});
