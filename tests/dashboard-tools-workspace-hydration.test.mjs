import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const shellSource = fs.readFileSync(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const controlsSource = fs.readFileSync(new URL("../components/DashboardToolsControls.tsx", import.meta.url), "utf8");
const modalSource = fs.readFileSync(new URL("../components/DashboardToolsModal.tsx", import.meta.url), "utf8");

test("AppShell hydrates empty dashboard tools target selects from workspace API", () => {
  assert.equal(shellSource.includes('document.querySelectorAll<HTMLSelectElement>("[data-tools-site]")'), true);
  assert.equal(shellSource.includes('fetch("/api/workspace"'), true);
  assert.equal(shellSource.includes('select.dispatchEvent(new Event("change", { bubbles: true }))'), true);
});

test("shared dashboard tools controls fall back to workspace sites at runtime", () => {
  assert.equal(controlsSource.includes('fetch("/api/workspace"'), true);
  assert.equal(controlsSource.includes("const effectiveSites = sites.length ? sites : runtimeSites;"), true);
  assert.equal(controlsSource.includes("setRuntimeSites(nextSites);"), true);
});

test("shared dashboard tools modal exposes the same target hook as inline pages", () => {
  assert.equal(modalSource.includes("data-tools-site"), true);
});
