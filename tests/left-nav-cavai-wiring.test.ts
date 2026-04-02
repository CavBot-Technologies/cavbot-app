import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(file: string) {
  return fs.readFileSync(path.resolve(file), "utf8");
}

test("left-nav pages include deterministic recommendation wiring", () => {
  const commandCenter = read("app/page.tsx");
  const consolePage = read("app/console/page.tsx");
  const errorsPage = read("app/errors/page.tsx");
  const seoPage = read("app/seo/page.tsx");
  const routesPage = read("app/routes/page.tsx");
  const a11yPage = read("app/a11y/page.tsx");
  const controlRoomPage = read("app/404-control-room/page.tsx");

  assert.equal(commandCenter.includes('panelId="command-center"'), true);
  assert.equal(consolePage.includes('panelId="console"'), true);
  assert.equal(errorsPage.includes('panelId="errors"'), true);
  assert.equal(seoPage.includes('panelId="seo"'), true);
  assert.equal(routesPage.includes('panelId="routes"'), true);
  assert.equal(a11yPage.includes('panelId="a11y"'), true);
  assert.equal(controlRoomPage.includes('panelId="control-room"'), true);
});

test("insights page pulls persisted deterministic packs before legacy fallback", () => {
  const source = read("app/insights/page.tsx");
  assert.equal(source.includes("/api/cavai/packs?origin="), true);
  assert.equal(source.includes("requestPersistedPack"), true);
  assert.equal(source.includes("applyPack(pack);"), true);
});

test("shared recommendations component enforces evidence-linked deterministic actions", () => {
  const source = read("components/CavAiRouteRecommendations.tsx");
  assert.equal(source.includes("/api/cavai/packs?origin="), true);
  assert.equal(source.includes("Evidence IDs:"), true);
  assert.equal(source.includes("intel.fixPlan"), true);
  assert.equal(source.includes("priorityToCavPadNote"), true);
  assert.equal(source.includes("resolveOpenTarget"), true);
});

test("pack retrieval endpoint is account-scoped and origin-scoped", () => {
  const source = read("app/api/cavai/packs/route.ts");
  assert.equal(source.includes("requireSession"), true);
  assert.equal(source.includes("requireAccountContext"), true);
  assert.equal(source.includes("normalizeOriginStrict"), true);
  assert.equal(source.includes("accountId: String(session.accountId || \"\")"), true);
});

test("metrics endpoint no longer returns hardcoded placeholder scores", () => {
  const source = read("app/api/metrics/route.ts");
  assert.equal(source.includes("guardianScore: 100"), false);
  assert.equal(source.includes("recovered404Rate"), false);
  assert.equal(source.includes("INSUFFICIENT_DATA"), true);
});

test("module-gated pages await request headers before access checks", () => {
  const errorsPage = read("app/errors/page.tsx");
  const seoPage = read("app/seo/page.tsx");
  const a11yPage = read("app/a11y/page.tsx");
  const insightsPage = read("app/insights/page.tsx");

  for (const source of [errorsPage, seoPage, a11yPage, insightsPage]) {
    assert.equal(source.includes("const requestHeaders = await headers();"), true);
    assert.equal(source.includes("headers: new Headers(requestHeaders)"), true);
    assert.equal(source.includes("new Headers(headers())"), false);
  }
});

test("ai metadata routes tolerate unavailable providers while execution remains gated", () => {
  const source = read("src/lib/ai/ai.policy.ts");

  assert.equal(source.includes("allowUnavailableProviderFallback?: boolean"), true);
  assert.equal(source.includes("defaultReasoningLevelForActionClass"), true);
  assert.equal(source.includes("args.requestedReasoningLevel || defaultReasoningLevelForActionClass(actionClass)"), true);
  assert.equal(source.includes("fallbackReason: \"provider_unavailable_metadata_access\""), true);
  assert.equal(source.includes("allowUnavailableProviderFallback: !args.isExecution"), true);
});

test("module and AI account gates use authDb instead of prisma account lookups", () => {
  const moduleGate = read("lib/moduleGate.server.ts");
  const aiGuard = read("src/lib/ai/ai.guard.ts");
  const authDb = read("lib/authDb.ts");

  assert.equal(moduleGate.includes('from "@/lib/prisma"'), false);
  assert.equal(moduleGate.includes("findAccountById"), true);
  assert.equal(moduleGate.includes("clearExpiredTrialSeat"), true);
  assert.equal(aiGuard.includes('from "@/lib/prisma"'), false);
  assert.equal(aiGuard.includes("findAccountById"), true);
  assert.equal(aiGuard.includes("findActiveProjectByIdForAccount"), true);
  assert.equal(authDb.includes("export async function findActiveProjectByIdForAccount"), true);
});

