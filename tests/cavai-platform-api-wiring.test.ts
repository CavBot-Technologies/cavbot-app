import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(file: string) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

test("route manifest API exposes snapshot list/get/create wiring", () => {
  const source = read("app/api/cavai/route-manifest/snapshot/route.ts");
  assert.equal(source.includes("export async function GET"), true);
  assert.equal(source.includes("export async function POST"), true);
  assert.equal(source.includes("buildCavAiRouteManifestSnapshot"), true);
  assert.equal(source.includes("persistCavAiRouteManifestSnapshot"), true);
  assert.equal(source.includes("listCavAiRouteManifestSnapshots"), true);
  assert.equal(source.includes("getCavAiRouteManifestSnapshot"), true);
});

test("website knowledge APIs expose fetch and ingest wiring", () => {
  const fetchSource = read("app/api/cavai/website-knowledge/route.ts");
  const ingestSource = read("app/api/cavai/website-knowledge/ingest/route.ts");
  assert.equal(fetchSource.includes("export async function GET"), true);
  assert.equal(fetchSource.includes("getLatestWebsiteKnowledgeGraph"), true);
  assert.equal(fetchSource.includes("listWebsiteKnowledgeGraphHistory"), true);
  assert.equal(ingestSource.includes("export async function POST"), true);
  assert.equal(ingestSource.includes("ingestWebsiteKnowledgeFromLatestScan"), true);
});

test("agent job APIs expose list/create/get/events/cancel-resume wiring", () => {
  const rootSource = read("app/api/ai/agent-jobs/route.ts");
  const jobSource = read("app/api/ai/agent-jobs/[jobId]/route.ts");
  const eventsSource = read("app/api/ai/agent-jobs/[jobId]/events/route.ts");
  assert.equal(rootSource.includes("createAiAgentJob"), true);
  assert.equal(rootSource.includes("listAiAgentJobs"), true);
  assert.equal(jobSource.includes("getAiAgentJob"), true);
  assert.equal(jobSource.includes("cancelAiAgentJob"), true);
  assert.equal(jobSource.includes("executeAiAgentJob"), true);
  assert.equal(eventsSource.includes("listAiAgentJobEvents"), true);
});

test("ops dashboard includes route-manifest and website-graph metrics with valid usage query", () => {
  const source = read("app/api/ai/ops/dashboard/route.ts");
  assert.equal(source.includes("cavAiRouteManifestSnapshot.findFirst"), true);
  assert.equal(source.includes("cavAiWebsiteKnowledgeGraph.findFirst"), true);
  assert.equal(source.includes("actionClass: false as never"), false);
});
