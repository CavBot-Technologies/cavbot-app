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

test("CavAi image studio keeps mobile presets above the prompt and removes slab wrappers", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");
  const css = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(
    source.includes("const imageStudioPresetPanel = canUseCreateImage && !overlay && (composerQuickMode === \"create_image\" || composerQuickMode === \"edit_image\") ? ("),
    true
  );
  assert.equal(source.includes("{!imageStudioMobileLayoutActive ? imageStudioPresetPanel : null}"), true);
  assert.equal(source.includes("<div className={styles.centerImageStudioMobileShelfWrap}>{imageStudioPresetPanel}</div>"), true);

  assert.equal(css.includes(".centerImageStudioMobileShelfWrap {"), true);
  assert.equal(
    css.includes(".imageStudioModePanel {\n  border: 0;\n  border-radius: 0;\n  background: transparent;\n  padding: 0;"),
    true
  );
  assert.equal(
    css.includes(".imageStudioPresetShelf {\n  border: 0;\n  border-radius: 0;\n  background: transparent;\n  padding: 0;"),
    true
  );
  assert.equal(css.includes(".imageStudioModal {\n    padding: 9px;"), true);
  assert.equal(css.includes(".imageStudioModePanel,\n  .imageStudioPresetShelf,\n  .imageStudioModal {"), false);
});
