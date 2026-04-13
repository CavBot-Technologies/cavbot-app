import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("passive AI session history routes emit typed unavailable payloads instead of raw 500s", () => {
  const helper = read("src/lib/ai/ai.route-response.ts");
  const sessionsRoute = read("app/api/ai/sessions/route.ts");
  const messagesRoute = read("app/api/ai/sessions/[sessionId]/messages/route.ts");

  assert.match(helper, /export function isPassiveAiReadUnavailableError/);
  assert.match(helper, /export function buildPassiveAiUnavailablePayload/);
  assert.match(helper, /PASSIVE_AI_UNAVAILABLE_CODES = new Set/);

  assert.match(sessionsRoute, /buildPassiveAiUnavailablePayload/);
  assert.match(sessionsRoute, /isPassiveAiReadUnavailableError\(error\)/);
  assert.match(sessionsRoute, /AI_SESSIONS_UNAVAILABLE/);
  assert.match(sessionsRoute, /AI session history is temporarily unavailable\./);

  assert.match(messagesRoute, /buildPassiveAiUnavailablePayload/);
  assert.match(messagesRoute, /isPassiveAiReadUnavailableError\(error\)/);
  assert.match(messagesRoute, /AI_SESSION_MESSAGES_UNAVAILABLE/);
  assert.match(messagesRoute, /AI session messages are temporarily unavailable\./);
});

test("CavAi center keeps cached history and auth state when passive reads or auth refreshes degrade", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.match(source, /const PASSIVE_CENTER_UNAVAILABLE_ERRORS = new Set/);
  assert.match(source, /function isPassiveCenterUnavailablePayload/);
  assert.match(source, /if \(isPassiveCenterUnavailablePayload\(body\)\) return true;/);
  assert.match(source, /if \(isPassiveCenterUnavailablePayload\(body\)\) \{/);
  assert.match(source, /const authIndeterminate = body\.indeterminate === true;/);
  assert.match(source, /if \(authIndeterminate\) \{/);
  assert.match(source, /Preserve the last known auth state on transient backend failures\./);
});
