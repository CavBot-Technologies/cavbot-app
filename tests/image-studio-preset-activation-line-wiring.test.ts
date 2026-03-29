import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("center image composer uses visible activation lines and locked preset copy", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("Create image in ${label} style"), true);
  assert.equal(source.includes("Edit image in ${label} style"), true);
  assert.equal(source.includes("syncPresetActivationLine"), true);
  assert.equal(source.includes("imageStudioActivationLineUnchanged"), true);
  assert.equal(source.includes("CavAi is using the full preset behind the scenes."), true);
  assert.equal(source.includes("The text shown in the box is only a visible activation line."), true);
});

test("server ignores unchanged activation lines as authoritative prompt content", () => {
  const source = read("src/lib/ai/ai.service.ts");

  assert.equal(source.includes("resolveImageStudioPromptInput"), true);
  assert.equal(source.includes("activationLineUnchanged"), true);
  assert.equal(source.includes("if (promptText && !activationLineUnchanged)"), true);
  assert.equal(source.includes("userPrompt: imagePromptResolution.effectivePrompt"), true);
  assert.equal(source.includes("prompt: imagePromptResolution.customInstruction || \"\""), true);
  assert.equal(source.includes("sourcePrompt: imagePromptResolution.customInstruction || null"), true);
});
