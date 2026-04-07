import assert from "node:assert/strict";
import test from "node:test";

import {
  CAVBOT_FOUNDER_DISPLAY_NAME,
  CAVBOT_FOUNDER_USERNAME,
  isCavbotFounderAccountIdentity,
  isCavbotFounderIdentity,
  normalizeCavbotFounderProfile,
} from "../lib/profileIdentity";

test("founder identity normalizes to CavBot Admin and cavbot", () => {
  const normalized = normalizeCavbotFounderProfile({
    username: "cavbot",
    displayName: "",
    fullName: null,
  });

  assert.equal(CAVBOT_FOUNDER_DISPLAY_NAME, "CavBot Admin");
  assert.equal(CAVBOT_FOUNDER_USERNAME, "cavbot");
  assert.equal(normalized.username, "cavbot");
  assert.equal(normalized.displayName, "CavBot Admin");
  assert.equal(normalized.fullName, "CavBot Admin");
});

test("founder identity is detected from canonical name or username", () => {
  assert.equal(isCavbotFounderIdentity({ username: "cavbot" }), true);
  assert.equal(isCavbotFounderIdentity({ fullName: "CavBot Admin" }), true);
  assert.equal(isCavbotFounderIdentity({ displayName: "CavBot Admin" }), true);
  assert.equal(isCavbotFounderIdentity({ username: "someone-else", fullName: "Someone Else" }), false);
});

test("founder account identity is detected from canonical slug or account name", () => {
  assert.equal(isCavbotFounderAccountIdentity({ slug: "Cavbot" }), true);
  assert.equal(isCavbotFounderAccountIdentity({ name: "CavBot Admin" }), true);
  assert.equal(isCavbotFounderAccountIdentity({ slug: "another-workspace", name: "Another Workspace" }), false);
});
