import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("profile README route probes storage readiness and gates runtime bootstrap to non-production", () => {
  const route = read("app/api/profile/readme/route.ts");

  assert.equal(route.includes("ALLOW_RUNTIME_STORAGE_BOOTSTRAP = process.env.NODE_ENV !== \"production\""), true);
  assert.equal(route.includes("async function probeStorageReady"), true);
  assert.equal(route.includes("SELECT \"revision\""), true);
  assert.equal(route.includes("async function ensureStorageReady"), true);
  assert.equal(route.includes("README_STORAGE_UNAVAILABLE"), true);
  assert.equal(route.includes("\"Retry-After\": \"15\""), true);
});

test("CavCode README autosave backs off when storage is unavailable", () => {
  const source = read("app/cavcode/page.tsx");

  assert.equal(source.includes("PROFILE_README_SAVE_RETRY_MS = 15_000"), true);
  assert.equal(source.includes("unavailableUntil"), true);
  assert.equal(source.includes("lastUnavailableMessage"), true);
  assert.equal(source.includes("kind: \"retryable\""), true);
  assert.equal(source.includes("README_STORAGE_UNAVAILABLE"), true);
});

test("public profile owner draft sync backs off on README storage failures", () => {
  const source = read("app/u/[username]/page.tsx");

  assert.equal(source.includes("README_SAVE_RETRY_MS = 15000"), true);
  assert.equal(source.includes("readmeSaveUnavailableUntil"), true);
  assert.equal(source.includes("README_STORAGE_UNAVAILABLE"), true);
});
