import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(file: string) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

test("public website session endpoint exposes credentialed CavBot website awareness only", () => {
  const source = read("app/api/public/website-session/route.ts");

  assert.equal(source.includes('"https://cavbot.io"'), true);
  assert.equal(source.includes('"https://www.cavbot.io"'), true);
  assert.equal(source.includes('"https://ai.cavbot.io"'), true);
  assert.equal(source.includes('"Access-Control-Allow-Credentials"] = "true"'), true);
  assert.equal(source.includes('Vary: "Origin, Cookie"'), true);
  assert.equal(source.includes("readVerifiedSession(req)"), true);
  assert.equal(source.includes("readAuthSessionView(sess)"), true);
  assert.equal(source.includes("avatarImage"), true);
  assert.equal(source.includes("initialsFor(user)"), true);
  assert.equal(source.includes("email:"), false, "Website awareness must not expose email.");
  assert.equal(source.includes("account:"), false, "Website awareness must not expose account data.");
});
