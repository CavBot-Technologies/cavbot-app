import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("notifications modal accept flow includes owner role selector and forwards selected role", () => {
  const source = read("components/AppShell.tsx");

  assert.equal(source.includes("Accept as"), true);
  assert.equal(source.includes("cb-notif-role-"), true);
  assert.equal(source.includes("<option value=\"member\">Member</option>"), true);
  assert.equal(source.includes("<option value=\"admin\">Admin</option>"), true);
  assert.equal(source.includes("payload.role = role"), true);
  assert.equal(source.includes("isWorkspaceJoinApprovalAction"), true);
});

test("invite and access respond APIs enforce owner role and validate grant role input", () => {
  const inviteRespond = read("app/api/invites/respond/route.ts");
  const accessRespond = read("app/api/access-requests/respond/route.ts");

  for (const source of [inviteRespond, accessRespond]) {
    assert.equal(source.includes("requireAccountRole(session, [\"OWNER\"])"), true);
    assert.equal(source.includes("Role must be member or admin."), true);
    assert.equal(source.includes("grantedRole"), true);
    assert.equal(source.includes("workspaceName"), true);
    assert.equal(source.includes("subjectUserId"), true);
  }
});

test("workspace team service applies selected role and owner-only approvals", () => {
  const source = read("lib/workspaceTeam.server.ts");

  assert.equal(source.includes("resolveWorkspaceOwnerOperator"), true);
  assert.equal(source.includes("role: grantedRole"), true);
  assert.equal(source.includes("data: { role: grantedRole }"), true);
  assert.equal(source.includes("grantedRole: InviteRole | null"), true);
  assert.equal(source.includes("notifyAccessRequestApproved"), true);
});
