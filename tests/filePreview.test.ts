import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSnippetForThumbnail,
  getExtensionLabel,
  isTextLikeFile,
  normalizePreviewSnippetText,
} from "@/lib/filePreview";

test("getExtensionLabel formats extension and falls back correctly", () => {
  assert.equal(getExtensionLabel("notes.txt", null), "TXT");
  assert.equal(getExtensionLabel("config.env", null), "ENV");
  assert.equal(getExtensionLabel(".env.local", null), "ENV");
  assert.equal(getExtensionLabel("README", "text/plain"), "TXT");
  assert.equal(getExtensionLabel("blob", "application/octet-stream"), "FILE");
});

test("isTextLikeFile handles extension and mime fallbacks", () => {
  assert.equal(isTextLikeFile("file.ts", ""), true);
  assert.equal(isTextLikeFile("README", "text/markdown"), true);
  assert.equal(isTextLikeFile("archive.bin", "application/octet-stream"), false);
});

test("normalizePreviewSnippetText normalizes newlines, strips nulls, and truncates", () => {
  const input = "line1\r\nline2\rline3\u0000line4";
  assert.equal(normalizePreviewSnippetText(input, 12), "line1\nline2\n");
  assert.equal(normalizePreviewSnippetText("", 12), null);
});

test("formatSnippetForThumbnail enforces line and char caps", () => {
  const snippet = ["a1", "a2", "a3", "a4", "a5"].join("\n");
  assert.equal(
    formatSnippetForThumbnail(snippet, { maxChars: 100, maxLines: 3 }),
    ["a1", "a2", "a3"].join("\n"),
  );
  assert.equal(formatSnippetForThumbnail("abcdef", { maxChars: 4, maxLines: 4 }), "abcd");
});
