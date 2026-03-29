import assert from "node:assert/strict";
import test from "node:test";

import {
  extractUsernameCandidate,
  normalizeUsernameExact,
  normalizeUsernameLookupQuery,
} from "@/lib/workspaceIdentity";

test("normalizeUsernameLookupQuery accepts @username and username", () => {
  assert.equal(normalizeUsernameLookupQuery("@CavOwner_1"), "cavowner_1");
  assert.equal(normalizeUsernameLookupQuery("CavOwner_1"), "cavowner_1");
});

test("normalizeUsernameLookupQuery parses CavBot profile URLs", () => {
  assert.equal(
    normalizeUsernameLookupQuery("https://app.cavbot.io/u/CavOwner_1"),
    "cavowner_1",
  );
  assert.equal(
    normalizeUsernameLookupQuery("https://app.cavbot.io/CavOwner_1"),
    "cavowner_1",
  );
});

test("normalizeUsernameLookupQuery fail-closes invalid patterns", () => {
  assert.equal(normalizeUsernameLookupQuery("https://app.cavbot.io/u/"), "");
  assert.equal(normalizeUsernameLookupQuery("Cav Owner"), "");
  assert.equal(normalizeUsernameLookupQuery("foo@bar.com"), "");
});

test("normalizeUsernameExact enforces canonical username shape", () => {
  assert.equal(normalizeUsernameExact("ab"), "");
  assert.equal(normalizeUsernameExact("abc"), "abc");
  assert.equal(normalizeUsernameExact("https://app.cavbot.io/u/abc_123"), "abc_123");
});

test("extractUsernameCandidate strips leading symbols and lowercases", () => {
  assert.equal(extractUsernameCandidate("@@OwnerName"), "ownername");
});
