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
          message: 'cannot execute CREATE TABLE in a read-only transaction on "AdminAccountDiscipline"',
        },
      },
      ["AdminAccountDiscipline"],
    ),
    true,
  );
  assert.equal(isSoftTableAccessError(new Error("totally unrelated failure"), ["AdminAccountDiscipline"]), false);
});

test("account discipline reads no longer do DDL in the authenticated request path", () => {
  const source = read("lib/admin/accountDiscipline.server.ts");
  const readFnStart = source.indexOf("async function readAccountDisciplineRow(accountId: string)");
  const getStateStart = source.indexOf("export async function getAccountDisciplineState");
  const readFn = readFnStart >= 0 && getStateStart > readFnStart ? source.slice(readFnStart, getStateStart) : source;

  assert.match(readFn, /async function readAccountDisciplineRow\(accountId: string\) \{[\s\S]*isSoftTableAccessError\(err, \["AdminAccountDiscipline"\]\)/);
  assert.doesNotMatch(readFn, /ensureAccountDisciplineTable\(\)/);
  assert.match(source, /getAccountDisciplineMap[\s\S]*isSoftTableAccessError\(err, \["AdminAccountDiscipline"\]\)[\s\S]*new Map<string, AccountDisciplineState>\(\)/);
  assert.match(source, /listAccountDisciplineStates[\s\S]*isSoftTableAccessError\(err, \["AdminAccountDiscipline"\]\)[\s\S]*return \[\]/);
});

test("expired discipline restores soft-fail instead of blocking authenticated requests", () => {
  const accountSource = read("lib/admin/accountDiscipline.server.ts");
  const userSource = read("lib/admin/userDiscipline.server.ts");

  assert.match(accountSource, /await restoreAccount\([\s\S]*\} catch \(err\) \{[\s\S]*isSoftTableAccessError\(err, \["AdminAccountDiscipline"\]\)[\s\S]*return null;/);
  assert.match(userSource, /await restoreUser\([\s\S]*\} catch \(err\) \{[\s\S]*isSoftTableAccessError\(err, \["AdminUserDiscipline"\]\)[\s\S]*return null;/);
});

test("user discipline reads soft-fail when the Prisma delegate is unavailable", () => {
  const source = read("lib/admin/userDiscipline.server.ts");

  assert.match(source, /function getUserDisciplineDelegate\(\)/);
  assert.match(source, /const delegate = getUserDisciplineDelegate\(\);\s*if \(!delegate\) return null;/);
  assert.match(source, /const delegate = getUserDisciplineDelegate\(\);\s*if \(!delegate\) return new Map<string, UserDisciplineState>\(\);/);
  assert.match(source, /const delegate = getUserDisciplineDelegate\(\);\s*if \(!delegate\) return \[\];/);
});
