import "server-only";
import { webcrypto } from "crypto";

const crypto = webcrypto;

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function bytesToB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// If your DB stores base64 ciphertext + base64 IV
export async function decryptAesGcm(opts: { enc: string; iv: string }) {
  const master = process.env.CAVBOT_KEY_ENC_SECRET;
  if (!master) throw new Error("MISSING_ENC_SECRET");

  const keyBytes = b64ToBytes(master);
  if (keyBytes.length !== 32) throw new Error("BAD_ENC_SECRET_LENGTH");

  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);

  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(opts.iv) },
    key,
    b64ToBytes(opts.enc)
  );

  return new TextDecoder().decode(pt);
}

// Optional helper (useful when you first create the serverKeyEnc fields)
export async function encryptAesGcmB64(plaintext: string) {
  const master = process.env.CAVBOT_KEY_ENC_SECRET;
  if (!master) throw new Error("MISSING_ENC_SECRET");

  const keyBytes = b64ToBytes(master);
  if (keyBytes.length !== 32) throw new Error("BAD_ENC_SECRET_LENGTH");

  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );

  return {
    encB64: bytesToB64(new Uint8Array(encBuf)),
    ivB64: bytesToB64(iv),
  };
}