import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("CavAi Center only falls back to guest mode after explicit auth denial", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("const shouldApplyGuestFallback = isAuthRequiredLikeResponse(res.status, body)"), true);
  assert.equal(source.includes("|| (res.ok && body.ok === true && body.authenticated === false)"), true);
  assert.equal(source.includes("|| (res.ok && body.ok === true && body.authenticated === true && (systemRole === \"system\" || !hasUserPayload || !aiReady));"), true);
  assert.equal(source.includes("Keep account history visible until the backend explicitly proves the viewer is signed out."), true);
  assert.equal(source.includes("A transient auth probe failure should not dump the user into guest preview and blank history."), true);
});

test("CavAi Center surfaces generic history load failures without wiping cached history", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("const message = err instanceof Error ? err.message : CENTER_LOAD_SESSIONS_FAILED_MESSAGE;"), true);
  assert.equal(source.includes("const message = err instanceof Error ? err.message : CENTER_LOAD_MESSAGES_FAILED_MESSAGE;"), true);
  assert.equal(source.includes("Keep stale cache visible when background refresh fails, but surface the retryable failure."), true);
  assert.equal(source.includes("const showInlineError = Boolean(error);"), true);
});
