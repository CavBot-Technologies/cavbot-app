import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("image composer keeps preset templates hidden and renders a single preset pill path", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("generationPromptTemplate"), false);
  assert.equal(source.includes("editPromptTemplate"), false);
  assert.equal(source.includes("negativePrompt"), false);
  assert.equal(source.includes("imageStudioPresetId: selectedImagePresetId || undefined"), true);
  assert.equal(source.includes("imageStudioPresetSlug"), false);
  assert.equal(source.includes("showComposerPresetPill"), true);
  assert.equal(source.includes("showComposerAttachmentChips"), true);
  assert.equal(
    source.includes("activeToolbarQuickMode === \"create_image\" || activeToolbarQuickMode === \"edit_image\" ? null : ("),
    true
  );
});

test("preset bootstrap and asset routes sanitize server payloads", () => {
  const presetServer = read("lib/cavai/imageStudio.server.ts");
  const importRoute = read("app/api/cavai/image-studio/import/route.ts");
  const uploadRoute = read("app/api/cavai/image-studio/upload/device/route.ts");
  const assetRoute = read("app/api/cavai/image-studio/assets/[assetId]/route.ts");

  assert.equal(presetServer.includes("export type ImagePresetClientRecord"), true);
  assert.equal(presetServer.includes("return visible.map((preset) => toImagePresetClientRecord(preset));"), true);
  assert.equal(importRoute.includes("asset: asset ? toImageAssetClientRecord(asset) : null"), true);
  assert.equal(uploadRoute.includes("asset: asset ? toImageAssetClientRecord(asset) : null"), true);
  assert.equal(assetRoute.includes("asset: toImageAssetClientRecord(asset)"), true);
});

test("center image response path does not return provider revised prompts", () => {
  const service = read("src/lib/ai/ai.service.ts");

  assert.equal(service.includes("...(s(row.revisedPrompt) ? { revisedPrompt: s(row.revisedPrompt) } : {})"), false);
  assert.equal(service.includes("revisedPrompt: s(providerImage?.revisedPrompt) || null"), true);
  assert.equal(service.includes("sourcePrompt: imagePrompt"), true);
});
