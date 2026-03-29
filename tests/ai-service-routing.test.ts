import assert from "node:assert/strict";
import test from "node:test";

import {
  CAVCODE_ASSIST_REQUEST_SCHEMA,
  CONSOLE_ASSIST_REQUEST_SCHEMA,
} from "@/src/lib/ai/ai.types";
import {
  resolveModelRoleForCavCodeAction,
  resolveModelRoleForTaskType,
  resolveModelRoleForSurfaceAction,
} from "@/src/lib/ai/model-routing";

test("CavCode action model routing keeps explain/suggest on reasoning model", () => {
  assert.equal(resolveModelRoleForCavCodeAction("explain_error"), "reasoning");
  assert.equal(resolveModelRoleForCavCodeAction("suggest_fix"), "reasoning");
  assert.equal(resolveModelRoleForCavCodeAction("explain_code"), "reasoning");
  assert.equal(resolveModelRoleForCavCodeAction("competitor_research"), "reasoning");
  assert.equal(resolveModelRoleForCavCodeAction("accessibility_audit"), "reasoning");
  assert.equal(resolveModelRoleForCavCodeAction("improve_seo"), "chat");
  assert.equal(resolveModelRoleForCavCodeAction("write_note"), "chat");
  assert.equal(resolveModelRoleForCavCodeAction("refactor_safely"), "reasoning");
});

test("Surface action model routing upgrades anomaly/cluster flows to reasoning model", () => {
  assert.equal(resolveModelRoleForSurfaceAction("console", "explain_telemetry_anomaly"), "reasoning");
  assert.equal(resolveModelRoleForSurfaceAction("console", "explain_issue_cluster"), "reasoning");
  assert.equal(resolveModelRoleForSurfaceAction("console", "summarize_posture"), "chat");
  assert.equal(resolveModelRoleForSurfaceAction("cavcloud", "explain_artifact"), "chat");
});

test("Task-aware model role routing upgrades general heavy tasks to reasoning", () => {
  assert.equal(
    resolveModelRoleForTaskType({
      taskType: "code_fix",
      surface: "console",
      action: "technical_recap",
    }),
    "reasoning"
  );
  assert.equal(
    resolveModelRoleForTaskType({
      taskType: "seo",
      surface: "console",
      action: "write_note",
    }),
    "reasoning"
  );
  assert.equal(
    resolveModelRoleForTaskType({
      taskType: "writing",
      surface: "console",
      action: "write_note",
    }),
    "chat"
  );
});

test("CavCode assist request schema enforces required action + filePath", () => {
  const ok = CAVCODE_ASSIST_REQUEST_SCHEMA.safeParse({
    action: "explain_error",
    filePath: "/app/routes/page.tsx",
    diagnostics: [
      {
        message: "Type mismatch",
        severity: "error",
      },
    ],
  });
  assert.equal(ok.success, true);

  const generation = CAVCODE_ASSIST_REQUEST_SCHEMA.safeParse({
    action: "generate_component",
    filePath: "/app/routes/page.tsx",
    goal: "Create a new hero component",
  });
  assert.equal(generation.success, true);

  const accessibility = CAVCODE_ASSIST_REQUEST_SCHEMA.safeParse({
    action: "accessibility_audit",
    filePath: "/app/routes/page.tsx",
    goal: "Review and remediate keyboard navigation issues.",
  });
  assert.equal(accessibility.success, true);

  const bad = CAVCODE_ASSIST_REQUEST_SCHEMA.safeParse({
    action: "explain_error",
    diagnostics: [],
  });
  assert.equal(bad.success, false);
});

test("Console assist schema remains action-locked", () => {
  const parsed = CONSOLE_ASSIST_REQUEST_SCHEMA.safeParse({
    action: "summarize_posture",
    goal: "Summarize current incident posture.",
  });
  assert.equal(parsed.success, true);

  const bad = CONSOLE_ASSIST_REQUEST_SCHEMA.safeParse({
    action: "suggest_fix",
    goal: "Should fail",
  });
  assert.equal(bad.success, false);
});
