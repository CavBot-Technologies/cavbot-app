import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("voice controls split dictate from speak and keep microphone permission enabled for first-party pages", () => {
  const nextConfig = read("next.config.mjs");
  const orb = read("components/cavai/CavAiVoiceOrb.tsx");
  const center = read("components/cavai/CavAiCenterWorkspace.tsx");
  const code = read("components/cavai/CavAiCodeWorkspace.tsx");
  const css = read("components/cavai/CavAiWorkspace.module.css");

  assert.match(nextConfig, /Permissions-Policy", value: "camera=\(\), microphone=\(self\), geolocation=\(\), payment=\(self\)"/);

  assert.doesNotMatch(orb, /new THREE\.Clock\(/);
  assert.match(orb, /const startedAt = window\.performance\.now\(\);/);

  assert.match(center, /type VoiceCaptureIntent = "dictate" \| "speak";/);
  assert.match(center, /void startVoiceCapture\("dictate"\);/);
  assert.match(center, /void startVoiceCapture\("speak"\);/);
  assert.match(center, /title=\{dictateCaptureActive \? "Stop Dictate" : "Dictate"\}/);
  assert.match(center, /: "Speak"/);

  assert.match(code, /type VoiceCaptureIntent = "dictate" \| "speak";/);
  assert.match(code, /void startVoiceCapture\("dictate"\);/);
  assert.match(code, /void startVoiceCapture\("speak"\);/);
  assert.match(code, /title=\{dictateCaptureActive \? "Stop Dictate" : "Dictate"\}/);
  assert.match(code, /: "Speak"/);

  assert.doesNotMatch(center, /prev === "audio_model"/);
  assert.doesNotMatch(code, /prev === "audio_model"/);

  assert.match(css, /\.voiceStatusBar \{/);
  assert.match(css, /\.voiceStatusLabel \{/);
  assert.match(css, /@keyframes voiceStatusPulse/);
});
