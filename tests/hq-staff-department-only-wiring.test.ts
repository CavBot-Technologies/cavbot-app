import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("hq staff surfaces stay department-based and do not render role controls", () => {
  const teamActionCenter = read("components/admin/TeamActionCenter.tsx");
  const directoryGrid = read("components/admin/StaffDirectoryGrid.tsx");
  const staffPage = read("app/admin-internal/(protected)/staff/page.tsx");
  const staffDetailPage = read("app/admin-internal/(protected)/staff/[staffId]/page.tsx");
  const staffManagePage = read("app/admin-internal/(protected)/staff/[staffId]/manage/page.tsx");

  assert.equal(teamActionCenter.includes("ROLE_OPTIONS"), false);
  assert.equal(teamActionCenter.includes("systemRole:"), false);
  assert.equal(teamActionCenter.includes("access role"), false);

  assert.equal(directoryGrid.includes('<div className="hq-clientStatLabel">Role</div>'), false);
  assert.equal(directoryGrid.includes('{ label: "Role", value:'), false);

  assert.equal(staffPage.includes("roles, positions"), false);
  assert.equal(staffDetailPage.includes('{ label: "Role", value:'), false);
  assert.equal(staffManagePage.includes('{ label: "Role", value:'), false);
  assert.equal(staffManagePage.includes("systemRoleLabel="), false);
});

test("hq staff no longer injects preview team cards and operations avatars use the saturated orange token", () => {
  const staffPage = read("app/admin-internal/(protected)/staff/page.tsx");
  const staffDetailPage = read("app/admin-internal/(protected)/staff/[staffId]/page.tsx");
  const staffManagePage = read("app/admin-internal/(protected)/staff/[staffId]/manage/page.tsx");
  const previewRecords = read("lib/admin/previewRecords.ts");
  const adminCss = read("app/admin-internal/admin.css");

  assert.equal(staffPage.includes("getPreviewTeamByDepartment"), false);
  assert.equal(staffPage.includes("shouldShowPreviewCards"), false);
  assert.equal(staffPage.includes("previewCards"), false);

  assert.equal(staffDetailPage.includes("getPreviewTeamById"), false);
  assert.equal(staffManagePage.includes("getPreviewTeamById"), false);
  assert.equal(previewRecords.includes("PREVIEW_TEAM_FIXTURES"), false);

  assert.equal(adminCss.includes('.hq-avatar[data-tone="orange"] {\n  background: rgba(255, 164, 71, 0.96);'), true);
  assert.equal(adminCss.includes('.hq-avatar[data-tone="orange"] {\n  background: rgba(255, 164, 71, 0.22);'), false);
});

test("hq staff routes no longer change invite-time or profile-time staff roles", () => {
  const staffRoute = read("app/api/admin/staff/[staffId]/route.ts");
  const inviteRoute = read("app/api/admin/staff/invites/route.ts");

  assert.equal(staffRoute.includes("body.systemRole"), false);
  assert.equal(staffRoute.includes("systemRole: nextRole"), false);
  assert.equal(staffRoute.includes("beforeJson: {\n        department: existingDepartment,\n        systemRole:"), false);

  assert.equal(inviteRoute.includes("requestedSystemRole"), false);
  assert.equal(inviteRoute.includes('systemRole: "MEMBER"'), true);
});
