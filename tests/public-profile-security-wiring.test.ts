import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("public profile and public artifact viewers use fixed internal URLs for cookie session reads", () => {
  const profilePage = read("app/u/[username]/page.tsx");
  const artifactPage = read("app/p/[username]/artifact/[artifactId]/page.tsx");

  assert.equal(
    profilePage.includes("https://app.cavbot.internal/_public_profile"),
    true,
    "Public profile viewer session reader must not build URL from forwarded host headers.",
  );
  assert.equal(
    artifactPage.includes("https://app.cavbot.internal/_public_artifact_viewer"),
    true,
    "Public artifact viewer session reader must not build URL from forwarded host headers.",
  );
  assert.equal(
    artifactPage.includes("x-forwarded-host"),
    false,
    "Public artifact viewer session reader should not trust x-forwarded-host.",
  );
});

test("critical public-profile state-changing routes enforce request integrity header", () => {
  const collab = read("app/api/public/profile/collab/route.ts");
  const invites = read("app/api/workspaces/invites/route.ts");
  const accessRequests = read("app/api/workspaces/access-requests/route.ts");
  const inviteAccept = read("app/api/workspaces/invites/[inviteId]/accept/route.ts");
  const readme = read("app/api/profile/readme/route.ts");
  const artifactPublish = read("app/api/cavcloud/artifacts/publish/route.ts");
  const artifactDelete = read("app/api/cavcloud/artifacts/[id]/route.ts");

  assert.equal(collab.includes("hasRequestIntegrityHeader"), true);
  assert.equal(invites.includes("hasRequestIntegrityHeader"), true);
  assert.equal(accessRequests.includes("hasRequestIntegrityHeader"), true);
  assert.equal(inviteAccept.includes("hasRequestIntegrityHeader"), true);
  assert.equal(readme.includes("hasRequestIntegrityHeader"), true);
  assert.equal(artifactPublish.includes("hasRequestIntegrityHeader"), true);
  assert.equal(artifactDelete.includes("hasRequestIntegrityHeader"), true);
});

test("critical public-profile flows keep explicit rate limits and audit writes", () => {
  const collab = read("app/api/public/profile/collab/route.ts");
  const revoke = read("app/api/public/profile/revoke-member/route.ts");
  const invites = read("app/api/workspaces/invites/route.ts");
  const accessRequests = read("app/api/workspaces/access-requests/route.ts");
  const artifactPublish = read("app/api/cavcloud/artifacts/publish/route.ts");
  const artifactDelete = read("app/api/cavcloud/artifacts/[id]/route.ts");

  assert.equal(collab.includes("consumeInMemoryRateLimit"), true);
  assert.equal(revoke.includes("consumeInMemoryRateLimit"), true);
  assert.equal(invites.includes("consumeInMemoryRateLimit"), true);
  assert.equal(accessRequests.includes("consumeInMemoryRateLimit"), true);
  assert.equal(artifactPublish.includes("consumeInMemoryRateLimit"), true);
  assert.equal(artifactDelete.includes("consumeInMemoryRateLimit"), true);

  assert.equal(collab.includes("auditLogWrite"), true);
  assert.equal(revoke.includes("auditLogWrite"), true);
  assert.equal(invites.includes("auditLogWrite"), true);
  assert.equal(accessRequests.includes("auditLogWrite"), true);
  assert.equal(artifactPublish.includes("auditLogWrite"), true);
  assert.equal(artifactDelete.includes("auditLogWrite"), true);
});

test("settings account PATCH keeps server-side URL normalization for profile identity links", () => {
  const routeSource = read("app/api/settings/account/route.ts");

  assert.equal(routeSource.includes("normalizeOptionalHttpUrl"), true);
  assert.equal(routeSource.includes("normalizeCustomLinkUrl"), true);
  assert.equal(routeSource.includes("Profile links must use valid http:// or https:// URLs."), true);
});

test("settings account route uses authenticated self-session instead of owner-only auth for profile reads and saves", () => {
  const routeSource = read("app/api/settings/account/route.ts");

  assert.equal(routeSource.includes("requireSettingsOwnerSession"), false);
  assert.equal(routeSource.includes("requireAuthenticatedProfileSession"), true);
  assert.equal(routeSource.includes("requireUser(session);"), true);
  assert.equal(routeSource.includes("authRequired: true"), true);
});

test("cavsafe collaboration keeps paid-plan and owner-only server gates", () => {
  const collab = read("app/api/public/profile/collab/route.ts");

  assert.equal(collab.includes("if (workspace.planId === \"free\")"), true);
  assert.equal(collab.includes("if (operatorRole !== \"OWNER\")"), true);
  assert.equal(collab.includes("PLAN_UPGRADE_REQUIRED"), true);
});

test("public profile artifact preview uses Unpublish action in owner context", () => {
  const carousel = read("app/u/[username]/PublicArtifactsCarousel.tsx");

  assert.equal(carousel.includes("openInCavCodeLabel"), true);
  assert.equal(carousel.includes("\"Unpublish\""), true);
});

test("dev-only public profile demo members remain removable via MUST DELETE marker", () => {
  const demoMembers = read("lib/dev/publicProfileDemoMembers.server.ts");

  assert.equal(demoMembers.includes("MUST DELETE"), true);
  assert.equal(demoMembers.includes("seedPublicProfileDemoMembers"), true);
});
