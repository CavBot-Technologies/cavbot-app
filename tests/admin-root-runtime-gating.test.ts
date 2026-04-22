import test from "node:test";
import assert from "node:assert/strict";

import { shouldRenderSharedRootRuntime } from "@/lib/admin/rootRuntime";

test("admin hosts skip shared app runtime mounts", () => {
  assert.equal(shouldRenderSharedRootRuntime("admin.localhost:3000"), false);
  assert.equal(shouldRenderSharedRootRuntime("admin.cavbot.io"), false);
});

test("app hosts keep shared app runtime mounts", () => {
  assert.equal(shouldRenderSharedRootRuntime("app.cavbot.io"), true);
  assert.equal(shouldRenderSharedRootRuntime("localhost:3000"), true);
  assert.equal(shouldRenderSharedRootRuntime(null), true);
});
