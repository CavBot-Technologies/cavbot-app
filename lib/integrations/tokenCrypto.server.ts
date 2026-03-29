import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function readSecretOrThrow(): string {
  const raw = String(process.env.CAVBOT_INTEGRATIONS_TOKEN_ENC_SECRET || "").trim();
  if (!raw) {
    throw new Error("INTEGRATIONS_TOKEN_ENC_SECRET_MISSING");
  }
  if (raw.length < 64) {
    throw new Error("INTEGRATIONS_TOKEN_ENC_SECRET_TOO_SHORT");
  }
  return raw;
}

function deriveAesKey(secret: string): Buffer {
  // Hashing gives us a fixed 32-byte key while keeping env handling simple.
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptIntegrationToken(plaintext: string): string {
  const value = String(plaintext || "");
  if (!value) {
    throw new Error("INTEGRATIONS_TOKEN_EMPTY");
  }

  const secret = readSecretOrThrow();
  const key = deriveAesKey(secret);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [ENVELOPE_VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptIntegrationToken(envelope: string): string {
  const raw = String(envelope || "").trim();
  if (!raw) {
    throw new Error("INTEGRATIONS_TOKEN_ENVELOPE_REQUIRED");
  }

  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error("INTEGRATIONS_TOKEN_ENVELOPE_INVALID");
  }

  const iv = Buffer.from(parts[1] || "", "base64url");
  const tag = Buffer.from(parts[2] || "", "base64url");
  const ciphertext = Buffer.from(parts[3] || "", "base64url");

  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length < 1) {
    throw new Error("INTEGRATIONS_TOKEN_ENVELOPE_INVALID");
  }

  const secret = readSecretOrThrow();
  const key = deriveAesKey(secret);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
