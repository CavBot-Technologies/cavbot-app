import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("production deploy wiring applies prisma migrations before shipping", () => {
  const packageJson = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
  };
  const deployScript = read("scripts/deploy-cloudflare-pages.mjs");
  const workflow = read(".github/workflows/deploy-cloudflare.yml");

  assert.equal(packageJson.scripts?.["db:migrate"], "prisma migrate deploy");
  assert.match(deployScript, /npm", \["run", "db:migrate"\]/);
  assert.match(workflow, /name:\s*Apply Prisma Migrations/);
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /npx prisma migrate deploy/);
  assert.match(workflow, /MIGRATE_DATABASE_URL/);
  assert.match(workflow, /MIGRATE_DIRECT_URL/);
  assert.match(workflow, /secrets\.MIGRATE_DATABASE_URL \|\| secrets\.DATABASE_URL/);
  assert.match(workflow, /secrets\.MIGRATE_DIRECT_URL \|\| secrets\.DIRECT_URL/);
  assert.match(workflow, /Missing database deploy secret/);
  assert.match(workflow, /MIGRATE_DIRECT_URL \(preferred\) or MIGRATE_DATABASE_URL/);
  assert.match(workflow, /Invalid migrate DATABASE_URL/);
  assert.match(workflow, /Invalid migrate DIRECT_URL/);
  assert.match(workflow, /DATABASE_URL="\$\{DATABASE_URL#\\\"\}"/);
  assert.match(workflow, /DIRECT_URL="\$\{DIRECT_URL#\\\"\}"/);
  assert.doesNotMatch(workflow, /db\.prisma\.io:5432/);
  assert.doesNotMatch(deployScript, /db\.prisma\.io:5432/);
});
