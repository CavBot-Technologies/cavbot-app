import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const cavPadSource = readFileSync(path.join(process.cwd(), "components/CavPad.tsx"), "utf8");
const cavPadCss = readFileSync(path.join(process.cwd(), "components/cavpad.css"), "utf8");

test("CavPad keeps cavpad/notes/directories/trash/settings in one modal shell", () => {
  const modalCount = (cavPadSource.match(/className="cb-home-modal cb-cavpad-modal"/g) || []).length;
  assert.equal(modalCount, 1, "CavPad should render exactly one top-level modal shell");
  assert.match(
    cavPadSource,
    /type\s+CavPadView\s*=\s*"cavpad"\s*\|\s*"notes"\s*\|\s*"directories"\s*\|\s*"trash"\s*\|\s*"settings"\s*\|\s*"details"/,
  );
  assert.ok(!cavPadSource.includes("cb-cavpad-directories-modal"), "Directories must not render as a second modal");
  assert.ok(cavPadSource.includes("setView(\"cavpad\")"), "CavPad editor must switch by view state");
  assert.ok(cavPadSource.includes("setView(\"notes\")"), "Notes library must switch by view state");
  assert.ok(cavPadSource.includes("setView(\"directories\")"), "Directories must switch view state");
  assert.ok(cavPadSource.includes("setView(\"trash\")"), "Trash must switch view state");
  assert.ok(cavPadSource.includes("setView(\"settings\")"), "Settings must switch view state");
});

test("CavPad shell dimensions are unified to one panel selector", () => {
  assert.ok(cavPadCss.includes(".cb-cavpad-modal .cb-home-modal-panel.wide"));
  assert.ok(cavPadCss.includes("height: calc(100dvh - 36px);"));
  assert.ok(!cavPadCss.includes(".cb-cavpad-directories-modal .cb-home-modal-panel"));
  assert.ok(cavPadCss.includes(".cb-notes-grid[data-fullscreen=\"1\"]"));
});

test("CavPad destructive confirmations stay in branded modal UI", () => {
  assert.ok(!cavPadSource.includes("window.confirm("), "CavPad should not use browser confirm dialogs.");
  assert.ok(cavPadSource.includes("cb-cavpad-action-confirm-title"), "CavPad should render its branded confirm modal.");
});
