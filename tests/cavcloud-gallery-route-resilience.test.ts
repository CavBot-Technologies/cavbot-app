import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavcloud gallery route degrades on schema drift without bypassing auth errors", () => {
  const source = read("app/api/cavcloud/gallery/route.ts");

  assert.match(source, /async function buildDegradedGalleryResponse\(req: Request\)/);
  assert.match(source, /degraded: true/);
  assert.match(source, /files: \[\]/);
  assert.match(source, /if \(err instanceof ApiAuthError\)/);
  assert.match(source, /if \(isMissingCavCloudTablesError\(err\) \|\| isCavCloudGallerySchemaMismatch\(err\)\)/);
  assert.match(source, /return await buildDegradedGalleryResponse\(req\);/);
});
