import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavtools routes use the worker-safe runtime plane before the heavy command plane", () => {
  const execRoute = read("app/api/cavtools/exec/route.ts");
  const fileRoute = read("app/api/cavtools/file/route.ts");
  const runtimePlane = read("lib/cavtools/runtimePlane.server.ts");

  assert.equal(execRoute.includes('import { maybeHandleRuntimeExecCommand } from "@/lib/cavtools/runtimePlane.server";'), true);
  assert.equal(execRoute.includes("const runtimeResult = await maybeHandleRuntimeExecCommand(req, {"), true);
  assert.equal(execRoute.includes('const { executeCavtoolsCommand } = await import("@/lib/cavtools/commandPlane.server");'), true);
  assert.equal(execRoute.includes("WebAssembly.Module(): Wasm code generation disallowed by embedder"), true);

  assert.equal(fileRoute.includes('import { maybeReadRuntimeCavtoolsFile } from "@/lib/cavtools/runtimePlane.server";'), true);
  assert.equal(fileRoute.includes("const runtimeFile = await maybeReadRuntimeCavtoolsFile(req, {"), true);
  assert.equal(fileRoute.includes('const { readCavtoolsFile } = await import("@/lib/cavtools/commandPlane.server");'), true);
  assert.equal(fileRoute.includes("WebAssembly.Module(): Wasm code generation disallowed by embedder"), true);

  assert.equal(runtimePlane.includes("export async function maybeHandleRuntimeExecCommand("), true);
  assert.equal(runtimePlane.includes("export async function maybeReadRuntimeCavtoolsFile("), true);
  assert.equal(runtimePlane.includes('if (parsed.name === "cav" && s(parsed.args[0] || "").toLowerCase() === "status") {'), true);
  assert.equal(runtimePlane.includes('if (parsed.name === "ls" || parsed.name === "cd") {'), true);
  assert.equal(runtimePlane.includes('if (parsed.name === "cat") {'), true);
  assert.equal(runtimePlane.includes('if (root === "/telemetry") return { cwd: "/telemetry", items: STATIC_ROOT_ITEMS["/telemetry"] };'), true);
  assert.equal(runtimePlane.includes('STATIC_ROOT_ITEMS["/workspace"]'), true);
  assert.equal(runtimePlane.includes('return { cwd: "/workspace", items: STATIC_ROOT_ITEMS["/workspace"] };'), true);
});
