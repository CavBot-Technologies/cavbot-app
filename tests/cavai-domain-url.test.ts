import test from "node:test";
import assert from "node:assert/strict";

import {
  CAVAI_DEFAULT_CONTEXT_LABEL,
  buildCanonicalCavAiUrl,
  buildCanonicalCavAiUrlFromSearchParams,
  buildCavAiPageSearchParamsFromRoot,
} from "../lib/cavai/url.ts";

test("canonical CavAi workspace URL collapses to ai.cavbot.io root", () => {
  assert.equal(
    buildCanonicalCavAiUrl({
      surface: "workspace",
      contextLabel: CAVAI_DEFAULT_CONTEXT_LABEL,
    }),
    "https://ai.cavbot.io/"
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
    "https://ai.cavbot.io/?surface=cavcloud&context=Cloud+context&projectId=42"
  );
});

test("legacy CavAi search params normalize to canonical ai host URL", () => {
  const url = buildCanonicalCavAiUrlFromSearchParams(
    new URLSearchParams("surface=workspace&context=Workspace+context&sessionId=abc123")
  );
  assert.equal(url, "https://ai.cavbot.io/?sessionId=abc123");
});

test("ai host root rewrites back into the full CavAi page params", () => {
  const params = buildCavAiPageSearchParamsFromRoot(new URLSearchParams("sessionId=abc123"));
  assert.equal(params.get("surface"), "workspace");
  assert.equal(params.get("context"), CAVAI_DEFAULT_CONTEXT_LABEL);
  assert.equal(params.get("sessionId"), "abc123");
});
