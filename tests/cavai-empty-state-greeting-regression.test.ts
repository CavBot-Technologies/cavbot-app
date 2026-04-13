import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("CavAi overlay empty state uses refined greeting treatment", () => {
  const center = read("components/cavai/CavAiCenterWorkspace.tsx");
  const css = read("components/cavai/CavAiWorkspace.module.css");

  assert.match(center, /const overlayEmptyHeadline = "Hi there";/);
  assert.match(center, /const overlayEmptySubline = "How can I assist you\?";/);
  assert.match(center, /overlay \? styles\.centerEmptyStateOverlay : ""/);
  assert.match(center, /styles\.centerEmptyTitleOverlayLead/);
  assert.match(center, /styles\.centerEmptyTextOverlayPrompt/);
  assert.match(center, /styles\.centerEmptyTextOverlayCursor/);

  assert.match(css, /\.centerEmptyStateOverlay \{/);
  assert.match(css, /\.centerEmptyTitleOverlayLead \{/);
  assert.match(css, /\.centerEmptyTextOverlayPrompt \{/);
  assert.match(css, /\.centerEmptyTextOverlayCursor \{/);
  assert.match(css, /@keyframes centerEmptyGreetingReveal/);
  assert.match(css, /@keyframes centerEmptyGreetingCursor/);
});
