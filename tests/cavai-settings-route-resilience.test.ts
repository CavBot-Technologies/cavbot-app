import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavai settings route parallelizes registry and publication hydration", () => {
  const source = read("app/api/cavai/settings/route.ts");

  assert.match(source, /buildFallbackAgentRegistryUiSnapshot/);
  assert.match(source, /listPublishedOperatorAgents/);
  assert.match(source, /listOwnedPublishedOperatorSourceAgentIds/);
  assert.match(source, /publishedAgents,\s*ownedPublishedSourceAgentIds/);
  assert.match(source, /degraded \? \{ \.\.\.baseResponse, degraded: true \} : baseResponse/);
});

test("cavai schema bootstraps are guarded by single-flight promises", () => {
  const settingsSource = read("lib/cavai/cavenSettings.server.ts");
  const registrySource = read("lib/cavai/agentRegistry.server.ts");
  const operatorSource = read("lib/cavai/operatorAgents.server.ts");

  assert.match(settingsSource, /let tableReadyPromise: Promise<void> \| null = null;/);
  assert.match(registrySource, /let tableReadyPromise: Promise<void> \| null = null;/);
  assert.match(operatorSource, /let tablesReady = false;/);
  assert.match(operatorSource, /async function ensureOperatorAgentTables\(\)/);
  assert.match(operatorSource, /CREATE TABLE IF NOT EXISTS "OperatorPublishedAgent"/);
  assert.match(operatorSource, /CREATE TABLE IF NOT EXISTS "OperatorAgentPublicationQueue"/);
});

test("agent registry sync skips duplicate work for identical state", () => {
  const source = read("lib/cavai/agentRegistry.server.ts");

  assert.match(source, /const registrySyncFingerprintByScope = new Map<string, string>\(\);/);
  assert.match(source, /const registrySyncPromiseByScope = new Map<string, Promise<void>>\(\);/);
  assert.match(source, /if \(registrySyncFingerprintByScope\.get\(scopeKey\) === fingerprint\) return;/);
});
