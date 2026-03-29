import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("session management endpoints use neutral guard actions instead of write_note default", () => {
  const routes = [
    "app/api/ai/sessions/route.ts",
    "app/api/ai/sessions/[sessionId]/route.ts",
    "app/api/ai/sessions/[sessionId]/messages/route.ts",
    "app/api/ai/sessions/[sessionId]/messages/[messageId]/feedback/route.ts",
    "app/api/ai/sessions/[sessionId]/share/route.ts",
  ];

  for (const route of routes) {
    const source = read(route);
    assert.equal(source.includes("return \"write_note\""), false);
    assert.equal(source.includes("return \"summarize_posture\""), true);
  }
});
