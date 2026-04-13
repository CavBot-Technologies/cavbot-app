import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("CavAi guest auth floats above the desktop workspace while mobile keeps the popover", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");
  const css = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(source.includes("const showDesktopGuestAuthPanel = !overlay && !isPhoneLayout && isGuestPreviewMode && accountMenuOpen;"), true);
  assert.equal(source.includes("{accountMenuOpen && isPhoneLayout ? renderGuestAuthPanel() : null}"), true);
  assert.equal(source.includes("{showDesktopGuestAuthPanel ? renderGuestAuthPanel() : null}"), true);
  assert.equal(source.includes("showDesktopGuestAuthPanel ? styles.centerMainWithGuestAuth : \"\""), false);
  assert.equal(source.includes("renderGuestAuthPanel({ docked: true })"), false);

  assert.equal(css.includes(".centerGuestAuthPanel {"), true);
  assert.equal(css.includes("position: fixed;"), true);
  assert.equal(css.includes("right: clamp(12px, 1.8vw, 22px);"), true);
  assert.equal(css.includes("bottom: clamp(10px, 1.8vw, 22px);"), true);
});
