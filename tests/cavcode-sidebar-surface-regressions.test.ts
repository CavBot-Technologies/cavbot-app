import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcode sidebar menus render on an isolated top-layer surface", () => {
  const source = read("app/cavcode/cavcode.css");

  assert.match(source, /\.cc-sidebar-head\{[\s\S]*position: relative;[\s\S]*overflow: visible;[\s\S]*isolation: isolate;/);
  assert.match(source, /\.cc-side-menuShell\{[\s\S]*z-index: calc\(var\(--z-pop\) \+ 1\);[\s\S]*isolation: isolate;/);
  assert.match(source, /\.cc-side-menu\{[\s\S]*z-index: calc\(var\(--z-pop\) \+ 2\);[\s\S]*overflow: hidden;[\s\S]*isolation: isolate;/);
});

test("cavcode search stays top-aligned and changes commit input keeps shared field styling", () => {
  const pageSource = read("app/cavcode/page.tsx");
  const cssSource = read("app/cavcode/cavcode.css");

  assert.match(pageSource, /className="cc-search-bar"/);
  assert.doesNotMatch(pageSource, /className="cc-search-shell"/);
  assert.doesNotMatch(pageSource, /className="cc-search-kicker mono"/);
  assert.doesNotMatch(pageSource, /className="cc-search-note"/);

  assert.match(cssSource, /\.cc-search\{[\s\S]*padding: 10px 8px 12px;[\s\S]*gap: 12px;/);
  assert.match(cssSource, /\.cc-search-bar\{[\s\S]*padding-top: 2px;/);
  assert.match(cssSource, /\.cc-search-in\{[\s\S]*font-family: var\(--cb-mono\);/);
  assert.match(cssSource, /\.cc-search \.cc-search-in\{[\s\S]*border-radius: 10px;/);
  assert.match(cssSource, /\.cc-changes-commitInput\{[\s\S]*padding: 0 40px 0 9px;/);
  assert.match(cssSource, /\.cc-hit:last-child\{/);
});
