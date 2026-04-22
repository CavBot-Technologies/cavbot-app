import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("deploy workflow exposes session secret during Cloudflare build", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");

  assert.match(
    workflow,
    /CAVBOT_SESSION_SECRET:\s*\$\{\{\s*secrets\.CAVBOT_SESSION_SECRET\s*\}\}/,
  );
  assert.match(
    workflow,
    /Required during build because middleware validates signed session cookies\./,
  );
  assert.match(workflow, /name:\s*Validate Auth Build Secrets/);
  assert.match(
    workflow,
    /Set production secret CAVBOT_SESSION_SECRET for Deploy Cloudflare so middleware can validate auth cookies\./,
  );
});
