import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("selecting a chat always triggers message loading in center workspace", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("const onSelectSession = useCallback((nextSessionId: string) => {"), true);
  assert.equal(source.includes("const cachedMessages = sessionMessageCacheRef.current.get(normalized);"), true);
  assert.equal(source.includes("if (overlay) setHistoryOpen(false);"), true);
  assert.equal(source.includes("void loadMessages(normalized);"), true);
});

test("center workspace does not cache an empty thread while message loading is pending", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("if (loadingMessages && !messages.length) return;"), true);
  assert.equal(
    source.includes("}, [loadingMessages, messages, sessionId]);"),
    true
  );
});

test("empty stored sessions synthesize a recoverable thread seed from session summary", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("function buildSyntheticThreadFromSessionSummary(session: CavAiSessionSummary | null): CavAiMessage[] {"), true);
  assert.equal(source.includes("const fallbackRows = buildSyntheticThreadFromSessionSummary(summary);"), true);
  assert.equal(source.includes("const resolvedRows = normalizedRows.length ? normalizedRows : fallbackRows;"), true);
});

test("full-page initial session id syncs into active chat selection", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("const appliedInitialSessionIdRef = useRef<string | null>(null);"), true);
  assert.equal(source.includes("const normalized = s(props.initialSessionId);"), true);
  assert.equal(source.includes("activeSessionIdRef.current = normalized;"), true);
  assert.equal(source.includes("setSessionId(normalized);"), true);
});
