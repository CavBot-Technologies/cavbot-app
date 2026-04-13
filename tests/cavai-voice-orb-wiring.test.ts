import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("CavAi voice orb uses the SVG sphere asset and both voice surfaces mount it", () => {
  const orb = read("components/cavai/CavAiVoiceOrb.tsx");
  const orbCss = read("components/cavai/CavAiVoiceOrb.module.css");
  const center = read("components/cavai/CavAiCenterWorkspace.tsx");
  const code = read("components/cavai/CavAiCodeWorkspace.tsx");
  const svg = read("public/icons/app/cavai-sphere.svg");

  assert.doesNotMatch(orb, /from "three"/);
  assert.match(orb, /import styles from "@\/components\/cavai\/CavAiVoiceOrb\.module\.css";/);
  assert.match(orb, /const startedAt = window\.performance\.now\(\);/);
  assert.match(orb, /function readRms\(analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>\)/);
  assert.match(orbCss, /mask-image: url\("\/icons\/app\/cavai-sphere\.svg"\)/);
  assert.match(orbCss, /@keyframes orbDrift/);
  assert.match(orbCss, /@keyframes orbSweep/);
  assert.match(svg, /clip-path="url\(#sphere-clip\)"/);

  assert.match(center, /import CavAiVoiceOrb, \{ type CavAiVoiceOrbMode \} from "@\/components\/cavai\/CavAiVoiceOrb";/);
  assert.match(center, /const showOverlayGreeting = !\(overlay && isEmptyThread && showVoiceOrb\);/);
  assert.match(center, /setVoiceOrbState\("listening"\);/);
  assert.match(center, /setVoiceOrbState\("processing"\);/);
  assert.match(center, /setVoiceOrbState\("speaking"\);/);
  assert.match(center, /<CavAiVoiceOrb[\s\S]*placement=\{isEmptyThread \? "center" : "bottom"\}/);

  assert.match(code, /import CavAiVoiceOrb, \{ type CavAiVoiceOrbMode \} from "@\/components\/cavai\/CavAiVoiceOrb";/);
  assert.match(code, /setVoiceOrbState\("listening"\);/);
  assert.match(code, /setVoiceOrbState\("processing"\);/);
  assert.match(code, /<CavAiVoiceOrb[\s\S]*placement=\{voiceOrbHasConversation \? "bottom" : "center"\}/);
});
