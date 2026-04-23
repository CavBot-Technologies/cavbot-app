import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("global footer keeps app developer tools separate from HQ human resources", () => {
  const source = read("components/footer/CavbotGlobalFooter.tsx");

  assert.match(source, /adminHostRuntime \? \(/);
  assert.match(source, /<span>Human Resources<\/span>/);
  assert.match(source, /<span>Developers<\/span>/);
  assert.match(source, /aria-controls="cb-footer-human-resources-panel"/);
  assert.match(source, /aria-controls="cb-footer-developer-panel"/);
});

test("app footer developer modal keeps the original tool links", () => {
  const source = read("components/footer/CavbotGlobalFooter.tsx");

  assert.match(source, /href:\s*"\/cavtools"/);
  assert.match(source, /href:\s*"\/cavcode"/);
  assert.match(source, /href:\s*"\/cavcode-viewer"/);
  assert.match(source, /href:\s*"\/cavcloud"/);
  assert.match(source, /<div className=\{styles\.developerTitle\}>Developers<\/div>/);
});
