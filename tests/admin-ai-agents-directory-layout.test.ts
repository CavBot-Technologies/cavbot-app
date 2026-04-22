import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("hq ai agent cards use the restored name-and-username layout and show published marks for all published agents", () => {
  const source = read("components/admin/AiAgentsDirectory.tsx");
  const css = read("app/admin-internal/admin.css");
  const publishedMarkStart = css.indexOf(".hq-aiAgentPublishedMark");
  const publishedIconStart = css.indexOf(".hq-aiAgentPublishedIcon");
  const publishedMarkBlock = publishedMarkStart >= 0 && publishedIconStart > publishedMarkStart
    ? css.slice(publishedMarkStart, publishedIconStart)
    : "";

  assert.equal(source.includes("row.isPublished ? ("), true);
  assert.equal(source.includes("data-agent-id={props.agentId || undefined}"), true);
  assert.equal(source.includes("agentId={row.agentIdValue || row.id}"), true);
  assert.equal(source.includes("hq-aiAgentPublishedMark"), true);
  assert.equal(source.includes("PublishedCheckIcon"), true);
  assert.equal(source.includes("hq-aiAgentCardFoot"), false);
  assert.equal(source.includes("row.isPreview ? <Badge"), false);
  assert.equal(source.includes("hq-aiAgentHandle"), true);
  assert.equal(source.includes('<p className="hq-aiAgentSummary">{row.summary}</p>'), false);
  assert.equal(source.includes("hq-aiAgentModalSummary"), true);
  assert.equal(source.includes("{ label: \"Prompt\", value: activeRow.creationPromptLabel }"), false);

  assert.equal(css.includes(".hq-aiAgentPublishedMark"), true);
  assert.equal(css.includes(".hq-aiAgentPublishedIcon"), true);
  assert.equal(css.includes(".hq-aiAgentHandle"), true);
  assert.equal(css.includes(".hq-aiAgentSummary"), false);
  assert.equal(css.includes(".hq-aiAgentModalSummary"), true);
  assert.equal(css.includes(".hq-aiAgentIcon[data-agent-id=\"code_explainer\"]"), true);
  assert.equal(publishedMarkBlock.includes("background:"), false);
  assert.equal(publishedMarkBlock.includes("border-radius"), false);
});

test("hq ai agents page uses the full CavBot catalog and moderation routes stay wired", () => {
  const directorySource = read("components/admin/AiAgentsDirectory.tsx");
  const pageSource = read("app/admin-internal/(protected)/ai-agents/page.tsx");
  const publishRoute = read("app/api/admin/ai-agents/publish/route.ts");
  const unpublishRoute = read("app/api/admin/ai-agents/unpublish/route.ts");
  const deleteRoute = read("app/api/admin/ai-agents/delete/route.ts");
  const trackingSource = read("lib/admin/agentIntelligence.server.ts");

  assert.equal(pageSource.includes('import { AGENT_CATALOG } from "@/lib/cavai/agentCatalog";'), true);
  assert.equal(pageSource.includes('row.visibility !== "hidden_mode_feature"'), true);
  assert.equal(pageSource.includes("const cavbotRows: AiAgentDirectoryRow[] = hqBuiltInCatalog"), true);

  assert.equal(directorySource.includes("View profile"), true);
  assert.equal(directorySource.includes('type: "unpublish"'), true);
  assert.equal(directorySource.includes('type: "delete"'), true);
  assert.equal(directorySource.includes("/api/admin/ai-agents/unpublish"), true);
  assert.equal(directorySource.includes("/api/admin/ai-agents/delete"), true);

  assert.equal(publishRoute.includes("publishAdminTrackedCustomAgent"), true);
  assert.equal(unpublishRoute.includes("unpublishAdminTrackedCustomAgent"), true);
  assert.equal(deleteRoute.includes("deleteAdminTrackedCustomAgent"), true);
  assert.equal(trackingSource.includes("rawAgent.publicationRequested === false"), true);
});
