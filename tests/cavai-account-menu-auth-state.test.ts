import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("center workspace restores the signed-out footer account state and reopens the desktop auth dock", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes('const guestAccountNameLabel = "CavBot Operator";'), true);
  assert.equal(source.includes('const guestAccountPromptLabel = "Log in or create an account";'), true);
  assert.equal(source.includes("const showDesktopGuestAuthPanel = !overlay && !isPhoneLayout && isGuestPreviewMode && accountMenuOpen;"), true);
  assert.equal(source.includes("aria-label={guestAccountLabel}"), true);
  assert.equal(source.includes("title={guestAccountLabel}"), true);
  assert.equal(source.includes("<span className={styles.centerSidebarAccountName}>{guestAccountNameLabel}</span>"), true);
  assert.equal(source.includes("<span className={styles.centerSidebarAccountPlan}>{guestAccountPromptLabel}</span>"), true);
  assert.equal(source.includes("const renderGuestAuthPanel = (opts?: { docked?: boolean }) => ("), true);
  assert.equal(source.includes("{accountMenuOpen && isPhoneLayout ? renderGuestAuthPanel() : null}"), true);
  assert.equal(source.includes("{showDesktopGuestAuthPanel ? renderGuestAuthPanel({ docked: true }) : null}"), true);
});

test("center workspace treats system or incomplete auth payloads as signed out", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("const confirmedAuthenticatedUserRef = useRef(false);"), true);
  assert.match(source, /const systemRole = s\(body\.session\?\.systemRole\)\.toLowerCase\(\);/);
  assert.match(source, /const hasUserPayload = Boolean\(body\.user && typeof body\.user === "object"\);/);
  assert.match(source, /body\.authenticated === true && \(systemRole === "system" \|\| !hasUserPayload\)/);
  assert.match(source, /if \(!confirmedAuthenticatedUserRef\.current\) \{\s*applyUnauthenticatedCenterState\(\);/);
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

test("center workspace styles the signed-out auth panel as a desktop right-side dock", () => {
  const source = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(source.includes(".centerMainWithGuestAuth {\n  padding-right: clamp(344px, 31vw, 430px);\n}"), true);
  assert.equal(source.includes(".centerGuestAuthPanelDocked {\n  position: absolute;"), true);
  assert.equal(source.includes("top: calc(56px + 16px);"), true);
  assert.equal(source.includes("width: min(392px, calc(100% - 32px));"), true);
});
