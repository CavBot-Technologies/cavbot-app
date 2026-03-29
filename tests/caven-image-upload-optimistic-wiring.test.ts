import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("caven image uploads render optimistically with upload-loading state", () => {
  const source = read("components/cavai/CavAiCodeWorkspace.tsx");
  const css = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(source.includes("uploading?: boolean;"), true);
  assert.equal(source.includes("if (draft.images.some((image) => image.uploading === true)) {"), true);
  assert.equal(source.includes("setError(\"Images are still uploading. Please wait a moment.\");"), true);
  assert.equal(source.includes("current.push({"), true);
  assert.equal(source.includes("uploading: true,"), true);
  assert.equal(source.includes("commitOptimisticImage"), true);
  assert.equal(source.includes("styles.attachmentChipUploading"), true);
  assert.equal(source.includes("styles.attachmentPreviewLoadingOverlay"), true);
  assert.equal(source.includes("styles.attachmentPreviewLoadingRing"), true);
  assert.equal(source.includes("!image.uploading ? ("), true);

  assert.equal(css.includes(".attachmentChipUploading"), true);
  assert.equal(css.includes(".attachmentPreviewWrap"), true);
  assert.equal(css.includes(".attachmentPreviewLoadingOverlay"), true);
  assert.equal(css.includes(".attachmentPreviewLoadingRing"), true);
});
