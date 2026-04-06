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

  assert.match(controls, /cavcloud-surfaceQuickToolLauncherBtn/);
  assert.match(controls, /onClick=\{\(\) => setToolsOpen\(\(prev\) => !prev\)\}/);
  assert.match(controls, /cavcloud-surfaceQuickToolRail/);
  assert.match(controls, /onClick=\{\(\) => \{\s*setToolsOpen\(false\);\s*props\.onOpenCompanion\(\);/);
  assert.match(controls, /onClick=\{\(\) => \{\s*setToolsOpen\(false\);\s*props\.onOpenGallery\(\);/);
  assert.match(controls, /<IconGallerySquares \/>/);
  assert.match(controls, /<IconGalleryPalette \/>/);
  assert.match(controls, /<IconGear \/>/);
  assert.match(controls, /<span className="cavcloud-headerGreetingPrefix">Hi, <\/span>/);
  assert.match(controls, /iconSizePx=\{18\}/);
  assert.match(controls, /cavcloud-surfaceQuickToolIconGallery/);
  assert.match(controls, /cavcloud-surfaceQuickToolIconSettings/);
  assert.match(controls, /props\.planTier === "PREMIUM_PLUS" \? \(\s*<IconPremiumPlusStar \/>/);
  assert.match(cloud, /galleryActive: "Gallery" === S/);
  assert.match(cloud, /onOpenCompanion: openCavSafe/);
  assert.match(safe, /onOpenCompanion: openCavCloud/);
  assert.match(cloud, /companionIconWidth: 18/);
  assert.match(safe, /companionIconWidth: 18/);
  assert.match(cloud, /surfaceTitle = "CavCloud"/);
  assert.equal(cloud.includes("CavCloud Storage"), false);
  assert.equal(cloud.includes('key: "Settings",\n    label: "Settings",\n    icon: "settings"'), false);
  assert.equal(safe.includes('key: "Settings",\n    label: "Settings",\n    icon: "settings"'), false);
  assert.equal(cloud.includes('className: "cavcloud-paneSubFolderName"'), false);
  assert.equal(safe.includes('className: "cavcloud-paneSubFolderName"'), false);
  assert.match(cloud, /eB\(l\.name \|\| resolveCavcloudGreetingName\(l\)\)/);
  assert.match(safe, /eB\(l\.name \|\| resolveCavsafeGreetingName\(l\)\)/);
  assert.match(css, /\.cavcloud-surfaceFooterIcons\{[\s\S]*display: flex;[\s\S]*background: transparent;/);
  assert.match(css, /\.cavcloud-surfaceQuickToolLauncher\{/);
  assert.match(css, /\.cavcloud-surfaceQuickToolRail\{[\s\S]*display: inline-flex;/);
  assert.match(css, /\.cavcloud-surfaceQuickToolGrid \.is-violet\{/);
  assert.match(css, /\.cavcloud-brandMenuSurface\{[\s\S]*text-transform: none;/);
  assert.match(css, /\.cavcloud-surfaceLauncherActionIconMark\{[\s\S]*width: 18px;[\s\S]*height: 18px;/);
  assert.match(css, /\.cavcloud-paneTitleSelect\{[\s\S]*background-position: right 14px center;/);
  assert.match(css, /\.cavcloud-paneTitleSelect\{[\s\S]*appearance: none;/);
  assert.match(css, /\.cavcloud-headerGreeting\{[\s\S]*gap: 4px;[\s\S]*font-size: 16px;/);
});
