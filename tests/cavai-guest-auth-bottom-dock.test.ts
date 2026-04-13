import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("CavAi guest auth docks into the desktop shell footer edge while mobile keeps the popover", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");
  const css = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(source.includes("const showDesktopGuestAuthPanel = !overlay && !isPhoneLayout && isGuestPreviewMode && accountMenuOpen;"), true);
  assert.equal(source.includes("{accountMenuOpen && isPhoneLayout ? renderGuestAuthPanel() : null}"), true);
  assert.equal(source.includes("{showDesktopGuestAuthPanel ? renderGuestAuthPanel({ docked: true }) : null}"), true);
  assert.equal(source.includes("showDesktopGuestAuthPanel ? styles.centerMainWithGuestAuth : \"\""), true);

  assert.equal(css.includes(".centerMainWithGuestAuth {"), true);
  assert.equal(css.includes("padding-right: clamp(320px, 28vw, 384px);"), true);
  assert.equal(css.includes(".centerGuestAuthPanelDocked {"), true);
  assert.equal(css.includes("border-right: 0;"), true);
  assert.equal(css.includes("border-bottom: 0;"), true);
  assert.equal(css.includes("border-radius: 18px 0 0 0;"), true);
  assert.equal(css.includes("bottom: 0;"), true);
});
