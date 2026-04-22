import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("caven empty state keeps a smaller atom brandmark in the CavCode panel", () => {
  const source = read("components/cavai/CavAiCodeWorkspace.tsx");
  const css = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(source.includes("const codePanelIdleBrand = ("), true);
  assert.equal(source.includes("{showCodePanelHistoryBrand ? codePanelIdleBrand : null}"), true);
  assert.equal(source.includes("{showCodePanelChatBrand ? codePanelIdleBrand : null}"), true);

  assert.equal(css.includes(".codePanelIdleBrand {"), true);
  assert.equal(css.includes(".codePanelEmptyLogo {"), true);
  assert.equal(css.includes("width: 88px;"), true);
  assert.equal(css.includes("height: 88px;"), true);
  assert.equal(css.includes("width: 52px;"), true);
  assert.equal(css.includes("height: 52px;"), true);
  assert.equal(css.includes("background: rgba(224, 231, 242, 0.52);"), true);
  assert.equal(css.includes("opacity: 0.72;"), true);
  assert.equal(css.includes(".chatStreamEmpty {"), true);
  assert.equal(css.includes('mask: url("/icons/app/cavcode/atom-svgrepo-com.svg") center / contain no-repeat;'), true);
});
