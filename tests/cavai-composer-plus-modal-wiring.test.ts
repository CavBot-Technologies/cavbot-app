import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("center composer plus icon opens compact quick-action menu with required CTAs", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("prev === \"quick_actions\" ? null : \"quick_actions\""), true);
  assert.equal(source.includes("openComposerMenu === \"quick_actions\""), true);
  assert.equal(source.includes("ariaLabel: \"Quick actions\""), true);
  assert.equal(source.includes("Add photos & files"), true);
  assert.equal(source.includes("Recent files"), true);
  assert.equal(source.includes("Create image"), true);
  assert.equal(source.includes("Edit image"), true);
  assert.equal(source.includes("Deep Research"), true);
  assert.equal(source.includes("setQuickActionModalOpen"), false);
  assert.equal(source.includes("<LockIcon width={12} height={12} aria-hidden=\"true\" />"), true);
  assert.equal(
    source.includes("if (option.id === ALIBABA_QWEN_IMAGE_MODEL_ID || option.id === ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID) continue;"),
    true
  );
});

test("center composer quick actions render compact mode toggles with compact agent-mode popover", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");
  const cssSource = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(source.includes("activeToolbarQuickMode ? ("), true);
  assert.equal(source.includes("clearActiveToolbarQuickMode"), true);
  assert.equal(source.includes("centerComposerModeBox"), false);
  assert.equal(source.includes("openComposerMenu === \"agent_mode\""), true);
  assert.equal(source.includes("toggleAgentModeMenu"), true);
  assert.equal(source.includes("selectAgentModeOption"), true);
  assert.equal(source.includes("toggleAgentInstalled"), true);
  assert.equal(source.includes("openComposerMenu !== \"agent_mode\""), true);
  assert.equal(source.includes("window.visualViewport?.addEventListener(\"resize\", onViewportChange);"), true);
  assert.equal(source.includes("window.visualViewport?.addEventListener(\"scroll\", onViewportChange);"), true);
  assert.equal(source.includes("floatingComposerMenuAnchor?.menu === openComposerMenu"), true);
  assert.equal(source.includes("aria-label=\"Close composer menu\""), true);
  assert.equal(source.includes("document.addEventListener(\"visibilitychange\", onVisibilityChange);"), true);
  assert.equal(source.includes("document.documentElement.style.overflow = \"hidden\";"), true);
  assert.equal(source.includes("document.documentElement.style.overscrollBehaviorY = \"none\";"), true);
  assert.equal(source.includes("document.body.style.position = \"fixed\";"), true);
  assert.equal(source.includes("document.body.style.top = `${-scrollY}px`;"), true);
  assert.equal(source.includes("window.scrollTo(0, scrollY);"), true);
  assert.equal(
    source.includes("const showSignedOutMobileLegal = !overlay && isPhoneLayout && authProbeReady && isGuestPreviewMode && isEmptyThread;"),
    true
  );
  assert.equal(source.includes("Search agents"), true);
  assert.equal(source.includes("Competitor Intelligence"), true);
  assert.equal(source.includes("accessibility_auditor"), true);
  assert.equal(source.includes("Agent Bank"), true);
  assert.equal(source.includes("Locked"), true);
  assert.equal(source.includes("const hasCenterAgentOptions = installedCenterAgents.length > 0;"), true);
  assert.equal(source.includes("const canUseDeepResearch = !isGuestPreviewMode && (accountPlanId === \"premium\" || accountPlanId === \"premium_plus\");"), true);
  assert.equal(source.includes("composerQuickMode === \"create_image\""), true);
  assert.equal(source.includes("composerQuickMode === \"edit_image\""), true);
  assert.equal(source.includes("selectedModel === ALIBABA_QWEN_CHARACTER_MODEL_ID"), true);
  assert.equal(source.includes("if (activeToolbarQuickMode === \"companion\") return \"CavBot\";"), true);
  assert.equal(source.includes("return canUseEditImage ? \"Describe or edit an image\" : \"Describe an image\";"), true);
  assert.equal(source.includes("return \"Describe or edit an image\";"), true);
  assert.equal(
    source.includes("activeToolbarQuickMode === \"create_image\" || activeToolbarQuickMode === \"edit_image\" ? null : ("),
    true
  );
  assert.equal(source.includes("Talk to CavBot about ideas, strategy, or support."), true);

  assert.equal(cssSource.includes(".centerQuickActionsMenu"), true);
  assert.equal(cssSource.includes(".centerQuickActionMenuItemLocked"), true);
  assert.equal(cssSource.includes(".centerQuickModeToolbarBtn"), true);
  assert.equal(cssSource.includes(".centerWebResearchGlyphCompanion"), true);
  assert.equal(cssSource.includes(".centerAgentModeBtn"), true);
  assert.equal(cssSource.includes(".centerAgentModeMenu"), true);
  assert.equal(cssSource.includes(".centerAgentModeSearch"), true);
  assert.equal(cssSource.includes(".centerAgentModeSearchGlyph"), true);
  assert.equal(cssSource.includes(".centerAgentModeLockedRow"), true);
  assert.equal(cssSource.includes(".centerComposerPresetModePill"), true);
  assert.equal(cssSource.includes("overscroll-behavior-y: contain;"), true);
  assert.equal(cssSource.includes("touch-action: pan-y;"), true);
});
