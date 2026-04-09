import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("permission parity: workspace invite route uses OWNER/ADMIN gate", () => {
  const source = read("app/api/workspaces/invites/route.ts");
  assert.equal(
    source.includes("requireAccountRole(session, [\"OWNER\", \"ADMIN\"])"),
    true,
    "Username/email invite endpoint must use the same OWNER/ADMIN gate as email invites.",
  );
});

test("username resolve route is privacy-safe and does not expose email fields", () => {
  const routeSource = read("app/api/users/resolve/route.ts");
  const serviceSource = read("lib/workspaceTeam.server.ts");

  assert.equal(routeSource.includes("normalizeUsernameLookupQuery"), true);
  assert.equal(serviceSource.includes("resolveUsersForWorkspaceQuery"), true);
  const resolveStart = serviceSource.indexOf("export async function resolveUsersForWorkspaceQuery");
  const resolveEnd = serviceSource.indexOf("export async function createWorkspaceInvite");
  const resolveBlock = resolveStart >= 0 && resolveEnd > resolveStart
    ? serviceSource.slice(resolveStart, resolveEnd)
    : serviceSource;

  assert.equal(resolveBlock.includes("email"), false, "Resolve payload should never include email.");
});

test("workspace invite and access-request notifications expose server actions", () => {
  const serviceSource = read("lib/workspaceTeam.server.ts");

  assert.equal(serviceSource.includes("WORKSPACE_INVITE_RECEIVED"), true);
  assert.equal(serviceSource.includes("WORKSPACE_ACCESS_REQUEST_RECEIVED"), true);
  assert.equal(serviceSource.includes("href: \"/api/invites/respond\""), true);
  assert.equal(serviceSource.includes("decision: \"ACCEPT\""), true);
  assert.equal(serviceSource.includes("decision: \"DECLINE\""), true);
  assert.equal(serviceSource.includes("href: \"/api/access-requests/respond\""), true);
  assert.equal(serviceSource.includes("decision: \"APPROVE\""), true);
  assert.equal(serviceSource.includes("decision: \"DENY\""), true);
});

test("idempotency guards exist for invite and access-request state transitions", () => {
  const source = read("lib/workspaceTeam.server.ts");

  assert.equal(source.includes("if (status === \"ACCEPTED\")"), true);
  assert.equal(source.includes("if (status === \"DECLINED\")"), true);
  assert.equal(source.includes("if (request.status === \"APPROVED\")"), true);
  assert.equal(source.includes("if (request.status === \"DENIED\")"), true);
  assert.equal(source.includes("membership.upsert"), true);
});

test("Team UI wiring includes username invite, resolve, and request approvals", () => {
  const source = read("app/settings/sections/TeamClient.tsx");
  const membersRoute = read("app/api/members/route.ts");

  assert.equal(source.includes("Invite by username"), true);
  assert.equal(source.includes("/api/users/resolve"), true);
  assert.equal(source.includes("/api/workspaces/invites"), true);
  assert.equal(source.includes("Access requests"), true);
  assert.equal(source.includes("/api/workspaces/access-requests"), true);
  assert.equal(source.includes("canManageAccessRequests"), true);
  assert.equal(membersRoute.includes("canManageAccessRequests"), true);
  assert.equal(membersRoute.includes("currentMemberRole"), true);
  assert.equal(source.includes("Approve"), true);
  assert.equal(source.includes("Deny"), true);
});

test("request access entry resolves workspace target before submit", () => {
  const source = read("app/request-access/page.tsx");

  assert.equal(source.includes("/api/workspaces/access-requests/resolve"), true);
  assert.equal(source.includes("Target workspace:"), true);
  assert.equal(source.includes("targetWorkspaceId"), true);
});

test("Notifications modal action parser supports invite/request action keys", () => {
  const source = read("components/AppShell.tsx");

  assert.equal(source.includes("normalizeNotificationActions(meta)"), true);
  assert.equal(source.includes("isWorkspaceJoinApprovalAction(action)"), true);
  assert.equal(source.includes("key === \"deny\""), true);
  assert.equal(source.includes("Accept as"), true);
  assert.equal(source.includes("Select role for accepted request"), true);
});

test("notification APIs include global workspace notifications in account-scoped reads", () => {
  const listSource = read("app/api/notifications/route.ts");
  const countSource = read("app/api/notifications/unread-count/route.ts");
  const readAllSource = read("app/api/notifications/read-all/route.ts");

  assert.equal(listSource.includes("{ accountId }, { accountId: null }"), true);
  assert.equal(countSource.includes("{ accountId }, { accountId: null }"), true);
  assert.equal(readAllSource.includes("{ accountId }, { accountId: null }"), true);
});

test("email invite regression guard: legacy email invite path remains wired", () => {
  const source = read("app/api/members/invite/route.ts");

  assert.equal(source.includes("sendInviteEmail"), true);
  assert.equal(source.includes("/accept-invite?token="), true);
});
