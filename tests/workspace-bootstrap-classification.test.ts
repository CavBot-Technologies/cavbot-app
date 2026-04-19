import assert from "node:assert/strict";
import test from "node:test";
import { classifyWorkspaceBootstrapError } from "../lib/workspaceProjects.server";
import { CavBotApiConfigError } from "../lib/cavbotApi.server";

test("workspace bootstrap classifier maps schema mismatches to a stable non-retryable code", () => {
  const classified = classifyWorkspaceBootstrapError({
    code: "P2022",
    message: 'The column "retentionDays" does not exist in the current database.',
  });

  assert.deepEqual(classified, {
    error: "DB_SCHEMA_OUT_OF_DATE",
    status: 409,
    retryable: false,
  });
});

test("workspace bootstrap classifier maps database permission failures to a stable non-retryable code", () => {
  const classified = classifyWorkspaceBootstrapError({
    code: "P2010",
    meta: {
      code: "42501",
      message: 'permission denied for relation "Project"',
    },
  });

  assert.deepEqual(classified, {
    error: "DB_PERMISSION_DENIED",
    status: 503,
    retryable: false,
  });
});

test("workspace bootstrap classifier keeps unexpected failures retryable", () => {
  const classified = classifyWorkspaceBootstrapError(new Error("socket hang up"));

  assert.deepEqual(classified, {
    error: "WORKSPACE_BOOTSTRAP_FAILED",
    status: 503,
    retryable: true,
  });
});

test("cavbot api config errors keep a dedicated config_invalid code", () => {
  const error = new CavBotApiConfigError("missing admin token");

  assert.equal(error.code, "config_invalid");
  assert.equal(error.status, 500);
});
