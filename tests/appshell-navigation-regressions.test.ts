import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("AppShell navigation hot-path avoids router.refresh and records route intents", () => {
  const source = read("components/AppShell.tsx");

  assert.equal(source.includes("router.refresh()"), false, "AppShell must not refresh router during navigation actions.");
  assert.equal(source.includes("data-cb-route-intent={item.href}"), true, "Sidebar links should expose route intents for perf tracing.");
  assert.equal(source.includes("recordNavigationStart("), true, "Navigation starts must be instrumented.");
});

test("AppShell owner-gated settings click does not block unresolved role", () => {
  const source = read("components/AppShell.tsx");

  assert.equal(source.includes("if (!memberRole || memberRole === \"OWNER\") return;"), true);
  assert.equal(source.includes("if (memberRole && memberRole !== \"OWNER\")"), true);
});

test("AppShell restores plan state from the cached shell snapshot before auth bootstrap settles", () => {
  const source = read("components/AppShell.tsx");

  assert.equal(source.includes("const [bootSnapshot] = useState<PlanSnapshot | null>(() => readShellPlanSnapshot());"), true);
  assert.equal(source.includes("const [planTier, setPlanTier] = useState<PlanTier>(bootSnapshot?.planTier || \"FREE\");"), true);
  assert.equal(source.includes("const [memberRole, setMemberRole] = useState<MemberRole>(bootSnapshot?.memberRole || null);"), true);
});

test("AppShell treats notification auth loss as passive recovery instead of emitting CavGuard", () => {
  const source = read("components/AppShell.tsx");

  assert.equal(source.includes("const handlePassiveAuthLoss = useCallback(() => {"), true);
  assert.equal(source.includes("if (isAuthRequiredLikeResponse(res.status, data)) {"), true);
  assert.equal(source.includes("guardMode: \"passive\""), true);
  assert.equal(source.includes("setSessionAuthenticated(false);"), true);
});

test("AppShell routes AUTH_REQUIRED dismiss flows back to login", () => {
  const source = read("components/AppShell.tsx");

  assert.equal(source.includes("const authLoginHref = useMemo(() => {"), true);
  assert.equal(source.includes("actionId === \"AUTH_REQUIRED\""), true);
  assert.equal(source.includes("authLoginHref"), true);
});

test("AppShell uses a single global click-outside listener lifecycle", () => {
  const source = read("components/AppShell.tsx");

  assert.match(
    source,
    /window\.addEventListener\("mousedown", onDown\)[\s\S]*window\.addEventListener\("keydown", onKey\)[\s\S]*}, \[\]\);/,
  );
});

test("Route lifecycle instrumentation captures click->start->commit and duplicate navs", () => {
  const lifecycle = read("app/_components/RouteLifecycle.tsx");
  const perf = read("lib/dev/routePerf.ts");

  assert.equal(lifecycle.includes("installRoutePerfObservers"), true);
  assert.equal(lifecycle.includes("recordRouteCommit"), true);
  assert.equal(perf.includes("[cb-perf][duplicate-nav]"), true);
  assert.equal(perf.includes("[cb-perf][route-commit]"), true);
  assert.equal(perf.includes("[cb-perf][same-path-nav]"), true);
});

test("Command Center uses Link for internal fast navigation", () => {
  const source = read("app/page.tsx");

  assert.equal(source.includes('<a className="cb-linkpill-red" href={errorsHref}>'), false);
  assert.equal(source.includes('<a className="cb-linkpill-ice" href={routesHref}>'), false);
  assert.equal(source.includes('<a className="cb-linkpill-lime" href={seoHref}>'), false);
  assert.equal(source.includes('<Link className="cb-linkpill-red" href={errorsHref}>'), true);
  assert.equal(source.includes('<Link className="cb-linkpill-ice" href={routesHref}>'), true);
  assert.equal(source.includes('<Link className="cb-linkpill-lime" href={seoHref}>'), true);
});

test("Auth form navigation avoids router.refresh", () => {
  const source = read("app/auth/page.tsx");
  assert.equal(source.includes("router.refresh()"), false);
});

test("Overlay pointer-events guard stays explicit", () => {
  const css = read("app/globals.css");

  assert.equal(css.includes(".cb-overlay"), true);
  assert.equal(css.includes("pointer-events:none"), true);
  assert.equal(css.includes(".cb-overlay.is-open"), true);
  assert.equal(css.includes("pointer-events:auto"), true);
});

test("AppShell scroll indicator keeps explicit up/down SVG assets", () => {
  const source = read("components/AppShell.tsx");

  assert.equal(source.includes('src="/icons/app/scroll-down-1382-svgrepo-com.svg"'), true);
  assert.equal(source.includes('src="/icons/app/scroll-up-1381-svgrepo-com.svg"'), true);
  assert.equal(source.includes("data-scroll-indicator={navScrollIndicator}"), true);
});
