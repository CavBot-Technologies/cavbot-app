import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("center workspace no longer boots session state from localStorage during render", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("const initialSessionCacheSnapshot = useMemo("), false);
  assert.equal(source.includes("const initialSessionCacheMessageMap = useMemo(() => {"), false);
  assert.equal(source.includes("useState<CavAiSessionSummary[]>(initialSessionCacheSnapshot?.sessions || [])"), false);
  assert.equal(source.includes("useState<CavAiMessage[]>(initialMessages)"), false);
  assert.equal(source.includes("const [sessions, setSessions] = useState<CavAiSessionSummary[]>([]);"), true);
  assert.equal(source.includes("const [messages, setMessages] = useState<CavAiMessage[]>([]);"), true);
});

test("center workspace hydrates boot identity and guest cache only after mount", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("useLayoutEffect(() => {\n    const boot = readBootClientPlanBootstrap();"), true);
  assert.equal(source.includes("const snapshot = readCenterSessionCacheSnapshot(sessionScopeKey);"), true);
  assert.equal(source.includes("if (!isGuestPreviewMode) return;"), true);
});

test("center workspace clears stale sessions instead of surfacing broken message/delete state", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("function isSessionUnavailableLikeResponse(status: number, payload: unknown) {"), true);
  assert.equal(source.includes("const clearUnavailableSession = useCallback((staleSessionId: string) => {"), true);
  assert.equal(source.includes("if (isSessionUnavailableLikeResponse(res.status, body)) {\n          clearUnavailableSession(normalized);\n          return [];\n        }"), true);
  assert.equal(source.includes("if (isSessionUnavailableLikeResponse(res.status, body)) {\n          clearUnavailableSession(doomedSessionId);\n          closeSessionActionModal();\n          return;\n        }"), true);
});

test("session rename/delete normalize stale row races into SESSION_NOT_FOUND instead of leaking 500s", () => {
  const source = read("src/lib/ai/ai.memory.ts");

  assert.equal(source.includes("const result = await prisma.cavAiSession.updateMany({"), true);
  assert.equal(source.includes("const result = await prisma.cavAiSession.deleteMany({"), true);
  assert.equal(source.includes('throw new AiServiceError("SESSION_NOT_FOUND", "AI session was not found for this account scope.", 404);'), true);
});
