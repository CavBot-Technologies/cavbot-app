import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("production build scripts regenerate Prisma client before compiling", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(pkg.scripts?.build?.startsWith("prisma generate && "), true);
  assert.equal(pkg.scripts?.["build:cloudflare"]?.startsWith("prisma generate && "), true);
});
