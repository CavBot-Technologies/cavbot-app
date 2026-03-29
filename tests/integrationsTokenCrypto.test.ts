import assert from "node:assert/strict";
import test from "node:test";

import { decryptIntegrationToken, encryptIntegrationToken } from "@/lib/integrations/tokenCrypto.server";

const TEST_SECRET = "integration-secret-for-tests-0123456789abcdefghijklmnopqrstuvwxyz-ABCDEFG";

test("encryptIntegrationToken/decryptIntegrationToken roundtrip", () => {
  const previous = process.env.CAVBOT_INTEGRATIONS_TOKEN_ENC_SECRET;
  process.env.CAVBOT_INTEGRATIONS_TOKEN_ENC_SECRET = TEST_SECRET;

  try {
    const plaintext = "refresh_token_value_123";
    const envelope = encryptIntegrationToken(plaintext);

    assert.notEqual(envelope, plaintext);
    assert.ok(envelope.startsWith("v1."));
    assert.equal(decryptIntegrationToken(envelope), plaintext);
  } finally {
    process.env.CAVBOT_INTEGRATIONS_TOKEN_ENC_SECRET = previous;
  }
});

test("decryptIntegrationToken rejects tampered payload", () => {
  const previous = process.env.CAVBOT_INTEGRATIONS_TOKEN_ENC_SECRET;
  process.env.CAVBOT_INTEGRATIONS_TOKEN_ENC_SECRET = TEST_SECRET;

  try {
    const envelope = encryptIntegrationToken("refresh_token_value_456");
    const parts = envelope.split(".");
    const tamperedCiphertext = Buffer.from("tampered", "utf8").toString("base64url");
    const tampered = [parts[0], parts[1], parts[2], tamperedCiphertext].join(".");

    assert.throws(() => decryptIntegrationToken(tampered));
  } finally {
    process.env.CAVBOT_INTEGRATIONS_TOKEN_ENC_SECRET = previous;
  }
});
