import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  __getVerifyChallengeSnapshotForTests,
  __resetCavbotVerifyForTests,
  confirmVerifyOtp,
  createVerifyChallenge,
  ensureActionVerification,
  evaluateVerifyRisk,
  recordVerifyActionFailure,
  startVerifyOtp,
  submitVerifyChallenge,
} from "@/lib/auth/cavbotVerify";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

function makeRequest(sessionId: string, ip = "203.0.113.10", userAgent?: string) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: {
      "user-agent":
        userAgent ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "x-forwarded-for": ip,
      "x-cavbot-verify-session": sessionId,
      "accept-language": "en-US,en;q=0.9",
      "sec-ch-ua-platform": "\"macOS\"",
      "x-timezone": "America/New_York",
    },
  });
}

const VALID_GESTURE = {
  pointerDown: true,
  pointerType: "mouse",
  moveEventsCount: 4,
  pointerMoves: 4,
  distancePx: 58,
  durationMs: 620,
  droppedInSlot: true,
};

function requireSnapshot(challengeId: string) {
  const snapshot = __getVerifyChallengeSnapshotForTests(challengeId);
  assert.ok(snapshot);
  if (!snapshot) throw new Error("challenge snapshot missing");
  return snapshot;
}

function solveChallenge(req: Request, challenge: { challengeId: string; nonce: string; sessionId: string }) {
  const snapshot = requireSnapshot(challenge.challengeId);
  assert.ok(snapshot.correctTileId);
  return submitVerifyChallenge(req, {
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    chosenTileId: snapshot.correctTileId,
    gestureSummary: VALID_GESTURE,
    sessionIdHint: challenge.sessionId,
  });
}

test("challenge payload is shape-only and does not leak answers", () => {
  __resetCavbotVerifyForTests();
  const req = makeRequest("sess_payload");
  const challenge = createVerifyChallenge(req, {
    actionType: "signup",
    route: "/auth",
    sessionIdHint: "sess_payload",
  });

  assert.equal(challenge.ok, true);
  if (!challenge.ok) return;

  const serialized = JSON.stringify(challenge);
  assert.equal(serialized.includes("missingGlyphIndex"), false);
  assert.equal(serialized.includes("correctTileId"), false);
  assert.equal(serialized.includes("debugLabel"), false);
  assert.equal(/CavB_t|missing\s+letter|answer\s*[:=]/i.test(serialized), false);

  assert.equal(Array.isArray(challenge.render.wordmarkGlyphs), true);
  assert.equal(challenge.render.wordmarkGlyphs.length, 5);
  assert.equal(Array.isArray(challenge.tiles), true);
  assert.equal(challenge.tiles.length >= 3 && challenge.tiles.length <= 4, true);
});

test("first submit still works when challenge route memory is unavailable", () => {
  __resetCavbotVerifyForTests();
  const req = makeRequest("sess_first_submit");
  const challenge = createVerifyChallenge(req, {
    actionType: "invite",
    route: "/u/test",
    sessionIdHint: "sess_first_submit",
  });

  assert.equal(challenge.ok, true);
  if (!challenge.ok) return;
  assert.ok(challenge.challengeToken);

  const snapshot = requireSnapshot(challenge.challengeId);
  assert.ok(snapshot.correctTileId);

  // Simulate route-runtime memory loss between /challenge and /submit.
  __resetCavbotVerifyForTests();

  const solved = submitVerifyChallenge(req, {
    challengeId: challenge.challengeId,
    challengeToken: challenge.challengeToken,
    nonce: challenge.nonce,
    chosenTileId: snapshot.correctTileId,
    gestureSummary: VALID_GESTURE,
    sessionIdHint: challenge.sessionId,
  });

  assert.equal(solved.ok, true);
});

