import test from "node:test";
import assert from "node:assert/strict";

import {
  CAVAI_DEFAULT_CONTEXT_LABEL,
  buildCanonicalCavAiUrl,
  buildCanonicalCavAiUrlFromSearchParams,
  buildCavAiPageSearchParamsFromRoot,
} from "../lib/cavai/url";

test("canonical CavAi workspace URL stays on the app route", () => {
  assert.equal(
    buildCanonicalCavAiUrl({
      surface: "workspace",
      contextLabel: CAVAI_DEFAULT_CONTEXT_LABEL,
    }),
    "https://app.cavbot.io/cavai"
  );
});

test("canonical CavAi URL preserves non-default query state", () => {
  const url = buildCanonicalCavAiUrl({
    surface: "cavcloud",
    contextLabel: "Cloud context",
    projectId: 42,
  });
  assert.equal(
    url,
    "https://app.cavbot.io/cavai?surface=cavcloud&context=Cloud+context&projectId=42"
  );
});

test("legacy CavAi search params normalize to the canonical app route", () => {
  const url = buildCanonicalCavAiUrlFromSearchParams(
    new URLSearchParams("surface=workspace&context=Workspace+context&sessionId=abc123")
  );
  assert.equal(url, "https://app.cavbot.io/cavai?sessionId=abc123");
});

test("root CavAi search params expand back into full page params", () => {
  const params = buildCavAiPageSearchParamsFromRoot(new URLSearchParams("sessionId=abc123"));
  assert.equal(params.get("surface"), "workspace");
  assert.equal(params.get("context"), CAVAI_DEFAULT_CONTEXT_LABEL);
  assert.equal(params.get("sessionId"), "abc123");
});
