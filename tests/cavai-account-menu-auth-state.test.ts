import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("center workspace restores the signed-out footer account state", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes('const guestAccountLabel = "Not logged in";'), true);
  assert.equal(source.includes("aria-label={guestAccountLabel}"), true);
  assert.equal(source.includes("title={guestAccountLabel}"), true);
  assert.equal(source.includes("<span className={styles.centerSidebarActionText}>{guestAccountLabel}</span>"), true);
  assert.equal(source.includes('aria-label="Sign in or create an account"'), true);
});

test("center workspace account menu always resolves to a public or private profile label", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes('if (accountProfilePublicEnabled === null) return "Profile";'), false);
  assert.equal(
    source.includes('const profileMenuLabel = useMemo(() => (accountProfilePublicEnabled ? "Public Profile" : "Private Profile"), [accountProfilePublicEnabled]);'),
    true
  );
});

test("center workspace account menu items keep hover fills without borders", () => {
  const source = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(
    source.includes(".centerHeaderAccountMenuItem {\n  width: 100%;\n  min-height: 34px;\n  border: 0;"),
    true
  );
  assert.equal(source.includes("border-color: rgba(78, 168, 255, 0.35);"), false);
  assert.equal(source.includes("border-color: rgba(255, 120, 120, 0.45);"), false);
  assert.equal(source.includes(".centerHeaderAccountMenuItem:hover {\n  background: rgba(78, 168, 255, 0.06);\n}"), true);
  assert.equal(source.includes(".centerHeaderAccountMenuItemDanger:hover {\n  background: rgba(255, 120, 120, 0.08);\n}"), true);
});