test("randomization covers all 6 missing glyphs and tile order varies", () => {
  __resetCavbotVerifyForTests();
  const missingIndexes = new Set<number>();
  const tileOrders = new Set<string>();

  for (let i = 0; i < 120; i += 1) {
    const sessionId = `sess_rand_${i}`;
    const req = makeRequest(sessionId, `198.51.100.${(i % 100) + 1}`);
    const challenge = createVerifyChallenge(req, {
      actionType: "login",
      route: "/auth",
      sessionIdHint: sessionId,
    });
    assert.equal(challenge.ok, true);
    if (!challenge.ok) continue;

    const snapshot = requireSnapshot(challenge.challengeId);
    missingIndexes.add(snapshot.missingGlyphIndex);
    tileOrders.add(snapshot.tileGlyphIndexes.join(","));
  }

  assert.equal(missingIndexes.size, 6);
  assert.equal(tileOrders.size > 1, true);
});

test("challenge replay is blocked and grant replay is blocked", () => {
  __resetCavbotVerifyForTests();
  const req = makeRequest("sess_replay");
  const challenge = createVerifyChallenge(req, {
    actionType: "login",
    route: "/auth",
    sessionIdHint: "sess_replay",
  });
  assert.equal(challenge.ok, true);
  if (!challenge.ok) return;

  const solved = solveChallenge(req, challenge);
  assert.equal(solved.ok, true);
  if (!solved.ok) return;

  const replayChallenge = submitVerifyChallenge(req, {
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    chosenTileId: requireSnapshot(challenge.challengeId).correctTileId,
    gestureSummary: VALID_GESTURE,
    sessionIdHint: challenge.sessionId,
  });
  assert.equal(replayChallenge.ok, false);
  assert.equal(replayChallenge.error, "CHALLENGE_ALREADY_SOLVED");

  for (let i = 0; i < 4; i += 1) {
    recordVerifyActionFailure(req, { actionType: "login", sessionIdHint: challenge.sessionId });
  }

  const firstUse = ensureActionVerification(req, {
    actionType: "login",
    route: "/auth",
    sessionIdHint: challenge.sessionId,
    verificationGrantToken: solved.verificationGrantToken,
  });
  assert.equal(firstUse.ok, true);
  assert.equal(firstUse.usedGrant, true);

  const secondUse = ensureActionVerification(req, {
    actionType: "login",
    route: "/auth",
    sessionIdHint: challenge.sessionId,
    verificationGrantToken: solved.verificationGrantToken,
  });
  assert.equal(secondUse.ok, false);
  assert.equal(secondUse.reasonCode, "grant_replayed");
});

test("challenge and grant expirations are enforced", () => {
  __resetCavbotVerifyForTests();
  const req = makeRequest("sess_expiry");
  const challenge = createVerifyChallenge(req, {
    actionType: "reset",
    route: "/users/recovery",
    sessionIdHint: "sess_expiry",
  });
  assert.equal(challenge.ok, true);
  if (!challenge.ok) return;

  const originalNow = Date.now;
  const start = originalNow();

  Date.now = () => start + 95_000;
  try {
    const expiredChallenge = submitVerifyChallenge(req, {
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      chosenTileId: requireSnapshot(challenge.challengeId).correctTileId,
      gestureSummary: VALID_GESTURE,
      sessionIdHint: challenge.sessionId,
    });
    assert.equal(expiredChallenge.ok, false);
    assert.equal(expiredChallenge.error, "CHALLENGE_EXPIRED");
  } finally {
    Date.now = originalNow;
  }

  const fresh = createVerifyChallenge(req, {
    actionType: "reset",
    route: "/users/recovery",
    sessionIdHint: "sess_expiry",
  });
  assert.equal(fresh.ok, true);
  if (!fresh.ok) return;

  const solved = solveChallenge(req, fresh);
  assert.equal(solved.ok, true);
  if (!solved.ok) return;

  for (let i = 0; i < 4; i += 1) {
    recordVerifyActionFailure(req, { actionType: "reset", sessionIdHint: fresh.sessionId });
  }

  Date.now = () => start + 130_000;
  try {
    const expiredGrant = ensureActionVerification(req, {
      actionType: "reset",
      route: "/users/recovery",
      sessionIdHint: fresh.sessionId,
      verificationGrantToken: solved.verificationGrantToken,
    });
    assert.equal(expiredGrant.ok, false);
    assert.equal(expiredGrant.reasonCode, "grant_expired");
  } finally {
    Date.now = originalNow;
  }
});

