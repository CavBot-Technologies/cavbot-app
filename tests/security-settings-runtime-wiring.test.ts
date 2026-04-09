import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("settings security routes avoid Prisma runtime imports on deployed request paths", () => {
  const routePaths = [
    "app/api/settings/security/2fa/route.ts",
    "app/api/settings/security/2fa/app/setup/route.ts",
    "app/api/settings/security/2fa/app/confirm/route.ts",
    "app/api/settings/security/2fa/app/disable/route.ts",
    "app/api/settings/security/sessions/route.ts",
    "app/api/settings/security/password/route.ts",
    "app/api/settings/security/username/route.ts",
    "app/api/settings/security/delete-account/route.ts",
  ];

  for (const relPath of routePaths) {
    const source = read(relPath);
    assert.equal(
      source.includes('from "@/lib/prisma"'),
      false,
      `${relPath} should not import the Prisma runtime client`,
    );
    assert.equal(
      source.includes('from "@/lib/settings/securityRuntime.server"') || source.includes('from "@/lib/authDb"'),
      true,
      `${relPath} should use the runtime-safe security storage layer`,
    );
  }
});

test("audit log writes are routed through the auth pool instead of Prisma", () => {
  const source = read("lib/audit.ts");

  assert.equal(source.includes('from "@/lib/prisma"'), false);
  assert.equal(source.includes("getAuthPool"), true);
  assert.equal(source.includes('INSERT INTO "AuditLog"'), true);
});

test("security fingerprint icon asset exists at the path the settings CSS requests", () => {
  const css = read("app/settings/sections/security.css");
  const assetPath = "public/icons/app/security-protection-fingerprint-shield-svgrepo-com.svg";

  assert.equal(
    css.includes("/icons/app/security-protection-fingerprint-shield-svgrepo-com.svg"),
    true,
    "security.css should point at the fingerprint shield asset path",
  );
  assert.equal(
    fs.existsSync(path.join(repoRoot, assetPath)),
    true,
    "the fingerprint shield asset should exist at the requested public path",
  );
});
