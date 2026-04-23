import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("app badge motion matches the softer website pupil-tracking profile", () => {
  const source = read("app/_components/CavbotBadgeMotion.tsx");

  assert.match(source, /const POINTER_IDLE_COOLDOWN_MS = 1200;/);
  assert.match(source, /const POINTER_FALLOFF_DISTANCE = 180;/);
  assert.match(source, /const IDLE_X_AMPLITUDE = 0\.42;/);
  assert.match(source, /const IDLE_Y_AMPLITUDE = 0\.34;/);
  assert.match(source, /const SHIFT_RATIO = 0\.12;/);
  assert.match(source, /const MIN_SHIFT = 2\.4;/);
  assert.match(source, /const MAX_SHIFT = 4\.8;/);
  assert.match(source, /eye\.pupil\.style\.transform = `translate3d\(\$\{shiftX\.toFixed\(2\)\}px, \$\{shiftY\.toFixed\(2\)\}px, 0\)`;/);
  assert.doesNotMatch(source, /eye\.track\.style\.transform/);
});