test("binding checks reject cross-session, cross-ip, and cross-action use", () => {
  __resetCavbotVerifyForTests();
  const reqA = makeRequest("sess_bind_a", "203.0.113.10");
  const reqB = makeRequest("sess_bind_b", "203.0.113.10");
  const reqC = makeRequest("sess_bind_a", "198.51.100.77");

  const challenge = createVerifyChallenge(reqA, {
    actionType: "signup",
    route: "/auth",
    sessionIdHint: "sess_bind_a",
  });
  assert.equal(challenge.ok, true);
  if (!challenge.ok) return;

  const crossSessionSubmit = submitVerifyChallenge(reqB, {
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    chosenTileId: requireSnapshot(challenge.challengeId).correctTileId,
    gestureSummary: VALID_GESTURE,
    sessionIdHint: "sess_bind_b",
  });
  assert.equal(crossSessionSubmit.ok, false);
  assert.equal(crossSessionSubmit.error, "CHALLENGE_SCOPE_INVALID");

  const solved = solveChallenge(reqA, challenge);
  assert.equal(solved.ok, true);
  if (!solved.ok) return;

  for (let i = 0; i < 4; i += 1) {
    recordVerifyActionFailure(reqB, { actionType: "signup", sessionIdHint: "sess_bind_b" });
    recordVerifyActionFailure(reqC, { actionType: "signup", sessionIdHint: "sess_bind_a" });
  }

  const crossSessionGrant = ensureActionVerification(reqB, {
    actionType: "signup",
    route: "/auth",
    sessionIdHint: "sess_bind_b",
    verificationGrantToken: solved.verificationGrantToken,
  });
  assert.equal(crossSessionGrant.ok, false);
  assert.equal(crossSessionGrant.reasonCode, "grant_invalid");

  const crossIpGrant = ensureActionVerification(reqC, {
    actionType: "signup",
    route: "/auth",
    sessionIdHint: "sess_bind_a",
    verificationGrantToken: solved.verificationGrantToken,
  });
  assert.equal(crossIpGrant.ok, false);
  assert.equal(crossIpGrant.reasonCode, "grant_invalid");

  const actionMismatch = ensureActionVerification(reqA, {
    actionType: "reset",
    route: "/users/recovery",
    sessionIdHint: "sess_bind_a",
    verificationGrantToken: solved.verificationGrantToken,
  });
  assert.equal(actionMismatch.ok, false);
  assert.equal(actionMismatch.reasonCode, "grant_invalid");
});

test("rate limits and cooldowns trigger for risk and submit abuse", () => {
  __resetCavbotVerifyForTests();
  const req = makeRequest("sess_rate", "198.51.100.20");

  let blocked = false;
  for (let i = 0; i < 35; i += 1) {
    const gate = ensureActionVerification(req, {
      actionType: "signup",
      route: "/auth",
      sessionIdHint: "sess_rate",
    });
    if (gate.decision === "block") {
      blocked = true;
      break;
    }
  }
  assert.equal(blocked, true);

  __resetCavbotVerifyForTests();
  const reqSubmit = makeRequest("sess_submit_limit", "198.51.100.21");
  let submitLimited = false;

  for (let i = 0; i < 8 && !submitLimited; i += 1) {
    const challenge = createVerifyChallenge(reqSubmit, {
      actionType: "login",
      route: "/auth",
      sessionIdHint: "sess_submit_limit",
    });
    assert.equal(challenge.ok, true);
    if (!challenge.ok) continue;

    for (let j = 0; j < 2; j += 1) {
      const bad = submitVerifyChallenge(reqSubmit, {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        chosenTileId: "cbv_tile_invalid",
        gestureSummary: VALID_GESTURE,
        sessionIdHint: challenge.sessionId,
      });
      if (!bad.ok && bad.error === "VERIFY_COOLDOWN") {
        submitLimited = true;
        break;
      }
    }
  }

  assert.equal(submitLimited, true);
});

