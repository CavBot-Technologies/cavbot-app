import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SECURITY_MAIL_FROM, resolveMailFrom } from "@/lib/email/sendEmail";

test("security email sender prefers CAVBOT_MAIL_FROM over legacy MAIL_FROM", () => {
  assert.equal(
    resolveMailFrom({
      CAVBOT_MAIL_FROM: "CavBot Security <security@cavbot.io>",
      MAIL_FROM: "legacy@cavbot.io",
    }),
    "CavBot Security <security@cavbot.io>",
  );
});

test("security email sender ignores copied placeholders and URL values", () => {
  assert.equal(
    resolveMailFrom({
      CAVBOT_MAIL_FROM: "paste_your_public_url_here",
      MAIL_FROM: "https://cavbot.io",
    }),
    DEFAULT_SECURITY_MAIL_FROM,
  );
});

