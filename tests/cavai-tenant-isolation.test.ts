import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { scopedRunLookupKey } from "@/lib/cavai/scoping";

test("run lookup keys are always tenant-scoped by accountId + runId", () => {
  const scoped = scopedRunLookupKey("acct_a", "run_123");
  assert.deepEqual(scoped, {
    accountId_runId: {
      accountId: "acct_a",
      runId: "run_123",
    },
  });
});

test("server lookup implementation uses compound accountId_runId key", () => {
  const scopingSource = fs.readFileSync(
    path.resolve("lib/cavai/scoping.ts"),
    "utf8"
  );
  assert.equal(
    scopingSource.includes("accountId_runId"),
    true,
    "Expected tenant-scoped compound lookup key in scoping helper."
  );
  const source = fs.readFileSync(path.resolve("lib/cavai/intelligence.server.ts"), "utf8");
  assert.equal(
    source.includes("scopedRunLookupKey"),
    true,
    "Intelligence server should rely on the scoped run lookup helper."
  );
  assert.equal(
    /where:\s*\{\s*runId\s*:/.test(source),
    false,
    "Run lookup must never query by runId alone."
  );
});

test("/api/cavai/fixes resolves packs using authenticated account context", () => {
  const source = fs.readFileSync(path.resolve("app/api/cavai/fixes/route.ts"), "utf8");
  assert.equal(
    source.includes("accountId: session.accountId"),
    true,
    "Fix route must scope run access by authenticated accountId."
  );
});
