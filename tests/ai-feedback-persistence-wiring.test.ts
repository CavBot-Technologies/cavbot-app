import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("feedback endpoint accepts all CavAi message actions and persists through ai.memory", () => {
  const routeSource = read("app/api/ai/sessions/[sessionId]/messages/[messageId]/feedback/route.ts");
  const memorySource = read("src/lib/ai/ai.memory.ts");

  assert.equal(routeSource.includes("const FEEDBACK_ACTIONS = new Set<AiMessageFeedbackAction>(["), true);
  assert.equal(routeSource.includes("\"copy\""), true);
  assert.equal(routeSource.includes("\"share\""), true);
  assert.equal(routeSource.includes("\"retry\""), true);
  assert.equal(routeSource.includes("\"like\""), true);
  assert.equal(routeSource.includes("\"dislike\""), true);
  assert.equal(routeSource.includes("\"clear_reaction\""), true);
  assert.equal(routeSource.includes("const feedback = await updateAiMessageFeedback({"), true);

  assert.equal(memorySource.includes("prisma.cavAiMessageFeedback.upsert({"), true);
  assert.equal(memorySource.includes("accountId_messageId_userId"), true);
  assert.equal(memorySource.includes("copyCount: action === \"copy\" ? { increment: 1 } : undefined"), true);
  assert.equal(memorySource.includes("shareCount: action === \"share\" ? { increment: 1 } : undefined"), true);
  assert.equal(memorySource.includes("retryCount: action === \"retry\" ? { increment: 1 } : undefined"), true);
  assert.equal(memorySource.includes("action === \"clear_reaction\""), true);
});

test("center and cavcode surfaces call message feedback endpoint for retry/share/reaction actions", () => {
  const centerSource = read("components/cavai/CavAiCenterWorkspace.tsx");
  const cavcodeSource = read("components/cavai/CavAiCodeWorkspace.tsx");

  const endpoint = "/api/ai/sessions/${encodeURIComponent(activeSessionId)}/messages/${encodeURIComponent(messageId)}/feedback";
  assert.equal(centerSource.includes(endpoint), true);
  assert.equal(cavcodeSource.includes(endpoint), true);

  assert.equal(centerSource.includes("clear_reaction"), true);
  assert.equal(cavcodeSource.includes("clear_reaction"), true);
  assert.equal(centerSource.includes("void runMessageFeedbackAction(item.id, \"retry\");"), true);
  assert.equal(cavcodeSource.includes("void runMessageFeedbackAction(item.id, \"retry\");"), true);
  assert.equal(centerSource.includes("const action = current === reaction ? \"clear_reaction\" : reaction;"), false);
  assert.equal(cavcodeSource.includes("const action = current === reaction ? \"clear_reaction\" : reaction;"), false);
  assert.equal(centerSource.includes("void runMessageFeedbackAction(item.id, reaction);"), true);
  assert.equal(cavcodeSource.includes("void runMessageFeedbackAction(item.id, reaction);"), true);
});

test("reaction feedback keeps like/dislike icons highlighted from persisted reaction state", () => {
  const centerSource = read("components/cavai/CavAiCenterWorkspace.tsx");
  const cavcodeSource = read("components/cavai/CavAiCodeWorkspace.tsx");
  const cssSource = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(cssSource.includes(".centerMessageActionBtnReactionOn"), true);
  assert.equal(cssSource.includes(".centerMessageActionBtnReactionOn:hover"), true);
  assert.equal(centerSource.includes("feedback.reaction === \"like\" ? styles.centerMessageActionBtnReactionOn : \"\""), true);
  assert.equal(centerSource.includes("feedback.reaction === \"dislike\" ? styles.centerMessageActionBtnReactionOn : \"\""), true);
  assert.equal(cavcodeSource.includes("feedback.reaction === \"like\" ? styles.centerMessageActionBtnReactionOn : \"\""), true);
  assert.equal(cavcodeSource.includes("feedback.reaction === \"dislike\" ? styles.centerMessageActionBtnReactionOn : \"\""), true);
});
