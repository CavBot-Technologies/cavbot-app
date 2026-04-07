import assert from "node:assert/strict";
import test from "node:test";

import { findLatestEntitledSubscription } from "../lib/accountPlan.server";

function schemaMismatch(message: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = "P2022";
  return error;
}

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

test("findLatestEntitledSubscription rethrows non-schema failures", async () => {
  const tx = {
    subscription: {
      async findFirst() {
        const error = new Error("database offline") as Error & { code?: string };
        error.code = "P1001";
        throw error;
      },
    },
  } as Parameters<typeof findLatestEntitledSubscription>[1];

  await assert.rejects(() => findLatestEntitledSubscription("acct_live", tx), /database offline/);
});
