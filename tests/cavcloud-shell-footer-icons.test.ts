import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcloud footer mirrors the app shell quick-tool set", () => {
  const controls = read("components/cavcloud/CavSurfaceShellControls.tsx");
  const client = read("app/cavcloud/CavCloudClient.tsx");

  assert.match(controls, /className="cb-icon-btn cb-icon-btn-arcade cavcloud-surfaceQuickTool"/);
  assert.match(controls, /href="https:\/\/cavbot\.io\/help-center"/);
  assert.match(controls, /<IconGear \/>/);
  assert.doesNotMatch(controls, /galleryActive|onOpenGallery|onOpenCompanion|companionLabel/);
  assert.match(client, /onOpenArcade: openArcade/);
});
