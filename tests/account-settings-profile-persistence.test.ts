import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("account settings save persists full profile cache and broadcasts site-wide profile sync", () => {
  const source = read("app/settings/sections/AccountOverviewClient.tsx");

  [
    "cb_profile_fullName_v1",
    "cb_profile_email_v1",
    "cb_profile_bio_v1",
    "cb_profile_country_v1",
    "cb_profile_region_v1",
    "cb_profile_time_zone_v1",
    "cb_profile_company_name_v1",
    "cb_profile_company_category_v1",
    "cb_profile_company_subcategory_v1",
    "cb_settings_avatar_image_v2",
  ].forEach((key) => {
    assert.equal(source.includes(key), true, `${key} should be cached for refresh-safe fast paint`);
  });

  assert.match(source, /function writeProfileCache\(profile: Record<string, unknown>\)/);
  assert.match(source, /writeProfileCache\(\{\s*\.\.\.p,/s);
  assert.match(source, /window\.dispatchEvent\(new CustomEvent\("cb:profile-sync"\)\)/);
  assert.match(source, /fullName: String\(p\.fullName \|\| ""\)/);
  assert.match(source, /avatarImage: String\(p\.avatarImage \|\| ""\) \|\| null/);
});

test("settings account fast profile read returns every persisted account field", () => {
  const source = read("lib/authDb.ts");

  assert.match(source, /type RawPublicProfileUserRow = RawUserRow & \{[\s\S]*timeZone: string \| null;[\s\S]*companyCategory: string \| null;/);
  assert.match(source, /export type AuthPublicProfileUser = AuthUser & \{[\s\S]*timeZone: string \| null;[\s\S]*companyCategory: string \| null;/);
  assert.match(source, /function mapPublicProfileUser[\s\S]*timeZone: row\.timeZone,[\s\S]*companyCategory: row\.companyCategory,/);
  assert.equal((source.match(/"timeZone"/g) || []).length >= 2, true);
  assert.equal((source.match(/"companyCategory"/g) || []).length >= 2, true);
});
