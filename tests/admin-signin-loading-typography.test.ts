import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("hq sign-in loading screen keeps welcome back copy on the standard loading size", () => {
  const source = read("app/admin-internal/sign-in/AdminSignInClient.tsx");
  const css = read("components/CavBotLoadingScreen.css");

  assert.match(source, /<CavBotLoadingScreen title="Welcome Back" className="hq-auth-loading" \/>/);
  assert.match(css, /\.pay-stage\.hq-auth-loading \.pay-processing h1,/);
  assert.match(css, /\.pay-stage\.hq-auth-loading \.pay-processing h1\.greeting\{/);
  assert.match(css, /font-size: 20px;/);
});