test("step_up_required risk decision can still be fulfilled with a valid challenge", () => {
  __resetCavbotVerifyForTests();
  const req = makeRequest("sess_stepup");

  for (let i = 0; i < 4; i += 1) {
    recordVerifyActionFailure(req, { actionType: "signup", sessionIdHint: "sess_stepup" });
  }

  const risk = evaluateVerifyRisk(req, {
    actionType: "signup",
    route: "/auth",
    sessionIdHint: "sess_stepup",
    mutate: false,
  });
  assert.equal(risk.decision, "step_up_required");

  const challenge = createVerifyChallenge(req, {
    actionType: "signup",
    route: "/auth",
    sessionIdHint: risk.sessionId,
  });
  assert.equal(challenge.ok, true);
  if (!challenge.ok) return;

  const solved = solveChallenge(req, challenge);
  assert.equal(solved.ok, true);
});

test("OTP fallback can issue verification grants", async () => {
  __resetCavbotVerifyForTests();
  const req = makeRequest("sess_otp");
  const prevCode = process.env.CAVBOT_VERIFY_TEST_CODE;
  process.env.CAVBOT_VERIFY_TEST_CODE = "123456";

  try {
    const started = await startVerifyOtp(req, {
      actionType: "signup",
      email: "person@example.com",
      sessionIdHint: "sess_otp",
    });
    assert.equal(started.ok, true);
    if (!started.ok) return;

    const confirmed = confirmVerifyOtp(req, {
      otpChallengeId: started.otpChallengeId,
      code: "123456",
      actionType: "signup",
      sessionIdHint: started.sessionId,
    });
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.equal(Boolean(confirmed.verificationGrantToken), true);
  } finally {
    if (typeof prevCode === "string") process.env.CAVBOT_VERIFY_TEST_CODE = prevCode;
    else delete process.env.CAVBOT_VERIFY_TEST_CODE;
  }
});

test("modal source keeps verify entrypoint, shape-rendering, and no click-jank hooks", () => {
  const authSource = read("app/auth/page.tsx");
  const recoverySource = read("app/users/recovery/page.tsx");
  const teamSource = read("app/settings/sections/TeamClient.tsx");
  const modalSource = read("components/CavBotVerifyModal.tsx");
  const glyphSource = read("lib/cavbotVerify/wordmarkGlyphs.ts");

  assert.equal(authSource.includes("CavBotVerifyModal"), true);
  assert.equal(recoverySource.includes("CavBotVerifyModal"), true);
  assert.equal(teamSource.includes("CavBotVerifyModal"), true);

  assert.equal(modalSource.includes("Use email code instead"), true);
  assert.equal(modalSource.includes("window.addEventListener(\"click\""), false);
  assert.equal(modalSource.includes("location.reload("), false);
  assert.equal(modalSource.includes("/logo/cavbot-wordmark.svg"), false);
  assert.equal(/debugLabel|correctTileId|missingGlyphIndex/.test(modalSource), false);

  assert.equal(glyphSource.includes("public/logo/cavbot-wordmark.svg"), true);
  assert.equal(glyphSource.includes("key: \"C\""), true);
  assert.equal(glyphSource.includes("key: \"a\""), true);
  assert.equal(glyphSource.includes("key: \"v\""), true);
  assert.equal(glyphSource.includes("key: \"B\""), true);
  assert.equal(glyphSource.includes("key: \"o\""), true);
  assert.equal(glyphSource.includes("key: \"t\""), true);
});
