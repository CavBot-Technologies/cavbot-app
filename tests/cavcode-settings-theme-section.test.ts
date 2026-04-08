import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavcode settings keeps theme in its own section instead of the editor card", () => {
  const page = read("app/cavcode/page.tsx");

  assert.equal(page.includes('useState<"editor" | "theme" | "collaborators">("editor")'), true);
  assert.equal(page.includes("const [settingsHeaderMenuOpen, setSettingsHeaderMenuOpen] = useState(false);"), true);
  assert.equal(page.includes('ref={settingsHeaderMenuRef}'), true);
  assert.equal(page.includes('aria-label="Settings actions"'), true);
  assert.equal(page.includes('aria-label="Settings menu"'), true);
  assert.equal(page.includes('openSettingsSection("theme")'), true);
  assert.equal(page.includes('<span className="cc-side-menuItemLabel">Theme</span>'), true);
  assert.equal(page.includes('<span className="cc-side-menuItemKey">{isMacPlatform ? "⌘K ⌘S" : "Ctrl+K Ctrl+S"}</span>'), true);
  assert.equal(page.includes('<div className="cc-settingsNav">'), false);
  assert.equal(page.includes('{settingsSection === "theme" ? ('), true);
  assert.equal(page.includes('<div className="cc-set-title">Theme</div>'), true);
  assert.equal(page.includes("12 professional CavCode themes. Monaco rendering stays on the same theme pipeline."), true);
});
