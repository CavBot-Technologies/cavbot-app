// lib/auth/passwordReset.ts
import crypto from "crypto";

// ---------------------------
// Token helpers
// ---------------------------
export function mintResetToken() {
  // 32 bytes => 64 hex chars (strong)
  return crypto.randomBytes(32).toString("hex");
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ---------------------------
// Password hashing (PBKDF2)
// ---------------------------
// Matches your CavBot Auth model style (pbkdf2 + salt)
export function hashPasswordPBKDF2(password: string, salt?: string) {
  const nextSalt = salt || crypto.randomBytes(16).toString("hex");

  const derived = crypto.pbkdf2Sync(
    password,
    nextSalt,
    120_000, // strong iteration count
    64,
    "sha512"
  );

  return {
    salt: nextSalt,
    hash: derived.toString("hex"),
  };
}

export function verifyPasswordPBKDF2(password: string, salt: string, hash: string) {
  const test = hashPasswordPBKDF2(password, salt).hash;
  return crypto.timingSafeEqual(Buffer.from(test, "hex"), Buffer.from(hash, "hex"));
}

// ---------------------------
// Security helpers
// ---------------------------
export function safeOkResponse() {
  // Always return success to avoid email enumeration attacks
  return { ok: true };
}
