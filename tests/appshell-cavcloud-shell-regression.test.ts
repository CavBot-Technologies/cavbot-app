import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("app shell keeps the multicolor quick tools trigger and founder premium plus display", () => {
  const appShell = read("components/AppShell.tsx");
  const globals = read("app/globals.css");

  assert.equal(appShell.includes('grid-svgrepo-com copy.svg'), false);
  assert.match(appShell, /const founderProfileShowsPremiumPlus = useMemo/);
  assert.match(appShell, /const profileShowsPremiumPlus = planTier === "PREMIUM_PLUS" \|\| founderProfileShowsPremiumPlus/);
  assert.match(appShell, /if \(profileShowsPremiumPlus\) return "PREMIUM\+"/);
  assert.match(appShell, /className="cb-side-tools-grid"/);
  assert.match(globals, /\.cb-side-tools-grid\{/);
  assert.match(globals, /\.cb-side-tools-grid \.is-lime\{/);
});

test("app shell keeps the CavPad header trigger visible independently from dock mounting", () => {
  const appShell = read("components/AppShell.tsx");

  assert.match(appShell, /const shouldRenderCavPadTrigger = showCavPad;/);
  assert.match(appShell, /const shouldMountCavPad = showCavPad && \(authenticatedWorkspaceUser \|\| cavPadOpen\);/);
  assert.match(appShell, /\{shouldRenderCavPadTrigger \? \(/);
  assert.match(appShell, /aria-label="Open CavPad"/);
});

test("cavcloud and cavsafe gate compact header controls to compact shell only", () => {
  const cloud = read("app/cavcloud/CavCloudClient.tsx");
  const safe = read("app/cavsafe/CavSafeClient.tsx");
  const css = read("app/cavcloud/cavcloud.css");

  assert.match(cloud, /\[isCompactShell, setIsCompactShell\]/);
  assert.match(safe, /\[isCompactShell, setIsCompactShell\]/);
  assert.match(cloud, /children: \[isCompactShell \? t\.jsx\("button"/);
  assert.match(safe, /children: \[isCompactShell \? t\.jsx\("button"/);
  assert.match(cloud, /isCompactShell \? null : t\.jsx\("input", \{\s*className: "cavcloud-search"/);
  assert.match(safe, /isCompactShell \? null : t\.jsx\("input", \{\s*className: "cavcloud-search"/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-top\{[\s\S]*position: static;/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-root\{[\s\S]*height: auto;[\s\S]*overflow-x: hidden;[\s\S]*overflow-x: clip;[\s\S]*overflow-y: visible;/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-surfaceFooterIcons\{[\s\S]*display: flex;/);

  const stickyShellIndex = css.lastIndexOf(".cavcloud-top{\n  position: sticky;");
  const mobileStaticIndex = css.lastIndexOf(".cavcloud-top{\n    position: static;");

  assert.equal(stickyShellIndex >= 0, true);
  assert.equal(mobileStaticIndex > stickyShellIndex, true);
});
