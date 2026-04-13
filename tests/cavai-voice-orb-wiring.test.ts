import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("CavAi voice orb uses Three.js shader geometry and both voice surfaces mount it", () => {
  const pkg = read("package.json");
  const orb = read("components/cavai/CavAiVoiceOrb.tsx");
  const center = read("components/cavai/CavAiCenterWorkspace.tsx");
  const code = read("components/cavai/CavAiCodeWorkspace.tsx");

  assert.match(pkg, /"three": "\^[^"]+"/);

  assert.match(orb, /new THREE\.IcosahedronGeometry\(1, 64\)/);
  assert.match(orb, /new THREE\.ShaderMaterial\(/);
  assert.match(orb, /new THREE\.PointLight\(/);
  assert.match(orb, /function readRms\(analyser: AnalyserNode, data: Uint8Array\)/);

  assert.match(center, /import CavAiVoiceOrb, \{ type CavAiVoiceOrbMode \} from "@\/components\/cavai\/CavAiVoiceOrb";/);
  assert.match(center, /setVoiceOrbState\("listening"\);/);
  assert.match(center, /setVoiceOrbState\("processing"\);/);
  assert.match(center, /setVoiceOrbState\("speaking"\);/);
  assert.match(center, /<CavAiVoiceOrb[\s\S]*placement=\{isEmptyThread \? "center" : "bottom"\}/);

  assert.match(code, /import CavAiVoiceOrb, \{ type CavAiVoiceOrbMode \} from "@\/components\/cavai\/CavAiVoiceOrb";/);
  assert.match(code, /setVoiceOrbState\("listening"\);/);
  assert.match(code, /setVoiceOrbState\("processing"\);/);
  assert.match(code, /<CavAiVoiceOrb[\s\S]*placement=\{voiceOrbHasConversation \? "bottom" : "center"\}/);
});
