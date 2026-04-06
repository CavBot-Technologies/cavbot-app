import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcloud and cavsafe footer restore surface quick tools and keep premium plus badge", () => {
  const controls = read("components/cavcloud/CavSurfaceShellControls.tsx");
  const cloud = read("app/cavcloud/CavCloudClient.tsx");
  const safe = read("app/cavsafe/CavSafeClient.tsx");
  const css = read("app/cavcloud/cavcloud.css");

  assert.match(controls, /className=\{`cb-icon-btn cavcloud-surfaceQuickTool \$\{props\.galleryActive \? "is-active" : ""\}`\}/);
  assert.match(controls, /onClick=\{props\.onOpenCompanion\}/);
  assert.match(controls, /<IconGallerySquares \/>/);
  assert.match(controls, /<IconGear \/>/);
  assert.match(controls, /props\.planTier === "PREMIUM_PLUS" \? \(\s*<IconPremiumPlusStar \/>/);
  assert.match(cloud, /galleryActive: "Gallery" === S/);
  assert.match(cloud, /onOpenCompanion: openCavSafe/);
  assert.match(safe, /onOpenCompanion: openCavCloud/);
  assert.match(cloud, /eB\(l\.name \|\| resolveCavcloudGreetingName\(l\)\)/);
  assert.match(safe, /eB\(l\.name \|\| resolveCavsafeGreetingName\(l\)\)/);
  assert.match(css, /\.cavcloud-surfaceFooterIcons\{[\s\S]*display: inline-flex;[\s\S]*align-items: center;/);
  assert.match(css, /\.cavcloud-surfaceQuickToolGridCell\.is-violet\{/);
  assert.match(css, /\.cavcloud-headerGreeting\{[\s\S]*gap: 4px;[\s\S]*font-size: 16px;/);
});
