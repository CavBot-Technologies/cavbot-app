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
  assert.match(authMe, /tierEffective: planTierTokenFromPlanId\(effectivePlanId\)/);
  assert.doesNotMatch(authMe, /forceFounderPremiumPlus/);
  assert.doesNotMatch(authMe, /founderUser \? "PREMIUM_PLUS"/);
  assert.match(settingsRoute, /const founderIdentity = normalizeCavbotFounderProfile/);
  assert.match(settingsRoute, /fullName: founderIdentity\.fullName/);
  assert.match(apiAuth, /if \(\s*sess\?\.systemRole === "user"/);
  assert.match(apiAuth, /activeMembership = await findSessionMembership\(pool, userId, String\(sess\.accountId\)\)/);
  assert.match(apiAuth, /const memberships = await findMembershipsForUser\(pool, userId\)/);
  assert.match(apiAuth, /sess\.accountId = String\(active\.accountId\)/);
  assert.match(apiAuth, /sess\.memberRole = active\.role/);
});

test("app shell republishes cached founder and plan state while footer modal and sidebar menu stay visible", () => {
  const appShell = read("components/AppShell.tsx");
  const homePage = read("app/page.tsx");
  const footerTsx = read("components/footer/CavbotGlobalFooter.tsx");
  const footerCss = read("components/footer/CavbotGlobalFooter.module.css");
  const globals = read("app/globals.css");

  assert.match(appShell, /const \[bootSnapshot\] = useState<PlanSnapshot \| null>\(\(\) => \{/);
  assert.match(appShell, /const cached = shellPlanSnapshotCache \?\? readShellPlanSnapshot\(\);/);
  assert.match(appShell, /return snapshotFromBootPlanState\(readBootClientPlanState\(\)\);/);
  assert.match(appShell, /useLayoutEffect\(\(\) => \{/);
  assert.match(appShell, /window\.addEventListener\("cb:plan", onPlan as EventListener\)/);
  assert.match(appShell, /window\.addEventListener\(SHELL_PLAN_EVENT, onPlan as EventListener\)/);
  assert.match(appShell, /globalThis\.__cbLocalStore\.setItem\("cb_profile_fullName_v1", nextFullName\)/);
  assert.match(appShell, /globalThis\.__cbLocalStore\.setItem\("cb_account_initials", nextInitials\)/);
  assert.match(appShell, /window\.dispatchEvent\(\s*new CustomEvent\("cb:profile"/);
  assert.match(appShell, /window\.dispatchEvent\(new CustomEvent\(SHELL_PLAN_EVENT, \{ detail: snapshot \}\)\)/);
  assert.match(homePage, /window\.dispatchEvent\(new CustomEvent\("cb:plan", \{ detail: planDetail \}\)\)/);
  assert.match(homePage, /const planDetail = \{/);
  assert.match(homePage, /globalThis\.__cbLocalStore\.getItem\(SHELL_PLAN_SNAPSHOT_KEY\)/);
  assert.match(homePage, /const showWelcomeVerifiedBadge =/);
  assert.match(homePage, /shellPlanId === "premium_plus"/);
  assert.match(homePage, /resolvePlanIdFromTier\(props\.fallbackPlanLabel\) === "premium_plus"/);
  assert.match(homePage, /\{showWelcomeVerifiedBadge \? \(/);
  assert.match(footerTsx, /className=\{`\$\{styles\.developerPanel\} \$\{developerOpen \? styles\.developerPanelOpen : ""\}`\}/);
  assert.match(footerCss, /\.developerPanelOpen,/);
  assert.doesNotMatch(globals, /\.cb-side-account-wrap \.cb-menu\{\s*top: calc\(100% \+ 8px\);/);
  assert.match(globals, /\.cb-side-account-wrap \.cb-menu\{\s*top: auto;\s*right: auto;\s*bottom: calc\(100% \+ 8px\);/);
});

test("app shell compact badge stays on eye-only tracking", () => {
  const appShell = read("components/AppShell.tsx");

  assert.match(appShell, /<CdnBadgeEyes trackingMode="eyeOnly" \/>/);
});

test("cavcloud compact screens restore document scrolling through tablets and keep quick tools visible", () => {
  const css = read("app/cavcloud/cavcloud.css");

  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-root\{[\s\S]*height: auto;[\s\S]*overflow-y: visible;/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-main\{[\s\S]*overflow-y: visible;[\s\S]*padding-bottom: calc\(var\(--cb-global-footer-height\) \+ var\(--safe-bottom\) \+ 22px\);/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-grid\{[\s\S]*overflow-y: visible;[\s\S]*padding-bottom: 12px;/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-top\{[\s\S]*position: static;/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-surfaceFooterIcons\{[\s\S]*display: flex;/);
});

test("cavcloud and cavsafe compact shells clip horizontal overflow while keeping vertical scroll", () => {
  const css = read("app/cavcloud/cavcloud.css");

  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-root\{[\s\S]*overflow-x: hidden;[\s\S]*overflow-x: clip;[\s\S]*overflow-y: visible;/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-main\{[\s\S]*overflow-x: hidden;[\s\S]*overflow-x: clip;[\s\S]*overflow-y: visible;/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-grid\{[\s\S]*overflow-x: hidden;[\s\S]*overflow-x: clip;[\s\S]*overflow-y: visible;/);
  assert.match(css, /@media \(max-width: 1100px\)\{[\s\S]*\.cavcloud-side,\s*[\s\S]*\.cavcloud-top,\s*[\s\S]*\.cavcloud-grid > \*,[\s\S]*max-width: 100%;/);
});

test("cavcloud and cavsafe mobile drawer width and compact header controls match the tighter app shell footprint", () => {
  const globals = read("app/globals.css");
  const css = read("app/cavcloud/cavcloud.css");

  assert.match(globals, /@media \(max-width: 979px\)\{[\s\S]*\.cb-sidebar\{[\s\S]*width: 86vw;[\s\S]*max-width: 340px;/);
  assert.match(css, /@media \(max-width: 980px\)\{[\s\S]*\.cavcloud-side\{[\s\S]*height: calc\(100dvh - var\(--cb-global-footer-height\) \+ 12px\);[\s\S]*width: min\(82vw, 320px\);[\s\S]*max-width: min\(82vw, 320px\);[\s\S]*padding: 18px 14px calc\(var\(--safe-bottom\) \+ 18px\);/);
  assert.match(css, /@media \(max-width: 980px\)\{[\s\S]*\.cavcloud-main\{[\s\S]*gap: 18px;/);
  assert.match(css, /@media \(max-width: 980px\)\{[\s\S]*\.cavcloud-top\{[\s\S]*width: calc\(100% \+ 36px\);[\s\S]*max-width: none;[\s\S]*margin: 0 -20px 0 -16px;[\s\S]*padding: calc\(10px \+ var\(--safe-top, 0px\)\) 10px 10px 16px;[\s\S]*gap: 10px;/);
  assert.match(css, /@media \(max-width: 980px\)\{[\s\S]*\.cavcloud-titleCompactShell\{[\s\S]*flex: 0 0 auto;/);
  assert.match(css, /@media \(max-width: 980px\)\{[\s\S]*\.cavcloud-sideFoot\{[\s\S]*padding-bottom: 10px;/);
  assert.match(css, /@media \(max-width: 980px\)\{[\s\S]*\.cavcloud-headerBadgeWrap\{[\s\S]*width: 40px;[\s\S]*height: 40px;/);
  assert.match(css, /@media \(max-width: 980px\)\{[\s\S]*\.cavcloud-headerMarkBadge\{[\s\S]*width: 26px;[\s\S]*height: 26px;/);
  assert.match(css, /@media \(max-width: 980px\)\{[\s\S]*\.cavcloud-actions\{[\s\S]*justify-content: flex-end;[\s\S]*gap: 6px;[\s\S]*padding-right: 8px;/);
  assert.match(css, /@media \(max-width: 980px\)\{[\s\S]*\.cavcloud-btnIconOnly,[\s\S]*width: 34px;[\s\S]*height: 34px;/);
  assert.match(css, /@media \(max-width: 980px\)\{[\s\S]*\.cavcloud-btnIconOnly svg,[\s\S]*width: 15px;[\s\S]*height: 15px;/);
  assert.match(css, /@media \(max-width: 980px\)\{[\s\S]*\.cavcloud-top \.cavcloud-btnGhost\.cavcloud-btnIconOnly,[\s\S]*background: rgba\(0,0,0,.22\);/);
  assert.match(css, /\.cavcloud-mobileMenuGlyph\{\s*width: 15px;\s*height: 15px;[\s\S]*display: block;[\s\S]*filter: brightness\(0\) invert\(\.96\);/);
  assert.match(css, /\.cavcloud-pageIntroHeading\{[\s\S]*font-size: 16px;/);
  assert.match(css, /\.cavcloud-headerBadgeWrap\{/);
  assert.doesNotMatch(css, /\.cavcloud-pageIntroSub\{/);
});

test("cavcloud and cavsafe direct surfaces persist full profile state and keep the legacy there/username footer fallback logic", () => {
  const appShell = read("components/AppShell.tsx");
  const cloud = read("app/cavcloud/CavCloudClient.tsx");
  const safe = read("app/cavsafe/CavSafeClient.tsx");
  const controls = read("components/cavcloud/CavSurfaceShellControls.tsx");

  assert.match(cloud, /readCachedCavcloudProfileState/);
  assert.match(cloud, /persistCavcloudProfileState/);
  assert.match(cloud, /persistCavcloudPlanState/);
  assert.match(cloud, /return "there";/);
  assert.match(cloud, /return t \|\| "C";/);
  assert.match(cloud, /CavSurfaceHeaderBadge/);
  assert.match(cloud, /CavSurfacePageIntro/);
  assert.match(cloud, /accountName: eE/);
  assert.match(cloud, /displayPlanTier = resolveCavcloudDisplayPlanTier\(eK, eE, eH\)/);
  assert.match(cloud, /const SHELL_PLAN_EVENT = "cb:shell-plan";/);
  assert.match(cloud, /window\.dispatchEvent\(new CustomEvent\(SHELL_PLAN_EVENT, \{/);
  assert.match(cloud, /window\.addEventListener\(SHELL_PLAN_EVENT, eSync\)/);
  assert.match(cloud, /cavcloudPlanTierFromPlanId\(payload\?\.usage\?\.planId \|\| eK\)/);
  assert.match(cloud, /resolveCavcloudPreferredPlanTier\(resolveCavcloudPlanTier\(lAccount\), readCachedCavcloudPlanState\(\)\.planTier\)/);
  assert.doesNotMatch(cloud, /"cavbot admin" === t \|\| "cavbot" === s \? "PREMIUM_PLUS"/);
  assert.match(cloud, /src: "\/icons\/menu-svgrepo-com\.svg"/);
  assert.match(cloud, /isCompactShell \? null : t\.jsx\("button", \{\s*className: "cavcloud-btn cavcloud-btnGhost cavcloud-btnIconOnly",[\s\S]*"aria-label": "Refresh"/);
  assert.match(safe, /readCachedCavsafeProfileState/);
  assert.match(safe, /persistCavsafeProfileState/);
  assert.match(safe, /persistCavsafePlanState/);
  assert.match(safe, /return "there";/);
  assert.match(safe, /return t \|\| "C";/);
  assert.match(safe, /CavSurfaceHeaderBadge/);
  assert.match(safe, /CavSurfacePageIntro/);
  assert.match(safe, /accountName: eE/);
  assert.match(safe, /displayPlanTier = resolveCavsafeDisplayPlanTier\(eK, eE, eH\)/);
  assert.match(safe, /const SHELL_PLAN_EVENT = "cb:shell-plan";/);
  assert.match(safe, /window\.dispatchEvent\(new CustomEvent\(SHELL_PLAN_EVENT, \{/);
  assert.match(safe, /cavsafePlanTierFromPlanId\(payload\?\.usage\?\.planId \|\| eK\)/);
  assert.match(safe, /resolveCavsafePreferredPlanTier\(resolveCavsafePlanTier\(lAccount\), readCachedCavsafePlanState\(\)\.planTier\)/);
  assert.doesNotMatch(safe, /"cavbot admin" === t \|\| "cavbot" === s \? "PREMIUM_PLUS"/);
  assert.match(safe, /src: "\/icons\/menu-svgrepo-com\.svg"/);
  assert.match(safe, /isCompactShell \? null : t\.jsx\("button", \{\s*className: "cavcloud-btn cavcloud-btnGhost cavcloud-btnIconOnly",[\s\S]*"aria-label": "Refresh"/);
  assert.match(controls, /export function CavSurfaceHeaderBadge/);
  assert.match(controls, /export function CavSurfacePageIntro/);
  assert.match(controls, /<Link className="cavcloud-brandMenuTrigger" href="\/" aria-label="Go to CavBot home">/);
  assert.match(controls, /src="\/logo\/cavbot-logomark\.svg"/);
  assert.match(controls, /className="cavcloud-headerMarkBadgeImg"/);
  assert.doesNotMatch(controls, /CdnBadgeEyes/);
  assert.doesNotMatch(controls, /Welcome back to your command center!/);
  assert.match(controls, /return "CavBot";/);
  assert.match(controls, /return "Premium";/);
  assert.match(controls, /return "Free";/);
  assert.match(controls, /return "there";/);
  assert.match(controls, /return "C";/);
  assert.match(appShell, /return resolveAccountDisplayName\(\{/);
  assert.match(appShell, /return resolveAccountPlanLabel\(\{/);
});

test("shared browser store survives reloads and cross-surface navigation with real browser storage", () => {
  const layout = read("app/layout.tsx");
  const browserStore = read("lib/browserMemoryStore.ts");

  assert.match(layout, /window\.localStorage/);
  assert.match(layout, /window\.sessionStorage/);
  assert.match(browserStore, /createStorageBackedStore/);
  assert.match(browserStore, /window\.localStorage/);
  assert.match(browserStore, /window\.sessionStorage/);
});
