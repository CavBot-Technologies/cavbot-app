import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavcode sidebar header menus raise above section cards when open", () => {
  const page = read("app/cavcode/page.tsx");
  const css = read("app/cavcode/cavcode.css");

  assert.equal(page.includes('className={`cc-sidebar-head ${explorerHeaderMenuOpen ? "is-menu-open" : ""}`}'), true);
  assert.equal(page.includes('className={`cc-sidebar-head ${scmHeaderMenuOpen ? "is-menu-open" : ""}`}'), true);
  assert.equal(page.includes('className={`cc-sidebar-head ${changesHeaderMenuOpen ? "is-menu-open" : ""}`}'), true);
  assert.equal(page.includes('className={`cc-sidebar-head ${settingsHeaderMenuOpen ? "is-menu-open" : ""}`}'), true);
  assert.equal(page.includes('className={`cc-sidebar-head ${runHeaderMenuOpen ? "is-menu-open" : ""}`}'), true);
  assert.equal(page.includes('className={`cc-side-menuShell ${settingsHeaderMenuOpen ? "is-open" : ""}`}'), true);
  assert.equal(page.includes('className="cc-side-menuOverlay"'), true);
  assert.equal(css.includes(".cc-sidebar-head.is-menu-open{"), true);
  assert.equal(css.includes("z-index: calc(var(--z-pop) + 2) !important;"), true);
  assert.equal(css.includes(".cc-side-menuShell.is-open{"), true);
  assert.equal(css.includes("z-index: calc(var(--z-pop) + 4);"), true);
  assert.equal(css.includes(".cc-side-menuOverlay{"), true);
  assert.equal(css.includes("backdrop-filter: blur(10px) saturate(120%);"), true);
});
