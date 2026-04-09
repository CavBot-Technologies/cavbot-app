import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { findLatestEntitledSubscription } from "../lib/accountPlan.server";

const repoRoot = process.cwd();

function schemaMismatch(message: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = "P2022";
  return error;
}

test("account plan lookup defaults to account-db queries instead of Prisma runtime", () => {
  const source = readFileSync(path.join(repoRoot, "lib/accountPlan.server.ts"), "utf8");

  assert.match(source, /import \{ getAuthPool \} from "@\/lib\/authDb";/);
  assert.doesNotMatch(source, /import \{ prisma \} from "@\/lib\/prisma";/);
  assert.match(source, /tx: PlanResolverDbClient = getAuthPool\(\)/);
  assert.match(source, /if \(isRawQueryClient\(tx\)\)/);
});

test("findLatestEntitledSubscription falls back when subscription ordering columns drift", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const tx = {
    subscription: {
      async findFirst(query: Record<string, unknown>) {
        calls.push(query);
        if (calls.length === 1) {
          throw schemaMismatch("Unknown argument `currentPeriodEnd`");
        }
        return {
          tier: "PREMIUM_PLUS",
          status: "ACTIVE",
        };
      },
    },
  } as Parameters<typeof findLatestEntitledSubscription>[1];

  const row = await findLatestEntitledSubscription("acct_live", tx);

  assert.deepEqual(row, {
    tier: "PREMIUM_PLUS",
    status: "ACTIVE",
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.select, {
    tier: true,
    status: true,
    currentPeriodEnd: true,
  });
  assert.deepEqual(calls[1]?.select, {
    tier: true,
    status: true,
  });
});

test("findLatestEntitledSubscription fails open for transient database outages", async () => {
  const tx = {
    subscription: {
      async findFirst() {
        const error = new Error("database offline") as Error & { code?: string };
        error.code = "P1001";
        throw error;
      },
    },
  } as Parameters<typeof findLatestEntitledSubscription>[1];

  await assert.doesNotReject(async () => {
    const row = await findLatestEntitledSubscription("acct_live", tx);
    assert.equal(row, null);
  });
});
