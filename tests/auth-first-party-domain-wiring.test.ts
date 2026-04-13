import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("api auth derives a shared cavbot.io cookie domain and first-party ai origin", () => {
  const source = read("lib/apiAuth.ts");

  assert.match(source, /export function resolveSessionCookieDomain\(req\?: Request\)/);
  assert.match(source, /if \(normalizedHost === "cavbot\.io" \|\| normalizedHost\.endsWith\("\.cavbot\.io"\)\) return "cavbot\.io";/);
  assert.match(source, /`https:\/\/ai\.\$\{firstPartyDomain\}`/);
  assert.match(source, /\.\.\.\(cookieDomain \? \{ domain: cookieDomain \} : \{\}\)/);
});

test("production wrangler config explicitly allows ai.cavbot.io and shared session cookies", () => {
  const source = read("wrangler.toml");

  assert.match(source, /ALLOWED_ORIGINS = "https:\/\/app\.cavbot\.io,https:\/\/ai\.cavbot\.io,https:\/\/www\.cavbot\.io,https:\/\/cavbot\.io"/);
  assert.match(source, /CAVBOT_SESSION_COOKIE_DOMAIN = "cavbot\.io"/);
});
