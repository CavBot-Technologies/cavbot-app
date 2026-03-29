import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("composer attachments open uploaded images in an in-app viewer overlay", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("const [composerImageViewer, setComposerImageViewer] = useState<ComposerImageViewerState | null>(null);"), true);
  assert.equal(source.includes("const closeComposerImageViewer = useCallback(() => {"), true);
  assert.equal(source.includes("const openComposerImageViewer = useCallback((image: CavAiImageAttachment) => {"), true);
  assert.equal(source.includes("styles.centerAttachmentPreviewBtn"), true);
  assert.equal(source.includes("styles.centerAttachmentPreviewBtnDisabled"), true);
  assert.equal(source.includes("onClick={() => openComposerImageViewer(image)}"), true);
  assert.equal(source.includes("className={styles.centerImageViewerOverlay}"), true);
  assert.equal(source.includes("formatFileSize(activeComposerImageViewer.sizeBytes)"), true);
  assert.equal(source.includes("formatMimeSubtype(activeComposerImageViewer.mimeType)"), true);
  assert.equal(source.includes("Open in new tab"), false);
  assert.equal(source.includes("const showComposerViewerNavigation = composerViewerImages.length > 1 && composerViewerActiveIndex >= 0;"), true);
  assert.equal(source.includes("openComposerImageViewerPrev"), true);
  assert.equal(source.includes("openComposerImageViewerNext"), true);
  assert.equal(source.includes("styles.centerImageViewerNavBtn"), true);
});

test("attachment action icon toggles create/edit mode by plan and active image mode", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("const attachmentModeToggleKind = useMemo<\"create\" | \"edit\" | null>(() => {"), true);
  assert.equal(source.includes("if (accountPlanId === \"premium_plus\") {"), true);
  assert.equal(source.includes("if (editModeActive) return \"create\";"), true);
  assert.equal(source.includes("return \"edit\";"), true);
  assert.equal(source.includes("if (accountPlanId === \"premium\") {"), true);
  assert.equal(source.includes("if (createModeActive) return null;"), true);
  assert.equal(source.includes("return \"create\";"), true);
  assert.equal(source.includes("onAttachmentModeToggle(image, attachmentModeToggleKind)"), true);
  assert.equal(source.includes("styles.centerWebResearchGlyphEditImage"), true);
  assert.equal(source.includes("styles.centerWebResearchGlyphCreateImage"), true);
  assert.equal(source.includes("!image.uploading ? ("), true);
  assert.equal(source.includes("const showComposerAttachmentChips = showComposerImageChips || showComposerFileChips;"), true);
});

test("attachment and viewer styling classes are present", () => {
  const css = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(css.includes(".centerAttachmentPreviewBtn"), true);
  assert.equal(css.includes(".centerAttachmentPreviewBtnDisabled"), true);
  assert.equal(css.includes(".centerAttachmentActions"), true);
  assert.equal(css.includes(".centerAttachmentActionBtn"), true);
  assert.equal(css.includes(".centerAttachmentModeToggleGlyph"), true);
  assert.equal(css.includes(".centerImageViewerOverlay"), true);
  assert.equal(css.includes(".centerImageViewer"), true);
  assert.equal(css.includes(".centerImageViewerMedia"), true);
  assert.equal(css.includes(".centerImageViewerNavBtn"), true);
});
