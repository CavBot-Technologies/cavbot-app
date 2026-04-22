import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("prisma proxy refreshes stale dev clients when a newly generated model delegate is missing", () => {
  const source = readFileSync(path.join(repoRoot, "lib/prisma.ts"), "utf8");

  assert.equal(source.includes("replaceCachedPrismaClient"), true);
  assert.equal(source.includes("shouldRefreshDevClientForProp"), true);
  assert.equal(source.includes("return !Reflect.has(client as object, prop);"), true);
  assert.equal(source.includes('typeof prop !== "string" || prop.startsWith("$")'), true);
  assert.equal(source.includes("Reflect.get(client as object, prop, client)"), true);
});
