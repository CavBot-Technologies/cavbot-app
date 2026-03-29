import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("center inline edit opens without rewind/truncate side effects", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("const onEditMessage = useCallback(\n    (item: CavAiMessage) => {"), true);
  assert.equal(source.includes("setInlineEditDraft(retryDraft);"), true);
  assert.equal(source.includes("setInlineEditPrompt(retryDraft.prompt);"), true);
  assert.equal(source.includes("slice(0, optimisticIndex)"), false);
  assert.equal(source.includes("const rewindRes = await fetch("), true);
});

test("center inline edit submit anchors pending reasoning under edited message", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("const hasInlineEditPending = submitting && Boolean(s(inlineEditPendingAnchorId));"), true);
  assert.equal(source.includes("setInlineEditPendingAnchorId(targetUserMessageId);"), true);
  assert.equal(source.includes("showPendingPrompt: false,"), true);
  assert.equal(source.includes("const showInlineEditPendingAfterMessage = hasInlineEditPending && inlineEditPendingAnchorId === item.id;"), true);
  assert.equal(source.includes("{hasPendingPrompt && !hasInlineEditPending ? ("), true);
});

test("code inline edit opens without rewind/truncate side effects", () => {
  const source = read("components/cavai/CavAiCodeWorkspace.tsx");

  assert.equal(source.includes("const onEditMessage = useCallback(\n    (item: CavAiMessage) => {"), true);
  assert.equal(source.includes("setInlineEditDraft(retryDraft);"), true);
  assert.equal(source.includes("setInlineEditPrompt(retryDraft.prompt);"), true);
  assert.equal(source.includes("mode: \"rewind\""), false);
  assert.equal(source.includes("slice(0, optimisticIndex)"), false);
});
