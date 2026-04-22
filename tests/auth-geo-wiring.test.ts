import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function read(relPath: string) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

test("auth and security routes share the central request geo reader", () => {
  const routePaths = [
    "app/api/auth/login/route.ts",
    "app/api/auth/register/route.ts",
    "app/api/auth/challenge/verify/route.ts",
    "app/api/auth/challenge/resend/route.ts",
    "app/api/settings/security/password/route.ts",
    "app/api/settings/security/username/route.ts",
    "app/api/settings/security/delete-account/route.ts",
    "app/api/settings/security/2fa/route.ts",
  ];

  for (const relPath of routePaths) {
    const source = read(relPath);
    assert.equal(
      source.includes('from "@/lib/requestGeo"'),
      true,
      `${relPath} should import the shared request geo helper`,
    );
    assert.equal(
      source.includes("readCoarseRequestGeo("),
      true,
      `${relPath} should read coarse request geo through the shared helper`,
    );
  }
});

test("oauth callbacks audit geo-backed sign-in and workspace creation", () => {
  const google = read("app/api/auth/oauth/google/callback/route.ts");
  const github = read("app/api/auth/oauth/github/callback/route.ts");

  for (const [label, source] of [
    ["google", google],
    ["github", github],
  ] as const) {
    assert.equal(source.includes("auditLogWrite"), true, `${label} oauth callback should write audit logs`);
    assert.equal(source.includes("readCoarseRequestGeo(req)"), true, `${label} oauth callback should read request geo`);
    assert.equal(source.includes('action: "AUTH_SIGNED_IN"'), true, `${label} oauth callback should log sign-in`);
    assert.equal(source.includes('action: "ACCOUNT_CREATED"'), true, `${label} oauth callback should log workspace creation`);
    assert.equal(source.includes("geoCountry: geo.country"), true, `${label} oauth callback should persist geo country into audit meta`);
    assert.equal(source.includes("geoRegion: geo.region"), true, `${label} oauth callback should persist geo region into audit meta`);
  }
});

test("growth geography falls back to auth audit geo before unknown", () => {
  const growth = read("app/admin-internal/(protected)/growth/page.tsx");

  assert.equal(growth.includes('from "@/lib/requestGeo"'), true);
  assert.equal(growth.includes("readGeoFromMeta(entry.metaJson)"), true);
  assert.equal(growth.includes("networkGeoByUserId"), true);
  assert.equal(growth.includes('|| "Unknown"'), true);
});
