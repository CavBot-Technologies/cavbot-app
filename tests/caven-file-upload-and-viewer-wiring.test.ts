import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("caven composer supports uploaded workspace files with extension-aware chips", () => {
  const source = read("components/cavai/CavAiCodeWorkspace.tsx");

  assert.equal(source.includes("onUploadWorkspaceFiles?: (files: File[]) => Promise<CavenWorkspaceUploadFileRef[]> | CavenWorkspaceUploadFileRef[];"), true);
  assert.equal(source.includes("const [uploadedFiles, setUploadedFiles] = useState<CavAiUploadedFileAttachment[]>([]);"), true);
  assert.equal(source.includes("if (!onUploadWorkspaceFiles) {"), true);
  assert.equal(source.includes("onUploadWorkspaceFiles(workspaceUploadQueue.map((item) => item.file))"), true);
  assert.equal(source.includes("openUploadedFileAttachment"), true);
  assert.equal(source.includes("styles.attachmentFileChip"), true);
  assert.equal(source.includes("styles.attachmentFileOpenBtn"), true);
});

test("caven composer image preview uses in-app viewer, navigation arrows, and hover magnifier", () => {
  const source = read("components/cavai/CavAiCodeWorkspace.tsx");

  assert.equal(source.includes("const [composerImageViewer, setComposerImageViewer] = useState<ComposerImageViewerState | null>(null);"), true);
  assert.equal(source.includes("const showComposerViewerNavigation = composerViewerImages.length > 1 && composerViewerActiveIndex >= 0;"), true);
  assert.equal(source.includes("className={styles.centerImageViewerOverlay}"), true);
  assert.equal(source.includes("onMouseMove={onComposerViewerMouseMove}"), true);
  assert.equal(source.includes("styles.cavenImageViewerMagnifier"), true);
  assert.equal(source.includes("openComposerImageViewerPrev"), true);
  assert.equal(source.includes("openComposerImageViewerNext"), true);
});

test("caven file upload wiring passes through cavcode workspace integration", () => {
  const cavcodeSource = read("app/cavcode/page.tsx");

  assert.equal(cavcodeSource.includes("const uploadWorkspaceFilesFromCaven = useCallback(async (rawFiles: File[]): Promise<CavenWorkspaceUploadFileRef[]> => {"), true);
  assert.equal(cavcodeSource.includes("onUploadWorkspaceFiles={uploadWorkspaceFilesFromCaven}"), true);
  assert.equal(cavcodeSource.includes("setFS(updated);"), true);
  assert.equal(cavcodeSource.includes("saveCodebaseFileToServer"), true);
  assert.equal(cavcodeSource.includes("hydratedCodebasePathsRef.current.add(targetPath);"), true);
});

test("caven attachment and magnifier styles are present", () => {
  const css = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(css.includes(".attachmentFileChip"), true);
  assert.equal(css.includes(".attachmentFileOpenBtn"), true);
  assert.equal(css.includes(".attachmentFileMeta"), true);
  assert.equal(css.includes(".cavenImageViewerMediaWrap"), true);
  assert.equal(css.includes(".cavenImageViewerMagnifier"), true);
});
