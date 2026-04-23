import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavtools command plane lazy-loads child_process and soft-fails unsupported runtimes", () => {
  const source = read("lib/cavtools/commandPlane.server.ts");

  assert.equal(source.includes('import type { ChildProcess } from "node:child_process";'), true);
  assert.equal(source.includes('import { spawn, type ChildProcess } from "node:child_process";'), false);
  assert.equal(source.includes('childProcessModulePromise = import("node:child_process")'), true);
  assert.equal(source.includes('PROCESS_RUNTIME_UNAVAILABLE_MESSAGE'), true);
  assert.equal(source.includes('PROCESS_RUNTIME_UNAVAILABLE'), true);
  assert.equal(source.includes("await spawnProcess("), true);
});

test("cavtools telemetry uses the tenant summary helper instead of the raw summary client", () => {
  const source = read("lib/cavtools/commandPlane.server.ts");

  assert.equal(source.includes('import { getTenantProjectSummary } from "@/lib/projectSummary.server";'), true);
  assert.equal(source.includes("await getTenantProjectSummary({"), true);
  assert.equal(source.includes("getProjectSummaryForTenant({"), false);
});
