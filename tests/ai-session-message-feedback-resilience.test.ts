import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("session history hydration treats feedback metadata as best-effort", () => {
  const source = read("src/lib/ai/ai.memory.ts");

  assert.match(source, /function isAiMessageFeedbackSchemaMismatch\(error: unknown\)/);
  assert.match(source, /tables: \["CavAiMessageFeedback"\]/);
  assert.match(source, /try \{\s*const feedbackRows = \(/);
  assert.match(source, /Feedback is optional session metadata\./);
  assert.match(source, /if \(!isAiMessageFeedbackSchemaMismatch\(error\) && process\.env\.NODE_ENV !== "production"\) \{/);
  assert.match(source, /\[cavai\] session feedback hydration failed/);
});
