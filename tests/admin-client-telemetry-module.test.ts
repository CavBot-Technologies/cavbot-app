import assert from "node:assert/strict";
import test from "node:test";

test("admin client telemetry helper is importable for shared client components", async () => {
  const mod = await import("../lib/admin/clientTelemetry.ts");

  assert.equal(typeof mod.emitAdminTelemetry, "function");
});
