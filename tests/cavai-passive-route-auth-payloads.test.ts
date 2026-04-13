import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("passive CavAi GET routes downgrade auth loss into 200 authRequired payloads", () => {
  const helperSource = read("src/lib/ai/ai.route-response.ts");
  assert.match(helperSource, /authRequired: true/);
  assert.match(helperSource, /PASSIVE_AI_AUTH_REQUIRED_CODES/);
  assert.match(helperSource, /SESSION_REVOKED/);
  assert.match(helperSource, /EXPIRED/);

  const aiTestSource = read("app/api/ai/test/route.ts");
  assert.match(aiTestSource, /isPassiveAiAuthRequiredError/);
  assert.match(aiTestSource, /buildPassiveAiAuthRequiredPayload/);
  assert.match(aiTestSource, /return json\(buildPassiveAiAuthRequiredPayload\(readPassiveAiAuthErrorCode\(error\)\), 200\);/);

  const sessionsSource = read("app/api/ai/sessions/route.ts");
  assert.match(sessionsSource, /isPassiveAiAuthRequiredError/);
  assert.match(sessionsSource, /return json\(buildPassiveAiAuthRequiredPayload\(readPassiveAiAuthErrorCode\(error\)\), 200\);/);

  const messagesSource = read("app/api/ai/sessions/[sessionId]/messages/route.ts");
  assert.match(messagesSource, /isPassiveAiAuthRequiredError/);
  assert.match(messagesSource, /return json\(buildPassiveAiAuthRequiredPayload\(readPassiveAiAuthErrorCode\(error\)\), 200\);/);

  const bootstrapSource = read("app/api/cavai/image-studio/bootstrap/route.ts");
  assert.match(bootstrapSource, /isPassiveAiAuthRequiredError/);
  assert.match(bootstrapSource, /return jsonNoStore\(buildPassiveAiAuthRequiredPayload\(readPassiveAiAuthErrorCode\(err\)\), 200\);/);

  const historySource = read("app/api/cavai/image-studio/history/route.ts");
  assert.match(historySource, /isPassiveAiAuthRequiredError/);
  assert.match(historySource, /return jsonNoStore\(buildPassiveAiAuthRequiredPayload\(readPassiveAiAuthErrorCode\(err\)\), 200\);/);

  const settingsSource = read("app/api/cavai/settings/route.ts");
  assert.match(settingsSource, /isPassiveAiAuthRequiredError/);
  assert.match(settingsSource, /return jsonNoStore\(buildPassiveAiAuthRequiredPayload\(readPassiveAiAuthErrorCode\(err\)\), 200\);/);
});
