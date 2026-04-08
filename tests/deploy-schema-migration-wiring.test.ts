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
  assert.match(workflow, /npx prisma migrate deploy/);
  assert.match(workflow, /DATABASE_URL/);
  assert.match(workflow, /DIRECT_URL/);
});
