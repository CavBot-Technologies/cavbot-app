import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavsafe read paths enforce ACL with anti-enumeration semantics", () => {
  const fileRoute = read("app/api/cavsafe/files/[id]/route.ts");
  const byPathRoute = read("app/api/cavsafe/files/by-path/route.ts");

  assert.equal(fileRoute.includes("requireCavSafeAccess"), true);
  assert.equal(fileRoute.includes("minRole: \"VIEWER\""), true);
  assert.equal(fileRoute.includes("onDenied: 404"), true);

  assert.equal(byPathRoute.includes("requireCavSafeAccess"), true);
  assert.equal(byPathRoute.includes("minRole: \"VIEWER\""), true);
});

test("invite creation and acceptance are server-gated", () => {
  const inviteRoute = read("app/api/cavsafe/share/invite/route.ts");
  const acceptRoute = read("app/api/cavsafe/share/accept/route.ts");
  const shareService = read("lib/cavsafe/privateShare.server.ts");

  assert.equal(inviteRoute.includes("hasRequestIntegrityHeader"), true);
  assert.equal(inviteRoute.includes("consumeInMemoryRateLimit"), true);
  assert.equal(inviteRoute.includes("429"), true);

  assert.equal(acceptRoute.includes("requireUserSession"), true);
  assert.equal(acceptRoute.includes("hasRequestIntegrityHeader"), true);

  assert.equal(shareService.includes("minRole: \"OWNER\""), true);
  assert.equal(shareService.includes("throw new ApiAuthError(\"FORBIDDEN\", 403)"), true);
});

test("revocation and role changes keep last-owner guardrails", () => {
  const shareService = read("lib/cavsafe/privateShare.server.ts");
  const revokeRoute = read("app/api/cavsafe/share/revoke/route.ts");
  const roleRoute = read("app/api/cavsafe/share/role/route.ts");

  assert.equal(shareService.includes("CANNOT_REMOVE_LAST_OWNER"), true);
  assert.equal(shareService.includes("status: \"REVOKED\""), true);
  assert.equal(shareService.includes("CAVSAFE_ACCESS_REVOKED"), true);
  assert.equal(shareService.includes("CAVSAFE_ROLE_CHANGED"), true);

  assert.equal(revokeRoute.includes("consumeInMemoryRateLimit"), true);
  assert.equal(roleRoute.includes("consumeInMemoryRateLimit"), true);
});

test("legacy public-link endpoints remain blocked for cavsafe", () => {
  const linkRoute = read("app/api/cavsafe/shares/link/route.ts");
  const shareRoute = read("app/api/cavsafe/share/route.ts");

  assert.equal(linkRoute.includes("CAVSAFE_PRIVATE_SHARE_ONLY"), true);
  assert.equal(shareRoute.includes("CAVSAFE_PRIVATE_SHARE_ONLY"), true);
  assert.equal(linkRoute.includes("Invite-only. No public links. Stays inside CavSafe."), true);
});

test("cavsafe private-share UI copy stays invite-only", () => {
  const client = read("app/cavsafe/CavSafeClient.tsx");

  assert.equal(client.includes("Private share"), true);
  assert.equal(client.includes("Invite‑only. No public links. Stays inside CavSafe."), true);
  assert.equal(client.includes("People with access"), true);
  assert.equal(client.includes("Pending"), true);
  assert.equal(client.includes("Send invite"), true);
  assert.equal(client.includes("CavSafe invite"), true);
  assert.equal(client.includes("Accept once to add this item to your CavSafe."), true);
  assert.equal(client.includes("Nothing shared with you yet."), true);
});
