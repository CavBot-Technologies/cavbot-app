import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { isSoftTableAccessError } from "@/lib/dbSchemaGuard";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("soft table access guard treats missing tables, privilege errors, and read-only access as recoverable", () => {
  assert.equal(isSoftTableAccessError({ code: "P2021" }, ["AdminAccountDiscipline"]), true);
  assert.equal(
    isSoftTableAccessError(
      {
        code: "P2010",
        meta: {
          code: "42501",
          message: 'permission denied for table "AdminAccountDiscipline"',
        },
      },
      ["AdminAccountDiscipline"],
    ),
    true,
  );
  assert.equal(
    isSoftTableAccessError(
      {
        meta: {
          code: "25006",
          message: 'cannot execute SELECT in a read-only transaction on "AdminAccountDiscipline"',
        },
      },
      ["AdminAccountDiscipline"],
    ),
    true,
  );
  assert.equal(isSoftTableAccessError(new Error("totally unrelated failure"), ["AdminAccountDiscipline"]), false);
});

test("account discipline reads fail open on admin table access faults", () => {
  const source = read("lib/admin/accountDiscipline.server.ts");

  assert.match(source, /import \{ isSoftTableAccessError \} from "@\/lib\/dbSchemaGuard";/);
  assert.match(source, /async function readAccountDisciplineRow\(accountId: string\) \{[\s\S]*isSoftTableAccessError\(error, \["AdminAccountDiscipline"\]\)[\s\S]*return null;/);
  assert.match(source, /return \{[\s\S]*status: "ACTIVE",[\s\S]*suspendedUntilISO: null,/);
});
