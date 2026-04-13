import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("CavAi center and code workspaces require aiReady from auth me before enabling protected AI flows", () => {
  const centerSource = read("components/cavai/CavAiCenterWorkspace.tsx");
  const codeSource = read("components/cavai/CavAiCodeWorkspace.tsx");

  assert.match(centerSource, /function readAuthMeAiReady\(payload: unknown, fallbackValue: boolean\)/);
  assert.match(centerSource, /const aiReady = readAuthMeAiReady\(body, systemRole !== "system" && hasUserPayload\);/);
  assert.match(centerSource, /body\.authenticated === true && \(systemRole === "system" \|\| !hasUserPayload \|\| !aiReady\)/);

  assert.match(codeSource, /function readAuthMeAiReady\(payload: unknown, fallbackValue: boolean\)/);
  assert.match(codeSource, /const aiReady = readAuthMeAiReady\(body, systemRole !== "system" && hasUserPayload\);/);
  assert.match(codeSource, /body\.authenticated !== true \|\| systemRole === "system" \|\| !hasUserPayload \|\| !aiReady/);
});
