import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcloud and cavsafe footer mirror the app shell quick-tool stack and premium plus badge", () => {
  const controls = read("components/cavcloud/CavSurfaceShellControls.tsx");
  const cloud = read("app/cavcloud/CavCloudClient.tsx");
  const safe = read("app/cavsafe/CavSafeClient.tsx");
  const css = read("app/cavcloud/cavcloud.css");

  assert.match(controls, /className="cb-icon-btn cb-icon-btn-arcade cavcloud-surfaceQuickTool"/);
  assert.match(controls, /href="https:\/\/cavbot\.io\/help-center"/);
  assert.match(controls, /<IconGear \/>/);
  assert.match(controls, /props\.planTier === "PREMIUM_PLUS" \? \(\s*<IconPremiumPlusStar \/>/);
  assert.doesNotMatch(controls, /galleryActive|onOpenGallery|onOpenCompanion|companionLabel/);
  assert.match(cloud, /onOpenArcade: openArcade/);
  assert.match(safe, /onOpenArcade: openArcade/);
  assert.match(cloud, /eB\(l\.name \|\| resolveCavcloudGreetingName\(l\)\)/);
  assert.match(safe, /eB\(l\.name \|\| resolveCavsafeGreetingName\(l\)\)/);
  assert.match(css, /\.cavcloud-headerGreeting\{[\s\S]*gap: 4px;[\s\S]*font-size: 16px;/);
});
