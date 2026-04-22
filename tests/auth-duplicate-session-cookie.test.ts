import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("session parsing tries every duplicate cookie value instead of trusting the first token", () => {
  const source = read("lib/apiAuth.ts");

  assert.match(source, /function parseCookieValues\(header: string, name: string\)/);
  assert.match(source, /const cookieTokens = parseCookieValues\(cookieHeader, SESSION_COOKIE\);/);
  assert.match(source, /\[\.\.\.cookieTokens, bearer\]/);
  assert.match(source, /new Set\(/);
});

test("session cookie writes avoid a second same-name Set-Cookie while clears still prefer the shared-domain variant", () => {
  const source = read("lib/apiAuth.ts");

  assert.match(source, /function hostOnlyCookieOptions/);
  assert.match(source, /export function writeSessionCookie/);
  assert.match(source, /shared session cookie write failed; falling back to host-only cookie/);
  assert.match(source, /try \{\s*res\.cookies\.set\(name, token, cookieOpts\);\s*return res;\s*\} catch/);
  assert.match(source, /res\.cookies\.set\(name, token, hostOnlyOpts\);/);
  assert.match(source, /if \(!cookieOpts\.domain\)/);
  assert.match(source, /export function expireSessionCookie/);
  assert.match(source, /res\.cookies\.set\(name, "", \{ \.\.\.hostOnlyOpts, maxAge: 0 \}\);\s*\} catch[\s\S]*res\.cookies\.set\(name, "", \{ \.\.\.cookieOpts, maxAge: 0 \}\);/);
  assert.match(source, /shared session cookie clear failed/);
  assert.match(source, /legacy host-only session cookie clear failed/);
});
