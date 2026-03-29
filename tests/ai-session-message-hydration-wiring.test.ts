import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("session message hydration queries by sessionId after ownership check", () => {
  const source = read("src/lib/ai/ai.memory.ts");

  assert.equal(source.includes("await getAiSessionForAccount({"), true);
  assert.equal(source.includes("// Query by sessionId so legacy rows with drifted message.accountId still hydrate history."), true);
  assert.equal(source.includes("where: {\n      sessionId,\n    },"), true);
});

test("session rewind also queries/deletes by verified sessionId scope", () => {
  const source = read("src/lib/ai/ai.memory.ts");

  assert.equal(source.includes("// Query by sessionId so rewind works even when legacy message.accountId drifted."), true);
  assert.equal(source.includes("await tx.cavAiMessage.deleteMany({\n        where: {\n          sessionId,\n          id: { in: deleteIds },\n        },\n      });"), true);
});
