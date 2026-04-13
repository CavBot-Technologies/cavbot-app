import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("CavAi mobile drawer restores focus before the hidden drawer can retain it", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.match(source, /const mobileDrawerRef = useRef<HTMLElement \| null>\(null\);/);
  assert.match(source, /const mobileDrawerReturnFocusRef = useRef<HTMLElement \| null>\(null\);/);
  assert.match(source, /if \(mobileDrawerOpen \|\| accountMenuOpen\) return;/);
  assert.match(source, /const drawer = mobileDrawerRef\.current;/);
  assert.match(source, /const returnTarget = mobileDrawerReturnFocusRef\.current;/);
  assert.match(source, /returnTarget\.focus\(\);/);
  assert.match(source, /active\.blur\(\);/);
  assert.match(source, /ref=\{mobileDrawerRef\}/);
  assert.match(source, /\{\.\.\.\(mobileDrawerHidden \? \(\{ inert: "" \} as Record<string, unknown>\) : \{\}\)\}/);
  assert.match(source, /onClick=\{\(event\) => toggleMobileDrawer\(event\.currentTarget\)\}/);
});
