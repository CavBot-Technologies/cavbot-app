import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("root layout injects the authenticated shell bootstrap before hydration", () => {
  const layout = read("app/layout.tsx");
  const helper = read("lib/authClientBootstrap.server.ts");
  const clientHelper = read("lib/clientAuthBootstrap.ts");

  assert.match(layout, /readClientAuthBootstrapServerState/);
  assert.match(layout, /buildClientAuthBootstrapScript/);
  assert.match(layout, /id="cb-auth-bootstrap"/);
  assert.match(helper, /globalThis\.__CB_AUTH_BOOTSTRAP__=boot/);
  assert.match(helper, /cb_shell_plan_snapshot_v1/);
  assert.match(helper, /cb_profile_fullName_v1/);
  assert.match(clientHelper, /export function readBootClientAuthBootstrap/);
  assert.match(clientHelper, /export function readBootClientPlanState/);
  assert.match(clientHelper, /export function readBootClientProfileState/);
});

test("shell and command center fast-paint from the bootstrapped profile and preserve stronger plan snapshots", () => {
  const appShell = read("components/AppShell.tsx");
  const homePage = read("app/page.tsx");
  const billing = read("app/settings/sections/BillingClient.tsx");
  const cloud = read("app/cavcloud/CavCloudClient.tsx");
  const safe = read("app/cavsafe/CavSafeClient.tsx");

  assert.match(appShell, /readBootClientProfileState/);
  assert.match(appShell, /const \[bootProfile\] = useState\(\(\) => readBootClientProfileState\(\)\)/);
  assert.match(appShell, /useLayoutEffect\(\(\) => \{/);
  assert.match(appShell, /window\.dispatchEvent\(new CustomEvent\("cb:profile-sync"\)\)/);

  assert.match(homePage, /readBootClientAuthBootstrap/);
  assert.match(homePage, /readBootClientProfileState/);
  assert.match(homePage, /const \[bootAuth\] = useState\(\(\) => readBootClientAuthBootstrap\(\)\)/);
  assert.match(homePage, /const \[welcomeBootProfile\] = useState\(\(\) => readBootClientProfileState\(\)\)/);
  assert.match(homePage, /const \[bootProfile\] = useState\(\(\) => readBootClientProfileState\(\)\)/);
  assert.match(homePage, /preserveStrongerCached: true/);
  assert.match(billing, /preserveStrongerCached: true/);
  assert.match(cloud, /resolveCavcloudPreferredPlanTier\(ePlanTier, n\.planTier\)/);
  assert.match(safe, /resolveCavsafePreferredPlanTier\(ePlanTier, n\.planTier\)/);
});

test("CavAi surfaces publish authenticated plan confirmations into the shared plan channel", () => {
  const launcher = read("components/cavai/CavAiCenterLauncher.tsx");
  const center = read("components/cavai/CavAiCenterWorkspace.tsx");
  const code = read("components/cavai/CavAiCodeWorkspace.tsx");

  assert.match(launcher, /const \[workspaceMounted, setWorkspaceMounted\] = useState\(\(\) => Boolean\(props\.preload\)\)/);
  assert.match(launcher, /setWorkspaceMounted\(true\);/);
  assert.match(launcher, /workspaceMounted && typeof document !== "undefined"/);
  assert.match(center, /import \{ publishClientPlan, readBootClientPlanBootstrap, subscribeClientPlan \} from "@\/lib\/clientPlan";/);
  assert.match(center, /import \{ readBootClientProfileState \} from "@\/lib\/clientAuthBootstrap";/);
  assert.match(center, /const \[bootProfile\] = useState\(\(\) => readBootClientProfileState\(\)\)/);
  assert.match(center, /const bootAuthenticatedHint = planBoot\.authenticatedHint \|\| hasBootProfileSignal\(bootProfile\)/);
  assert.match(center, /const isGuestPreviewMode = authProbeReady && !isAuthenticated;/);
  assert.match(center, /publishClientPlan\(\{\s*planId: effectivePlanId,\s*preserveStrongerCached: true,/);
  assert.match(center, /publishClientPlan\(\{\s*planId: authPlanId,\s*preserveStrongerCached: true,/);
  assert.match(center, /if \(nextAuthenticatedHint\) \{\s*setIsAuthenticated\(true\);/);

  assert.match(code, /import \{ publishClientPlan, readBootClientPlanBootstrap, subscribeClientPlan \} from "@\/lib\/clientPlan";/);
  assert.match(code, /publishClientPlan\(\{\s*planId: effectivePlanId,\s*preserveStrongerCached: true,/);
  assert.match(code, /publishClientPlan\(\{\s*planId: authPlanId,\s*preserveStrongerCached: true,/);
});
