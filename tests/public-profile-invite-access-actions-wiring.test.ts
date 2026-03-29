import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("public profile action slots switch owner/viewer labels and keep emoji control", () => {
  const source = read("app/u/[username]/PublicProfileTeamActionsClient.tsx");

  assert.equal(source.includes("isOwner ? \"Edit profile\" : \"Invite\""), true);
  assert.equal(source.includes("isOwner ? \"Share profile\" : \"Request access\""), true);
});

test("invite and request access actions are one-click and legacy modals are removed", () => {
  const source = read("app/u/[username]/PublicProfileTeamActionsClient.tsx");

  assert.equal(source.includes("/api/invites/send"), true);
  assert.equal(source.includes("/api/access-requests/send"), true);
  assert.equal(source.includes("Invite from public profile"), false);
  assert.equal(source.includes("Request workspace access"), false);
});

test("owner share flow is wired to canonical URL and native share fallback", () => {
  const source = read("app/u/[username]/PublicProfileTeamActionsClient.tsx");
  const pageSource = read("app/u/[username]/page.tsx");

  assert.equal(source.includes("navigator.share"), true);
  assert.equal(source.includes("Link copied"), true);
  assert.equal(source.includes("canonicalShareUrl"), true);
  assert.equal(pageSource.includes("canonicalProfileUrl"), true);
});

test("owner edit action supports inline toggle callback with navigation fallback", () => {
  const source = read("app/u/[username]/PublicProfileTeamActionsClient.tsx");

  assert.equal(source.includes("onOwnerEditProfileToggle"), true);
  assert.equal(source.includes("if (onOwnerEditProfileToggle)"), true);
  assert.equal(source.includes("window.location.assign(editProfileHref)"), true);
});

test("public profile left card uses inline owner edit client component and required social input ordering", () => {
  const pageSource = read("app/u/[username]/page.tsx");
  const cardSource = read("app/u/[username]/PublicProfileIdentityCardClient.tsx");

  assert.equal(pageSource.includes("PublicProfileIdentityCardClient"), true);
  assert.equal(cardSource.includes("placeholder=\"Email\""), true);
  assert.equal(cardSource.includes("MAX_CUSTOM_LINKS = 6"), true);

  const instagramPos = cardSource.indexOf("aria-label=\"Instagram\"");
  const linkedInPos = cardSource.indexOf("aria-label=\"LinkedIn\"");
  const githubPos = cardSource.indexOf("aria-label=\"GitHub\"");
  assert.equal(githubPos > -1, true);
  assert.equal(instagramPos > githubPos, true);
  assert.equal(linkedInPos > instagramPos, true);
});

test("invite service dedupes pending invites and only notifies on newly created pending invites", () => {
  const source = read("lib/workspaceTeam.server.ts");

  assert.equal(source.includes("kind: \"REUSED\""), true);
  assert.equal(source.includes("if (transactionResult.kind === \"CREATED\")"), true);
});

test("invite acceptance notifies inviter while invite decline emits no invite-declined notification", () => {
  const source = read("lib/workspaceTeam.server.ts");

  assert.equal(source.includes("notifyWorkspaceInviteAccepted"), true);
  assert.equal(source.includes("WORKSPACE_INVITE_ACCEPTED"), true);
  assert.equal(source.includes("WORKSPACE_INVITE_DECLINED"), false);
});

test("access-request approve notifies requester and deny emits no denial notification", () => {
  const source = read("lib/workspaceTeam.server.ts");

  assert.equal(source.includes("notifyAccessRequestApproved"), true);
  assert.equal(source.includes("ACCESS_REQUEST_APPROVED"), true);
  assert.equal(source.includes("ACCESS_REQUEST_DENIED"), false);
});

test("new send/respond APIs enforce auth and return CavGuard payload on auth failures", () => {
  const inviteSend = read("app/api/invites/send/route.ts");
  const inviteRespond = read("app/api/invites/respond/route.ts");
  const accessSend = read("app/api/access-requests/send/route.ts");
  const accessRespond = read("app/api/access-requests/respond/route.ts");

  for (const source of [inviteSend, inviteRespond, accessSend, accessRespond]) {
    assert.equal(source.includes("requireSession"), true);
    assert.equal(source.includes("buildGuardDecisionPayload"), true);
    assert.equal(source.includes("hasRequestIntegrityHeader"), true);
    assert.equal(source.includes("error.status"), true);
  }
});

test("non-owner access-request approvals are blocked at service and mapped to 403 in respond API", () => {
  const serviceSource = read("lib/workspaceTeam.server.ts");
  const respondSource = read("app/api/access-requests/respond/route.ts");

  assert.equal(serviceSource.includes("error: \"FORBIDDEN\""), true);
  assert.equal(respondSource.includes("result.error === \"FORBIDDEN\""), true);
  assert.equal(respondSource.includes("? 403"), true);
});
