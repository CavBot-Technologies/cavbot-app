import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("hq sign-in reads autofilled credentials from the live inputs before submit", () => {
  const source = read("app/admin-internal/sign-in/AdminSignInClient.tsx");

  assert.match(source, /const identifierInputRef = useRef<HTMLInputElement \| null>\(null\);/);
  assert.match(source, /const passwordInputRef = useRef<HTMLInputElement \| null>\(null\);/);
  assert.match(source, /const readCredentialSnapshot = useCallback\(\(\) => \{/);
  assert.match(source, /const domIdentifier = String\(identifierInputRef\.current\?\.value \|\| ""\);/);
  assert.match(source, /const domPassword = String\(passwordInputRef\.current\?\.value \|\| ""\);/);
  assert.match(source, /const credentialSnapshot = readCredentialSnapshot\(\);/);
  assert.match(source, /performVerifyAwareLogin\(normalizedStaffCode, credentialSnapshot\.password\)/);
  assert.match(source, /window\.addEventListener\("pageshow", syncAutofill\)/);
  assert.match(source, /autoComplete="username"/);
  assert.match(source, /autoComplete="current-password"/);
});
