import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(file: string) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

test("public profile gateway and page use authDb-backed lookups", () => {
  const profileExistsRoute = read("app/api/public/profile-exists/route.ts");
  const profilePage = read("app/u/[username]/page.tsx");
  const profileServer = read("lib/publicProfile/publicProfile.server.ts");
  const teamState = read("lib/publicProfile/teamState.server.ts");

  assert.equal(profileExistsRoute.includes("findUserByUsername"), true, "profile-exists should use authDb username lookup");
  assert.equal(profileExistsRoute.includes("getAuthPool"), true, "profile-exists should use the authDb pool");

  assert.equal(profileServer.includes("findPublicProfileUserByUsername"), true, "public profile view-model should resolve users from authDb");
  assert.equal(profileServer.includes("findMembershipsForUser"), true, "public profile view-model should resolve account membership from authDb");
  assert.equal(profileServer.includes("findAccountById"), true, "public profile view-model should resolve accounts from authDb");

  assert.equal(profilePage.includes("findPublicProfileUserByUsername"), true, "owner profile controls should resolve from authDb");

  assert.equal(teamState.includes("findPublicProfileUserByUsername"), true, "public profile team state should resolve users from authDb");
  assert.equal(teamState.includes("findMembershipsForUser"), true, "public profile team state should resolve memberships from authDb");
});
