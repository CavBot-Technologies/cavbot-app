import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("account settings uses company and link-focused profile copy", () => {
  const source = read("app/settings/sections/AccountOverviewClient.tsx");

  assert.equal(source.includes('<div className="sx-label">Company</div>'), true);
  assert.equal(source.includes('<div className="sx-label">Company or workspace</div>'), false);
  assert.equal(source.includes("<span>Links</span>"), true);
  assert.equal(source.includes('aria-label="Add link"'), true);
  assert.equal(source.includes(">Add link</span>"), true);
  assert.equal(source.includes("No links added yet."), true);
  assert.equal(source.includes("Add up to {MAX_CUSTOM_LINKS} URLs. You can remove them anytime, then save changes."), true);
  assert.equal(source.includes("CavBot, GitHub, Instagram, LinkedIn, and links"), true);
  assert.equal(source.includes('aria-label="URL"'), true);
  assert.equal(source.includes("Enter a valid URL."), true);
});
