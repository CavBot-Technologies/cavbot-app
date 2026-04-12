import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavcode keeps the Caven brand-mark surface styling available in the sidebar layer", () => {
  const css = read("app/cavcode/cavcode.css");

  assert.equal(css.includes(".cc-sidebar-brandMark{"), true);
  assert.equal(css.includes("width: 72px;"), true);
  assert.equal(css.includes("height: 72px;"), true);
  assert.equal(css.includes(".cc-sidebar-brandMark::before{"), true);
  assert.equal(css.includes(".cc-sidebar-brandMarkImg{"), true);
  assert.equal(css.includes(".cc-sidebar > :not(.cc-sidebar-brandMark){"), true);
  assert.equal(css.includes("transform: translate(-50%, -50%);"), true);
});

test("caven empty state renders the atom svg with a soft light-grey treatment", () => {
  const source = read("components/cavai/CavAiCodeWorkspace.tsx");
  const css = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(source.includes('src="/icons/app/cavcode/atom-svgrepo-com.svg"'), true);
  assert.equal(source.includes("className={styles.codePanelIdleBrand}"), true);
  assert.equal(source.includes("width={58}"), true);
  assert.equal(source.includes("height={58}"), true);
  assert.equal(source.includes("className={styles.codePanelEmptyLogoGlyph}"), true);
  assert.equal(css.includes(".codePanelIdleBrand {"), true);
  assert.equal(css.includes("min-height: clamp(220px, 42vh, 360px);"), true);
  assert.equal(css.includes(".codePanelEmptyLogo {"), true);
  assert.equal(css.includes("width: 92px;"), true);
  assert.equal(css.includes("height: 92px;"), true);
  assert.equal(css.includes("opacity: 0.62;"), true);
  assert.equal(css.includes("filter: brightness(0) saturate(100%) invert(88%)"), true);
});
