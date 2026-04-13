import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("CavAi image studio uses a relaxed scrollable layout on small screens", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");
  const css = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(source.includes("const imageStudioMobileLayoutActive = !overlay && isPhoneLayout && imageComposerModeActive;"), true);
  assert.equal(source.includes("imageStudioMobileLayoutActive ? styles.centerMainImageStudioMobile : \"\""), true);
  assert.equal(source.includes("imageStudioMobileLayoutActive ? styles.centerPageRootImageStudioMobile : \"\""), true);

  assert.equal(css.includes(".centerPageRootImageStudioMobile {"), true);
  assert.equal(css.includes(".centerPageRootImageStudioMobile .centerShellPage {"), true);
  assert.equal(css.includes(".centerMainImageStudioMobile {"), true);
  assert.equal(css.includes("overflow-y: auto;"), true);
  assert.equal(css.includes("overflow: visible;"), true);
  assert.equal(css.includes(".centerMainImageStudioMobile .centerThreadInnerEmpty {"), true);
  assert.equal(css.includes("justify-content: flex-start;"), true);
  assert.equal(css.includes(".centerMainImageStudioMobile .centerEmptyState {"), true);
  assert.equal(css.includes("padding-top: 28px;"), true);
  assert.equal(css.includes(".centerMainImageStudioMobile .imageStudioModePanel {"), true);
  assert.equal(css.includes(".centerMainImageStudioMobile .imageStudioPresetShelf {"), true);
  assert.equal(css.includes(".centerMainImageStudioMobile .centerComposer {"), true);
  assert.equal(css.includes("border-top: 0;"), true);
});
