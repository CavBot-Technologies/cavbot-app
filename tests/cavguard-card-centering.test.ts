import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("cavguard card constrains itself to the viewport and stays centered", () => {
  const source = read("components/CavGuardCard.tsx");

  assert.match(source, /marginInline: "auto"/);
  assert.match(source, /maxWidth: "min\(100%, calc\(100vw - 36px\)\)"/);
  assert.match(source, /boxSizing: "border-box"/);
});

test("cavguard modal wrapper is hard-anchored to dead center", () => {
  const source = read("components/CavGuardModal.tsx");

  assert.match(source, /createPortal/);
  assert.match(source, /document\.body/);
  assert.match(source, /insetInlineStart: "50%"/);
  assert.match(source, /insetBlockStart: "50%"/);
  assert.match(source, /transform: "translate\(-50%, -50%\)"/);
  assert.match(source, /justifyItems: "center"/);
});