test("ai hot paths use authDb-backed counters and session persistence on Cloudflare", () => {
  const aiPolicy = read("src/lib/ai/ai.policy.ts");
  const aiMemory = read("src/lib/ai/ai.memory.ts");
  const aiAudit = read("src/lib/ai/ai.audit.ts");

  assert.equal(aiPolicy.includes('from "@/lib/prisma"'), false);
  assert.equal(aiPolicy.includes('import type { CavCloudCollabPolicy } from "@/lib/cavcloud/collabPolicy.server"'), true);
  assert.equal(aiPolicy.includes('import type { QwenCoderEntitlement, QwenCoderReservation } from "@/src/lib/ai/qwen-coder-credits.server"'), true);
  assert.equal(aiPolicy.includes("SELECT COUNT(*)::int AS \"count\""), true);
  assert.equal(aiPolicy.includes('FROM "CavAiUsageLog"'), true);
  assert.equal(aiMemory.includes('from "@/lib/authDb"'), true);
  assert.equal(aiMemory.includes('from "@/lib/prisma"'), false);
  assert.equal(aiMemory.includes('import("@/lib/prisma")'), true);
  assert.equal(aiMemory.includes('FROM "CavAiSession"'), true);
  assert.equal(aiMemory.includes('INSERT INTO "CavAiMessage"'), true);
  assert.equal(aiMemory.includes('"updatedAt"'), true);
  assert.equal(aiMemory.includes('UPDATE "CavAiSession"'), true);
  assert.equal(aiAudit.includes('from "@/lib/prisma"'), false);
  assert.equal(aiAudit.includes('from "@/lib/audit"'), false);
  assert.equal(aiAudit.includes('import("@/lib/prisma")'), true);
  assert.equal(aiAudit.includes('import("@/lib/audit")'), true);
});

test("cavcode and center assist degrade safely if optional registry or memory writes fail", () => {
  const aiService = read("src/lib/ai/ai.service.ts");
  const aiMemory = read("src/lib/ai/ai.memory.ts");

  assert.equal(aiService.includes("resolveInstalledCavenCustomAgentSafe"), true);
  assert.equal(aiService.includes("resolveInstalledCavCodeActionSafe"), true);
  assert.equal(aiService.includes("estimateContextTokensForSnapshotSafe"), true);
  assert.equal(aiService.includes("retrieveRelevantAiUserMemoryFactsSafe"), true);
  assert.equal(aiService.includes("shouldAttemptSemanticRepair"), true);
  assert.equal(aiService.includes("semantic_soft_fail_accepted"), true);
  assert.equal(aiService.includes("shouldReturnSafeFallbackOnProviderFailure"), true);
  assert.equal(aiService.includes("safe_fallback_response_generated"), true);
  assert.equal(aiService.includes("alibaba_qwen_coder_404_to_plus"), true);
  assert.equal(aiService.includes('from "@/src/lib/ai/qwen-coder-credits.server"'), false);
  assert.equal(aiService.includes('from "@/lib/cavcloud/storage.server"'), false);
  assert.equal(aiService.includes('from "@/lib/cavai/imageStudio.server"'), false);
  assert.equal(aiService.includes("return requested.slice(0, MAX_UPLOADED_WORKSPACE_FILES);"), true);
  assert.equal(aiMemory.includes("Memory learning must not break live assist flows."), true);
});

test("caven workspace keeps a persistent CavBot badge outside the scrollable history/chat surface", () => {
  const source = read("components/cavai/CavAiCodeWorkspace.tsx");
  const styles = read("components/cavai/CavAiWorkspace.module.css");

  assert.equal(source.includes('styles.titleBadge'), true);
  assert.equal(source.includes("<span>CAVEN</span>"), true);
  assert.equal(source.includes("<CdnBadgeEyes />"), true);
  assert.equal(styles.includes(".titleBadge"), true);
  assert.equal(styles.includes(".codePanelMode .titleBadge"), true);
});
