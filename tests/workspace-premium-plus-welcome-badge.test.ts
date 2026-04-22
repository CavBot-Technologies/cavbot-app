import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("workspace command center welcome badge boots from shell snapshot and label fallback", () => {
  const source = read("app/page.tsx");

  assert.equal(source.includes('const SHELL_PLAN_SNAPSHOT_KEY = "cb_shell_plan_snapshot_v1";'), true);
  assert.equal(source.includes('const SHELL_PLAN_EVENT = "cb:shell-plan";'), true);
  assert.equal(source.includes("function readBootWorkspacePlanDetail()"), true);
  assert.equal(source.includes("function resolveWorkspacePlanId(detail?: WorkspacePlanDetail | null)"), true);
  assert.equal(source.includes("globalThis.__cbLocalStore.getItem(SHELL_PLAN_SNAPSHOT_KEY)"), true);
  assert.equal(source.includes("resolvePlanIdFromTier(detail?.planKey || detail?.planLabel || detail?.planTier || \"free\")"), true);
  assert.equal(source.includes("useLayoutEffect(() => {"), true);
  assert.equal(source.includes("window.addEventListener(SHELL_PLAN_EVENT, shellPlanHandler as EventListener)"), true);
});

test("workspace command center welcome header reads the live AppShell plan and shows the Premium+ badge", () => {
  const page = read("app/page.tsx");
  const shell = read("components/AppShell.tsx");

  assert.equal(
    page.includes('import AppShell, { useAppShellPlan } from "@/components/AppShell";'),
    true,
  );
  assert.equal(page.includes("function WorkspaceWelcomeHeader(props:"), true);
  assert.equal(page.includes("const shellPlan = useAppShellPlan();"), true);
  assert.equal(page.includes('shellPlanId === "premium_plus"'), true);
  assert.equal(page.includes("<WorkspaceWelcomeHeader"), true);
  assert.equal(page.includes('className="cb-welcome-verifiedBadge"'), true);
  assert.equal(shell.includes("const AppShellPlanContext = createContext<AppShellPlanContextValue>("), true);
  assert.equal(shell.includes("export function useAppShellPlan()"), true);
  assert.equal(shell.includes("<AppShellPlanContext.Provider value={shellPlanContextValue}>"), true);
});

test("AppShell publishes resolved plan changes so the command center header stays in sync", () => {
  const source = read("components/AppShell.tsx");

  assert.equal(source.includes('const SHELL_PLAN_EVENT = "cb:shell-plan";'), true);
  assert.equal(source.includes('window.dispatchEvent(new CustomEvent(SHELL_PLAN_EVENT, { detail: snapshot }))'), true);
});
