import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("dashboard heading uses saved account profile name instead of U fallback", () => {
  const source = read("app/console/page.tsx");

  assert.equal(source.includes('const fallbackOwner = "Your";'), true);
  assert.equal(source.includes("const fallbackOwner = \"U's\";"), false);
  assert.equal(source.includes("profile?.fullName || profile?.displayName || authUser?.fullName || authUser?.displayName"), true);
  assert.equal(source.includes("const cookieStore = await cookies();"), true);
});

