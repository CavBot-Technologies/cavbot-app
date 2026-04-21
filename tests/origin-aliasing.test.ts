import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeWebsiteContextHost,
  canonicalizeWebsiteContextOrigin,
  canonicalizeWebsiteContextUrl,
  expandRelatedExactOrigins,
  originAllowed,
  originsShareWebsiteContext,
} from "../originMatch";

test("apex and www exact origins share a single website context", () => {
  assert.deepEqual(expandRelatedExactOrigins("https://cavbot.io"), [
    "https://cavbot.io",
    "https://www.cavbot.io",
  ]);
  assert.deepEqual(expandRelatedExactOrigins("https://www.cavbot.io"), [
    "https://www.cavbot.io",
    "https://cavbot.io",
  ]);

  assert.equal(
    originAllowed("https://www.cavbot.io", [{ origin: "https://cavbot.io", matchType: "EXACT" }]),
    true
  );
  assert.equal(
    originAllowed("https://cavbot.io", [{ origin: "https://www.cavbot.io", matchType: "EXACT" }]),
    true
  );
  assert.equal(originsShareWebsiteContext("https://cavbot.io", "https://www.cavbot.io"), true);
  assert.equal(originsShareWebsiteContext("https://www.cavbot.io", "https://cavbot.io"), true);
});

test("common multi-part apex domains still alias to their www host", () => {
  assert.deepEqual(expandRelatedExactOrigins("https://example.co.uk"), [
    "https://example.co.uk",
    "https://www.example.co.uk",
  ]);
});

test("non-www product subdomains do not alias to synthetic www variants", () => {
  assert.deepEqual(expandRelatedExactOrigins("https://app.cavbot.io"), ["https://app.cavbot.io"]);
  assert.equal(originsShareWebsiteContext("https://app.cavbot.io", "https://www.app.cavbot.io"), false);
});

test("website-context canonicalization rewrites www urls back to the stored site origin", () => {
  assert.equal(
    canonicalizeWebsiteContextOrigin("https://www.cavbot.io", "https://cavbot.io"),
    "https://cavbot.io"
  );
  assert.equal(
    canonicalizeWebsiteContextHost("www.cavbot.io", "https://cavbot.io"),
    "cavbot.io"
  );
  assert.equal(
    canonicalizeWebsiteContextUrl("https://www.cavbot.io/pricing?plan=pro#faq", "https://cavbot.io"),
    "https://cavbot.io/pricing?plan=pro#faq"
  );
  assert.equal(
    canonicalizeWebsiteContextUrl("https://external.example.com/pricing?plan=pro#faq", "https://cavbot.io"),
    "https://external.example.com/pricing?plan=pro#faq"
  );
});
