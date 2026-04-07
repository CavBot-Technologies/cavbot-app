import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("auth and settings routes normalize founder identity and keep the legacy auth/me profile payload", () => {
  const authMe = read("app/api/auth/me/route.ts");
  const settingsRoute = read("app/api/settings/account/route.ts");
  const apiAuth = read("lib/apiAuth.ts");

  assert.match(authMe, /profile: responseUser/);
  assert.match(authMe, /tierEffective: founderUser \? "PREMIUM_PLUS" : planTierTokenFromPlanId\(effectivePlanId\)/);
  assert.match(authMe, /const responseAccount = forceFounderPremiumPlus\(accountWithComputed \?\? account, founderUser\)/);
  assert.match(settingsRoute, /const founderIdentity = normalizeCavbotFounderProfile/);
  assert.match(settingsRoute, /fullName: founderIdentity\.fullName/);
  assert.match(apiAuth, /if \(\s*sess\?\.systemRole === "user"/);
  assert.match(apiAuth, /const memberships = await findMembershipsForUser\(getAuthPool\(\), String\(sess\.sub\)\)/);
  assert.match(apiAuth, /sess\.accountId = String\(active\.accountId\)/);
  assert.match(apiAuth, /sess\.memberRole = active\.role/);
});

test("app shell republishes cached founder and plan state while footer modal and sidebar menu stay visible", () => {
  const appShell = read("components/AppShell.tsx");
  const footerTsx = read("components/footer/CavbotGlobalFooter.tsx");
  const footerCss = read("components/footer/CavbotGlobalFooter.module.css");
  const globals = read("app/globals.css");

  assert.match(appShell, /const \[bootSnapshot\] = useState<PlanSnapshot \| null>\(\(\) => readShellPlanSnapshot\(\)\)/);
  assert.match(appShell, /globalThis\.__cbLocalStore\.setItem\("cb_profile_fullName_v1", nextFullName\)/);
  assert.match(appShell, /window\.dispatchEvent\(\s*new CustomEvent\("cb:profile"/);
  assert.match(appShell, /window\.dispatchEvent\(new CustomEvent\("cb:plan", \{ detail: planDetail \}\)\)/);
  assert.match(footerTsx, /className=\{`\$\{styles\.developerPanel\} \$\{developerOpen \? styles\.developerPanelOpen : ""\}`\}/);
  assert.match(footerCss, /\.developerPanelOpen,/);
  assert.doesNotMatch(globals, /\.cb-side-account-wrap \.cb-menu\{\s*top: calc\(100% \+ 8px\);/);
  assert.match(globals, /\.cb-side-account-wrap \.cb-menu\{\s*top: auto;\s*right: auto;\s*bottom: calc\(100% \+ 8px\);/);
});

test("cavcloud compact screens restore document scrolling through tablets and keep quick tools visible", () => {
  const css = read("app/cavcloud/cavcloud.css");

  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-root\{[\s\S]*height: auto;[\s\S]*overflow: visible;/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-main\{[\s\S]*overflow: visible;[\s\S]*padding-bottom: calc\(var\(--cb-global-footer-height\) \+ var\(--safe-bottom\) \+ 22px\);/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-grid\{[\s\S]*overflow: visible;[\s\S]*padding-bottom: 12px;/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-top\{[\s\S]*position: static;/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-surfaceFooterIcons\{[\s\S]*display: flex;/);
});

test("cavcloud and cavsafe direct surfaces persist full profile state and never fall back to there/CavBot Account", () => {
  const cloud = read("app/cavcloud/CavCloudClient.tsx");
  const safe = read("app/cavsafe/CavSafeClient.tsx");
  const controls = read("components/cavcloud/CavSurfaceShellControls.tsx");

  assert.match(cloud, /readCachedCavcloudProfileState/);
  assert.match(cloud, /persistCavcloudProfileState/);
  assert.match(cloud, /persistCavcloudPlanState/);
  assert.match(cloud, /accountName: eE \|\| eP/);
  assert.match(cloud, /displayPlanTier = resolveCavcloudDisplayPlanTier\(eK, eE \|\| eP, eH\)/);
  assert.match(safe, /readCachedCavsafeProfileState/);
  assert.match(safe, /persistCavsafeProfileState/);
  assert.match(safe, /persistCavsafePlanState/);
  assert.match(safe, /accountName: eE \|\| eP/);
  assert.match(safe, /displayPlanTier = resolveCavsafeDisplayPlanTier\(eK, eE \|\| eP, eH\)/);
  assert.doesNotMatch(controls, /return "CavBot Account";/);
  assert.doesNotMatch(controls, /return "there";/);
});
