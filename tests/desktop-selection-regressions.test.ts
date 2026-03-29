import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const cavCloudSource = read("app/cavcloud/CavCloudClient.tsx");
const cavSafeSource = read("app/cavsafe/CavSafeClient.tsx");
const cavPadSource = read("components/CavPad.tsx");

test("CavCloud and CavSafe use shared desktop selection policy and background clear guard", () => {
  assert.match(cavCloudSource, /selectDesktopItemMap\(a, l, e, t\)/);
  assert.match(cavSafeSource, /selectDesktopItemMap\(a, l, e, t\)/);
  assert.match(cavCloudSource, /shouldClearDesktopSelectionFromTarget/);
  assert.match(cavSafeSource, /shouldClearDesktopSelectionFromTarget/);
  assert.match(cavCloudSource, /window\.addEventListener\("mousedown", e, !0\)/);
  assert.match(cavSafeSource, /window\.addEventListener\("mousedown", e, !0\)/);
  assert.match(cavCloudSource, /\.cavcloud-trashMenuWrap/);
  assert.match(cavSafeSource, /\.cavcloud-trashMenuWrap/);
});

test("CavCloud and CavSafe selectable cards are explicitly marked and single-click gated", () => {
  const cloudSelectableCount = (cavCloudSource.match(/"data-desktop-select-item": "true"/g) || []).length;
  const safeSelectableCount = (cavSafeSource.match(/"data-desktop-select-item": "true"/g) || []).length;

  assert.ok(cloudSelectableCount >= 6, "CavCloud should mark every selectable file/folder card.");
  assert.ok(safeSelectableCount >= 6, "CavSafe should mark every selectable file/folder card.");
  assert.match(cavCloudSource, /if \(a\.detail > 1\) return;/);
  assert.match(cavSafeSource, /if \(i\.detail > 1\) return;/);
  assert.match(cavCloudSource, /onDoubleClick: \(\) => void s5\(e, !1\)/);
  assert.match(cavSafeSource, /onDoubleClick: \(\) => void s5\(e, !1\)/);
});

test("CavPad selection handlers are desktop-style no-op-on-same and click-away clear", () => {
  assert.match(cavPadSource, /selectDesktopItemArray/);
  assert.equal(cavPadSource.includes("prev.filter((id) => id !== noteId)"), false);
  assert.equal(cavPadSource.includes("prev.filter((id) => id !== folderId)"), false);
  assert.match(cavPadSource, /shouldClearDesktopSelectionFromTarget/);
  assert.match(cavPadSource, /\[data-cavpad-note-menu-wrap='true'\]/);
  assert.match(cavPadSource, /\[data-cavpad-directory-menu-wrap='true'\]/);
  assert.match(cavPadSource, /\[data-cavpad-trash-menu-wrap='true'\]/);
  assert.match(cavPadSource, /window\.addEventListener\("mousedown", onPointerDown, true\)/);
});

test("CavPad cards and action menus carry explicit selection and preserve markers", () => {
  const cavPadItemMarkers = (cavPadSource.match(/data-desktop-select-item="true"/g) || []).length;
  const cavPadPreserveMarkers = (cavPadSource.match(/data-desktop-select-preserve="true"/g) || []).length;

  assert.ok(cavPadItemMarkers >= 4, "CavPad must mark library/directories/trash selectable items.");
  assert.ok(cavPadPreserveMarkers >= 3, "CavPad action menu wrappers must preserve selection.");
  assert.match(cavPadSource, /if \(event\.detail > 1\) return;/);
  assert.match(cavPadSource, /onDoubleClick=\{\(\) => openDirectory\(folder\.id\)\}/);
  assert.match(cavPadSource, /onDoubleClick=\{\(\) => openDirectoryNote\(note\.id\)\}/);
});
