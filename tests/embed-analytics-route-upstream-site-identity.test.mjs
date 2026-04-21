import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("embed analytics proxy strips local site public ids before forwarding upstream", () => {
  const source = read("app/api/embed/analytics/route.ts");

  assert.equal(source.includes("function stripUpstreamSitePublicIds"), true);
  assert.equal(source.includes('key === "site_public_id" || key === "sitePublicId"'), true);
  assert.equal(source.includes("delete siteRecord.public_id;"), true);
  assert.equal(source.includes("const upstreamPayload = stripUpstreamSitePublicIds(canonicalPayload)"), true);
  assert.equal(source.includes("body: upstreamPayload ? JSON.stringify(upstreamPayload) : undefined"), true);
  assert.equal(source.includes('headers["X-Cavbot-Site-Public-Id"] = siteId;'), false);
});
