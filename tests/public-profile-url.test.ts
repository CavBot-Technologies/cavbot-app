import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildCanonicalPublicProfileHref } from "@/lib/publicProfile/url";

function read(file: string) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

test("buildCanonicalPublicProfileHref returns the canonical root profile path", () => {
  assert.equal(buildCanonicalPublicProfileHref("@Daryna"), "/daryna");
  assert.equal(buildCanonicalPublicProfileHref(" CavBot "), "/cavbot");
  assert.equal(buildCanonicalPublicProfileHref(""), "");
});

test("logged-in avatar shells use the canonical public profile helper", () => {
  const files = [
    "components/AppShell.tsx",
    "components/cavai/CavAiCenterWorkspace.tsx",
    "app/cavcode/page.tsx",
    "app/cavcode-viewer/page.tsx",
    "app/cavtools/page.tsx",
    "app/cavcloud/CavCloudClient.tsx",
    "app/cavsafe/CavSafeClient.tsx",
    "app/cavbot-arcade/page.tsx",
    "app/cavbot-arcade/gallery/page.tsx",
  ];

  for (const file of files) {
    const source = read(file);
    assert.equal(source.includes("buildCanonicalPublicProfileHref"), true, `${file} should build canonical profile hrefs`);
    assert.equal(source.includes("openCanonicalPublicProfileWindow"), true, `${file} should open profile in a new tab`);
    assert.equal(source.includes("`/u/${encodeURIComponent("), false, `${file} should not point avatar profile links to /u/...`);
  }
});
