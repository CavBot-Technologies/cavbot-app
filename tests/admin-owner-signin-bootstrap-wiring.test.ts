import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("admin staff bootstrap honors configured owner staff code", () => {
  const source = read("lib/admin/staff.ts");

  assert.match(source, /export function getConfiguredOwnerStaffCode\(\)/);
  assert.match(source, /CAVBOT_ADMIN_STAFF_CODE/);
  assert.match(source, /export function isRetiredStaffCode/);
  assert.match(source, /const RETIRED_STAFF_CODES = \["CAV-000001"\] as const;/);
  assert.match(source, /staffCode:\s*ownerStaffCode/);
  assert.match(source, /await ensureStaffSequenceFloor\(RETIRED_STAFF_CODE_FLOOR\);/);
});

test("auth login can bootstrap owner staff lookup from the configured owner staff code", () => {
  const source = read("app/api/auth/login/route.ts");

  assert.match(source, /ensureAdminOwnerBootstrap/);
  assert.match(source, /getOwnerStaffCodeCandidates/);
  assert.match(source, /const ownerStaffCodeCandidates = new Set\(getOwnerStaffCodeCandidates\(\)\);/);
  assert.match(source, /if \(ownerStaffCodeCandidates\.has\(staffCode\)\)/);
});

test("owner bootstrap script repairs the local admin staff profile from env.local", () => {
  const source = read("scripts/bootstrap-owner.mjs");

  assert.match(source, /loadEnv\(\{ path: "\.env" \}\);/);
  assert.match(source, /loadEnv\(\{ path: "\.env\.local", override: true \}\);/);
  assert.match(source, /const ownerStaffCode = normalizeStaffCode\(process\.env\.CAVBOT_ADMIN_STAFF_CODE \|\| ""\);/);
  assert.match(source, /CAVBOT_ADMIN_STAFF_CODE must be set to a non-retired staff code/);
  assert.match(source, /await prisma\.staffProfile\.upsert\(/);
});
