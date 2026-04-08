import assert from "node:assert/strict";
import test from "node:test";

import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";

test("schema mismatch guard catches stale Prisma relation field selects", () => {
  assert.equal(
    isSchemaMismatchError(
      {
        message: "Unknown field `artifact` for select statement on model `CavCloudShare`.",
      },
      { fields: ["artifact"] },
    ),
    true,
  );

  assert.equal(
    isSchemaMismatchError(
      {
        message: "Unknown field `grantedByUser` for include statement on model `CavCloudFileAccess`.",
      },
      { fields: ["grantedByUser"] },
    ),
    true,
  );
});

test("schema mismatch guard still catches missing database columns", () => {
  assert.equal(
    isSchemaMismatchError(
      {
        meta: {
          code: "42703",
          message: 'column "trialSeatActive" does not exist',
        },
      },
      { columns: ["trialSeatActive"] },
    ),
    true,
  );
});
