import "server-only";

import type { PlanId } from "@/lib/plans";
import { getAuthPool } from "@/lib/authDb";
import {
  AI_CENTER_ASSIST_RESPONSE_SCHEMA,
  AI_AUDIO_TRANSCRIPTION_RESPONSE_SCHEMA,
  CAVCODE_ASSIST_RESPONSE_SCHEMA,
  SURFACE_ASSIST_RESPONSE_SCHEMA,
  type AiAssistResponseEnvelope,
  type AiAudioTranscriptionRequest,
  type AiAudioTranscriptionResponse,
  type AiCenterAssistAction,
  type AiCenterAssistRequest,
  type AiCenterAssistResponse,
  type AiCenterSurface,
  type AiExecutionMeta,
  type AiRiskLevel,
  type AiSurface,
  type CavCloudAssistRequest,
  type CavCodeAssistRequest,
  type CavCodeAssistAction,
  type CavCodeAssistResponse,
  type CavPadAssistRequest,
  type CavSafeAssistRequest,
  type ConsoleAssistRequest,
  type SurfaceAssistResponse,
  AiServiceError,
} from "@/src/lib/ai/ai.types";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import {
  persistAiFixPlan,
  persistAiModelSelectionEvent,
  persistAiNarration,
  persistAiReasoningTrace,
  persistAiRetryEvent,
  persistAiToolCallTrace,
  writeAiAudit,
  writeAiUsageLog,
} from "@/src/lib/ai/ai.audit";
import {
  appendAiSessionTurn,
  ensureAiSession,
  learnAiUserMemoryFromPrompt,
  listAiSessionMessages,
  retrieveRelevantAiUserMemoryFacts,
  settleCavCodeQueuedPrompt,
} from "@/src/lib/ai/ai.memory";
import { buildFixPipelineDraft } from "@/src/lib/ai/fix-pipeline";
import {
  resolveModelRoleForCavCodeAction,
  resolveModelRoleForTaskType,
  resolveModelRoleForSurfaceAction,
} from "@/src/lib/ai/model-routing";
import { resolveCenterActionForTask } from "@/src/lib/ai/ai.center-routing";
import {
  resolveAiExecutionPolicy,
  resolveReasoningDirective,
  type AiActionClass,
  type AiResearchToolId,
  type AiExecutionPolicy,
} from "@/src/lib/ai/ai.policy";
import {
  ALIBABA_QWEN_CHARACTER_MODEL_ID,
  ALIBABA_QWEN_CODER_MODEL_ID,
  ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID,
  ALIBABA_QWEN_IMAGE_MODEL_ID,
  ALIBABA_QWEN_PLUS_MODEL_ID,
  ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
  CAVAI_AUTO_MODEL_ID,
} from "@/src/lib/ai/model-catalog";
import {
  buildSafeReasoningSummary,
  buildSemanticRepairDirective,
  buildSurfaceContextPack,
  classifyAiTaskType,
  evaluateAiAnswerQuality,
  formatReasoningDuration,
  shouldShowReasoningChip,
} from "@/src/lib/ai/ai.quality";
import { buildCavCodeRetryUserJson, buildCenterRetryUserJson } from "@/src/lib/ai/ai.retry";
import {
  AiProviderError,
  assertAiProviderReady,
  getAiProvider,
  resolveProviderIdForModel,
  type AiModelRole,
  type AiProviderReasoningEffort,
  type AiProviderGenerateResponse,
  type AiProviderMessage,
  type AiProviderTool,
} from "@/src/lib/ai/providers";
import {
  synthesizeAlibabaQwenSpeech,
  editAlibabaQwenImage,
  generateAlibabaQwenImage,
  transcribeAlibabaQwenAudio,
} from "@/src/lib/ai/providers/alibaba-qwen";
import { buildCavAiRouteContextPayload, resolveCavAiRouteAwareness } from "@/lib/cavai/pageAwareness";
import type { CavenCustomAgent } from "@/lib/cavai/cavenSettings.server";

type QwenCreditsModule = typeof import("@/src/lib/ai/qwen-coder-credits.server");
type CavCloudStorageModule = typeof import("@/lib/cavcloud/storage.server");
type ImageStudioModule = typeof import("@/lib/cavai/imageStudio.server");

const DEFAULT_CAVBOT_TTS_INSTRUCTIONS = "Voice profile: Cavbot Ethan. Adult male baritone voice, low and grounded. Keep delivery direct, calm, and confident with a steady pace and crisp diction. Start exactly on the first spoken word with no pre-roll. Maintain one consistent masculine tone across the entire response, including long paragraphs. No audible inhale, exhale, mouth noise, lip smack, hiss, gasp, breath, or sudden loud bursts. Keep the style plainspoken and studio-clean. Avoid bright or airy tone, playful cadence, sing-song inflection, theatrical emphasis, or dramatic pitch swings.";
const CAVBOT_ANSWER_QUALITY_DIRECTIVE = "Quality bar: answer the user's exact question directly, keep it relevant, avoid generic filler, and never invent facts, metrics, or citations.";
const CAVBOT_MODEL_BEHAVIOR_DIRECTIVE = "Model behavior: stay faithful to the selected model's strengths and natural style while meeting CavBot quality and safety requirements.";

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function clampText(value: unknown, max = 8_000): string {
  const raw = s(value);
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}...`;
}

function toStableJson(value: unknown, max = 24_000): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (!text) return "{}";
    return text.length <= max ? text : `${text.slice(0, max)}\n...`;
  } catch {
    return "{}";
  }
}

function parseProviderJson(text: string): unknown {
  const raw = s(text);
  if (!raw) throw new AiServiceError("INVALID_PROVIDER_JSON", "Provider returned empty JSON payload.", 502);
  const candidates: string[] = [];
  const pushCandidate = (value: unknown) => {
    const candidate = s(value);
    if (!candidate) return;
    if (candidates.includes(candidate)) return;
    candidates.push(candidate);
  };
  pushCandidate(raw);

  const singleFenceMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (singleFenceMatch?.[1]) pushCandidate(singleFenceMatch[1]);

  const inlineFenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (inlineFenceMatch?.[1]) pushCandidate(inlineFenceMatch[1]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // continue probing
    }
  }

  for (const candidate of candidates) {
    const objStart = candidate.indexOf("{");
    const objEnd = candidate.lastIndexOf("}");
    if (objStart >= 0 && objEnd > objStart) {
      const slicedObject = candidate.slice(objStart, objEnd + 1);
      try {
        return JSON.parse(slicedObject);
      } catch {
        // continue probing
      }
    }

    const arrStart = candidate.indexOf("[");
    const arrEnd = candidate.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) {
      const slicedArray = candidate.slice(arrStart, arrEnd + 1);
      try {
        return JSON.parse(slicedArray);
      } catch {
        // continue probing
      }
    }
  }

  throw new AiServiceError(
    "INVALID_PROVIDER_JSON",
    "Provider returned non-JSON content while JSON mode was required.",
    502
  );
}

function toRiskLevel(action: string): AiRiskLevel {
  const normalized = s(action).toLowerCase();
  if (normalized.includes("fix") || normalized.includes("anomaly") || normalized.includes("cluster")) {
    return "medium";
  }
  return "low";
}

function normalizePathLike(value: string): string {
  const input = s(value).replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!input) return "/";
  return input.startsWith("/") ? input : `/${input}`;
}

function isPathInsideRoot(filePath: string, rootPath: string): boolean {
  const normalizedFile = normalizePathLike(filePath);
  const normalizedRoot = normalizePathLike(rootPath);
  if (normalizedRoot === "/") return true;
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

function safeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const text = s(value);
    if (text) return text;
  }
  return "";
}

async function getQwenCreditsModule(): Promise<QwenCreditsModule> {
  return import("@/src/lib/ai/qwen-coder-credits.server");
}

async function estimateContextTokensForSnapshotSafe(payload: unknown): Promise<number> {
  try {
    const { estimateContextTokensForSnapshot } = await getQwenCreditsModule();
    return estimateContextTokensForSnapshot(payload);
  } catch {
    return 0;
  }
}

async function finalizeQwenCoderChargeSafe(
  args: Parameters<QwenCreditsModule["finalizeQwenCoderCharge"]>[0]
) {
  const { finalizeQwenCoderCharge } = await getQwenCreditsModule();
  return finalizeQwenCoderCharge(args);
}

async function refundOrAdjustQwenCoderChargeSafe(
  args: Parameters<QwenCreditsModule["refundOrAdjustQwenCoderCharge"]>[0]
) {
  const { refundOrAdjustQwenCoderCharge } = await getQwenCreditsModule();
  return refundOrAdjustQwenCoderCharge(args);
}

async function captureQwenCoderContextSnapshotSafe(
  args: Parameters<QwenCreditsModule["captureQwenCoderContextSnapshot"]>[0]
) {
  const { captureQwenCoderContextSnapshot } = await getQwenCreditsModule();
  return captureQwenCoderContextSnapshot(args);
}

async function getImageStudioModule(): Promise<ImageStudioModule> {
  return import("@/lib/cavai/imageStudio.server");
}

async function toImageStudioPlanTierSafe(planId: PlanId) {
  const { toImageStudioPlanTier } = await getImageStudioModule();
  return toImageStudioPlanTier(planId);
}

async function getImagePresetByIdSafe(
  args: Parameters<ImageStudioModule["getImagePresetById"]>[0]
) {
  const { getImagePresetById } = await getImageStudioModule();
  return getImagePresetById(args);
}

async function buildImageStudioPromptSafe(
  args: Parameters<ImageStudioModule["buildImageStudioPrompt"]>[0]
) {
  const { buildImageStudioPrompt } = await getImageStudioModule();
  return buildImageStudioPrompt(args);
}

async function resolveDataUrlForAssetSafe(
  args: Parameters<ImageStudioModule["resolveDataUrlForAsset"]>[0]
) {
  const { resolveDataUrlForAsset } = await getImageStudioModule();
  return resolveDataUrlForAsset(args);
}

async function startImageJobSafe(
  args: Parameters<ImageStudioModule["startImageJob"]>[0]
) {
  const { startImageJob } = await getImageStudioModule();
  return startImageJob(args);
}

async function createImageAssetSafe(
  args: Parameters<ImageStudioModule["createImageAsset"]>[0]
) {
  const { createImageAsset } = await getImageStudioModule();
  return createImageAsset(args);
}

async function appendUserImageHistorySafe(
  args: Parameters<ImageStudioModule["appendUserImageHistory"]>[0]
) {
  const { appendUserImageHistory } = await getImageStudioModule();
  return appendUserImageHistory(args);
}

async function completeImageJobSafe(
  args: Parameters<ImageStudioModule["completeImageJob"]>[0]
) {
  const { completeImageJob } = await getImageStudioModule();
  return completeImageJob(args);
}

async function failImageJobSafe(
  args: Parameters<ImageStudioModule["failImageJob"]>[0]
) {
  const { failImageJob } = await getImageStudioModule();
  return failImageJob(args);
}

async function getOrCreateFilePreviewSnippetsSafe(
  args: Parameters<CavCloudStorageModule["getOrCreateFilePreviewSnippets"]>[0]
) {
  const { getOrCreateFilePreviewSnippets } = await import("@/lib/cavcloud/storage.server");
  return getOrCreateFilePreviewSnippets(args);
}

async function retrieveRelevantAiUserMemoryFactsSafe(
  args: Parameters<typeof retrieveRelevantAiUserMemoryFacts>[0]
) {
  try {
    return await retrieveRelevantAiUserMemoryFacts(args);
  } catch {
    return [];
  }
}

async function learnAiUserMemoryFromPromptSafe(
  args: Parameters<typeof learnAiUserMemoryFromPrompt>[0]
) {
  try {
    await learnAiUserMemoryFromPrompt(args);
  } catch {
    // Memory persistence is best-effort on Cloudflare.
  }
}

async function settleCavCodeQueuedPromptSafe(
  args: Parameters<typeof settleCavCodeQueuedPrompt>[0]
) {
  try {
    await settleCavCodeQueuedPrompt(args);
  } catch {
    // Queue settlement is best-effort on Cloudflare.
  }
}

type UploadedWorkspaceFileContext = {
  id: string;
  cavcloudFileId: string | null;
  cavcloudPath: string | null;
  path: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  snippet: string | null;
};

const MAX_UPLOADED_WORKSPACE_FILES = 10;
const MAX_UPLOADED_WORKSPACE_FILE_SNIPPET_CHARS = 1_500;

function normalizeUploadedWorkspaceSnippet(value: unknown): string | null {
  const raw = String(value ?? "").replace(/\u0000/g, "").trim();
  if (!raw) return null;
  return raw.slice(0, MAX_UPLOADED_WORKSPACE_FILE_SNIPPET_CHARS);
}

function parseUploadedWorkspaceFilesContext(
  contextRaw: Record<string, unknown> | null | undefined
): UploadedWorkspaceFileContext[] {
  const context = safeRecord(contextRaw);
  const raw = Array.isArray(context.uploadedWorkspaceFiles)
    ? context.uploadedWorkspaceFiles
    : Array.isArray(context.uploadedFiles)
      ? context.uploadedFiles
      : [];
  if (!raw.length) return [];
  const out: UploadedWorkspaceFileContext[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const cavcloudFileId = s(row.cavcloudFileId) || s(row.id);
    const cavcloudPath = s(row.cavcloudPath) || null;
    const path = s(row.path) || null;
    const name = s(row.name) || (cavcloudPath ? cavcloudPath.split("/").filter(Boolean).pop() || "file" : "file");
    const mimeType = s(row.mimeType) || "application/octet-stream";
    const sizeBytes = Math.max(1, Math.trunc(Number(row.sizeBytes) || 1));
    const snippet = normalizeUploadedWorkspaceSnippet(row.snippet);
    if (!cavcloudFileId && !cavcloudPath && !path) continue;
    out.push({
      id: cavcloudFileId || cavcloudPath || path || name,
      cavcloudFileId: cavcloudFileId || null,
      cavcloudPath,
      path,
      name,
      mimeType,
      sizeBytes,
      snippet,
    });
    if (out.length >= MAX_UPLOADED_WORKSPACE_FILES) break;
  }
  return out;
}

function normalizeFilePathForLookup(value: string | null | undefined): string {
  const raw = s(value).replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!raw) return "";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

async function resolveUploadedWorkspaceFilesForAi(args: {
  accountId: string;
  context: Record<string, unknown> | null | undefined;
}): Promise<UploadedWorkspaceFileContext[]> {
  const requested = parseUploadedWorkspaceFilesContext(args.context);
  if (!requested.length) return [];

  const fileIds = Array.from(
    new Set(requested.map((item) => s(item.cavcloudFileId)).filter(Boolean))
  ).slice(0, MAX_UPLOADED_WORKSPACE_FILES);
  const filePaths = Array.from(
    new Set(
      requested
        .map((item) => normalizeFilePathForLookup(item.cavcloudPath || item.path))
        .filter(Boolean)
    )
  ).slice(0, MAX_UPLOADED_WORKSPACE_FILES);

  let fileRows: Array<{
    id: string;
    name: string;
    path: string;
    mimeType: string;
    bytes: number | bigint;
    previewSnippet: string | null;
    previewSnippetUpdatedAt: Date | null;
  }> = [];
  try {
    const values: unknown[] = [args.accountId];
    const selectors: string[] = [];
    if (fileIds.length) {
      values.push(fileIds);
      selectors.push(`"id" = ANY($${values.length}::text[])`);
    }
    if (filePaths.length) {
      values.push(filePaths);
      selectors.push(`"path" = ANY($${values.length}::text[])`);
    }
    if (!selectors.length) {
      return requested.slice(0, MAX_UPLOADED_WORKSPACE_FILES);
    }
    const result = await getAuthPool().query<{
      id: string;
      name: string;
      path: string;
      mimeType: string;
      bytes: number | string;
      previewSnippet: string | null;
      previewSnippetUpdatedAt: Date | null;
    }>(
      `SELECT
          "id",
          "name",
          "path",
          "mimeType",
          "bytes",
          "previewSnippet",
          "previewSnippetUpdatedAt"
        FROM "CavCloudFile"
        WHERE "accountId" = $1
          AND "deletedAt" IS NULL
          AND "status" = 'READY'
          AND (${selectors.join(" OR ")})`,
      values
    );
    fileRows = result.rows.map((row) => ({
      ...row,
      bytes: Number(row.bytes || 0),
    }));
  } catch {
    return requested.slice(0, MAX_UPLOADED_WORKSPACE_FILES);
  }

  const byId = new Map<string, (typeof fileRows)[number]>();
  const byPath = new Map<string, (typeof fileRows)[number]>();
  for (const row of fileRows) {
    byId.set(row.id, row);
    byPath.set(normalizeFilePathForLookup(row.path), row);
  }

  const resolved = requested.map((item) => {
    const lookupPath = normalizeFilePathForLookup(item.cavcloudPath || item.path);
    const fileRow = byId.get(s(item.cavcloudFileId)) || byPath.get(lookupPath);
    const resolvedCavcloudFileId = s(fileRow?.id) || s(item.cavcloudFileId) || null;
    const snippet = normalizeUploadedWorkspaceSnippet(fileRow?.previewSnippet) || item.snippet || null;
    return {
      ...item,
      id: resolvedCavcloudFileId || item.id,
      cavcloudFileId: resolvedCavcloudFileId,
      cavcloudPath: s(fileRow?.path) || item.cavcloudPath || null,
      path: s(fileRow?.path) || item.path || null,
      name: s(fileRow?.name) || item.name,
      mimeType: s(fileRow?.mimeType) || item.mimeType,
      sizeBytes: Math.max(1, Math.trunc(Number(fileRow?.bytes) || item.sizeBytes || 1)),
      snippet,
    } satisfies UploadedWorkspaceFileContext;
  });

  const missingSnippetFileIds = Array.from(
    new Set(
      resolved
        .filter((item) => !item.snippet && s(item.cavcloudFileId))
        .map((item) => s(item.cavcloudFileId))
        .filter(Boolean)
    )
  ).slice(0, MAX_UPLOADED_WORKSPACE_FILES);

  if (missingSnippetFileIds.length) {
    try {
      const snippetMap = await getOrCreateFilePreviewSnippetsSafe({
        accountId: args.accountId,
        fileIds: missingSnippetFileIds,
        maxBatch: MAX_UPLOADED_WORKSPACE_FILES,
      });
      for (const row of resolved) {
        if (row.snippet) continue;
        const fileId = s(row.cavcloudFileId);
        if (!fileId) continue;
        row.snippet = normalizeUploadedWorkspaceSnippet(snippetMap[fileId]);
      }
    } catch {
      // Best effort: use persisted snippets when available.
    }
  }

  return resolved.slice(0, MAX_UPLOADED_WORKSPACE_FILES);
}

async function resolveInstalledCavenCustomAgentSafe(args: {
  accountId: string;
  userId: string;
  runtimeSurface: "cavcode" | "center";
  agentId?: string | null;
  agentActionKey?: string | null;
}): Promise<CavenCustomAgent | null> {
  try {
    const { resolveInstalledCavenCustomAgent } = await import("@/lib/cavai/cavenSettings.server");
    return await resolveInstalledCavenCustomAgent(args);
  } catch {
    return null;
  }
}

async function resolveInstalledCavCodeActionSafe(args: {
  accountId: string;
  userId: string;
  planId?: PlanId;
  requestedAction: string;
}): Promise<{ action: string; downgraded: boolean }> {
  try {
    const { resolveInstalledCavCodeAction } = await import("@/lib/cavai/agentRegistry.server");
    return await resolveInstalledCavCodeAction({
      accountId: args.accountId,
      userId: args.userId,
      planId: args.planId,
      requestedAction: args.requestedAction,
    });
  } catch {
    return {
      action: s(args.requestedAction).toLowerCase(),
      downgraded: false,
    };
  }
}

function resolveRouteAwarenessContext(args: {
  req: Request;
  inputContext?: Record<string, unknown> | null;
  origin?: string | null;
  contextLabel?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
}): Record<string, unknown> {
  const context = safeRecord(args.inputContext);
  const referer = s(args.req.headers.get("referer"));
  const pathname = firstNonEmptyString(
    context.routePathname,
    context.pathname,
    context.currentPathname,
    context.path,
    context.urlPath
  );
  const search = firstNonEmptyString(
    context.routeSearch,
    context.search,
    context.query
  );
  const routeParams = safeRecord(context.routeParams);
  const awareness = resolveCavAiRouteAwareness({
    pathname: pathname || undefined,
    search: search || undefined,
    origin: firstNonEmptyString(args.origin, context.origin, referer) || undefined,
    workspaceId: firstNonEmptyString(args.workspaceId, context.workspaceId) || undefined,
    projectId: Number.isFinite(Number(args.projectId))
      ? Number(args.projectId)
      : (Number.isFinite(Number(context.projectId)) ? Number(context.projectId) : undefined),
    siteId: firstNonEmptyString(context.siteId, context.site) || undefined,
    routeParams: routeParams,
    contextLabel: firstNonEmptyString(args.contextLabel, context.contextLabel) || undefined,
  });
  return buildCavAiRouteContextPayload(awareness);
}

function isWebsiteAwareTask(taskType: ReturnType<typeof classifyAiTaskType>): boolean {
  return (
    taskType === "seo"
    || taskType === "keyword_research"
    || taskType === "content_brief"
    || taskType === "website_improvement"
    || taskType === "seo_help"
    || taskType === "dashboard_diagnostics"
    || taskType === "dashboard_error_explanation"
  );
}

function promptRequestsWebsiteIntelligence(prompt: string, goal?: string | null): boolean {
  const text = `${s(prompt)} ${s(goal)}`.toLowerCase();
  if (!text) return false;
  return (
    text.includes("website")
    || text.includes("homepage")
    || text.includes("landing page")
    || text.includes("site map")
    || text.includes("sitemap")
    || text.includes("title tag")
    || text.includes("meta description")
    || text.includes("schema")
    || text.includes("robots")
    || text.includes("crawl")
    || text.includes("broken link")
    || text.includes("underperform")
    || text.includes("seo")
  );
}

async function loadWebsiteKnowledgeContext(args: {
  accountId: string;
  projectId?: number | null;
  workspaceId?: string | null;
  routeAwareContext?: Record<string, unknown> | null;
}): Promise<Record<string, unknown> | null> {
  const projectId = Number.isFinite(Number(args.projectId)) ? Number(args.projectId) : null;
  const routeContext = safeRecord(args.routeAwareContext);
  const siteIdFromRoute = firstNonEmptyString(routeContext.siteId, routeContext.routeParams && safeRecord(routeContext.routeParams).siteId);
  const {
    getLatestWebsiteKnowledgeGraph,
    summarizeWebsiteKnowledgeForAiContext,
  } = await import("@/lib/cavai/websiteKnowledge.server");
  const latest = await getLatestWebsiteKnowledgeGraph({
    accountId: args.accountId,
    projectId,
    workspaceId: s(args.workspaceId) || null,
    siteId: siteIdFromRoute || null,
  });
  if (!latest) return null;
  return {
    graphId: latest.id,
    graphCreatedAt: latest.createdAt,
    ...summarizeWebsiteKnowledgeForAiContext(latest.graph),
  };
}

async function loadRouteManifestCoverageContext(args: {
  accountId: string;
  workspaceId?: string | null;
  projectId?: number | null;
}): Promise<Record<string, unknown> | null> {
  const { listCavAiRouteManifestSnapshots } = await import("@/lib/cavai/routeManifest.server");
  const rows = await listCavAiRouteManifestSnapshots({
    accountId: args.accountId,
    workspaceId: s(args.workspaceId) || null,
    projectId: Number.isFinite(Number(args.projectId)) ? Number(args.projectId) : null,
    limit: 1,
  });
  const row = rows[0];
  if (!row) return null;
  return {
    snapshotId: row.id,
    createdAt: row.createdAt,
    routeCount: row.routeCount,
    coveredCount: row.coveredCount,
    heuristicCount: row.heuristicCount,
    uncoveredCount: row.uncoveredCount,
    adapterCoverageRate: row.adapterCoverageRate,
    manifestVersion: row.manifestVersion,
  };
}

async function loadRouteAndWebsiteContextEnrichments(args: {
  accountId: string;
  userId: string;
  sessionId?: string | null;
  requestId: string;
  surface: AiSurface | "center";
  action: string;
  taskType: ReturnType<typeof classifyAiTaskType>;
  prompt: string;
  goal?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  routeAwareContext?: Record<string, unknown> | null;
}): Promise<{
  routeManifestCoverageContext: Record<string, unknown> | null;
  websiteKnowledgeContext: Record<string, unknown> | null;
}> {
  let routeManifestCoverageContext: Record<string, unknown> | null = null;
  const routeSiteId = s(safeRecord(args.routeAwareContext).siteId) || null;

  try {
    const started = Date.now();
    routeManifestCoverageContext = await loadRouteManifestCoverageContext({
      accountId: args.accountId,
      workspaceId: args.workspaceId || null,
      projectId: args.projectId || null,
    });
    if (routeManifestCoverageContext) {
      await persistAiToolCallTrace({
        accountId: args.accountId,
        userId: args.userId,
        sessionId: s(args.sessionId) || null,
        requestId: args.requestId,
        surface: args.surface,
        action: args.action,
        toolId: "route_manifest_reader",
        status: "success",
        latencyMs: Date.now() - started,
        inputJson: {
          workspaceId: args.workspaceId || null,
          projectId: args.projectId || null,
        },
        outputJson: {
          snapshotId: s(routeManifestCoverageContext.snapshotId) || null,
          routeCount: Number(routeManifestCoverageContext.routeCount || 0),
          uncoveredCount: Number(routeManifestCoverageContext.uncoveredCount || 0),
          adapterCoverageRate: Number(routeManifestCoverageContext.adapterCoverageRate || 0),
          manifestVersion: s(routeManifestCoverageContext.manifestVersion) || null,
        },
      });
    }
  } catch (error) {
    await persistAiToolCallTrace({
      accountId: args.accountId,
      userId: args.userId,
      sessionId: s(args.sessionId) || null,
      requestId: args.requestId,
      surface: args.surface,
      action: args.action,
      toolId: "route_manifest_reader",
      status: "error",
      errorCode: error instanceof Error ? error.name || "ROUTE_MANIFEST_CONTEXT_FAILED" : "ROUTE_MANIFEST_CONTEXT_FAILED",
      inputJson: {
        workspaceId: args.workspaceId || null,
        projectId: args.projectId || null,
      },
    });
  }

  const shouldLoadWebsiteKnowledge =
    isWebsiteAwareTask(args.taskType)
    || promptRequestsWebsiteIntelligence(args.prompt, args.goal || null)
    || s(safeRecord(args.routeAwareContext).routeCategory).toLowerCase() === "seo";

  let websiteKnowledgeContext: Record<string, unknown> | null = null;
  if (shouldLoadWebsiteKnowledge) {
    try {
      const started = Date.now();
      websiteKnowledgeContext = await loadWebsiteKnowledgeContext({
        accountId: args.accountId,
        projectId: args.projectId || null,
        workspaceId: args.workspaceId || null,
        routeAwareContext: args.routeAwareContext || null,
      });
      if (websiteKnowledgeContext) {
        await persistAiToolCallTrace({
          accountId: args.accountId,
          userId: args.userId,
          sessionId: s(args.sessionId) || null,
          requestId: args.requestId,
          surface: args.surface,
          action: args.action,
          toolId: "website_knowledge_reader",
          status: "success",
          latencyMs: Date.now() - started,
          inputJson: {
            workspaceId: args.workspaceId || null,
            projectId: args.projectId || null,
            siteId: routeSiteId,
          },
          outputJson: {
            graphId: s(websiteKnowledgeContext.graphId) || null,
            graphCreatedAt: s(websiteKnowledgeContext.graphCreatedAt) || null,
            site: safeRecord(websiteKnowledgeContext.site),
            metrics: safeRecord(websiteKnowledgeContext.metrics),
            topOpportunities: Array.isArray(websiteKnowledgeContext.topOpportunities)
              ? (websiteKnowledgeContext.topOpportunities as unknown[]).slice(0, 6)
              : [],
          },
        });
      }
    } catch (error) {
      await persistAiToolCallTrace({
        accountId: args.accountId,
        userId: args.userId,
        sessionId: s(args.sessionId) || null,
        requestId: args.requestId,
        surface: args.surface,
        action: args.action,
        toolId: "website_knowledge_reader",
        status: "error",
        errorCode: error instanceof Error ? error.name || "WEBSITE_KNOWLEDGE_CONTEXT_FAILED" : "WEBSITE_KNOWLEDGE_CONTEXT_FAILED",
        inputJson: {
          workspaceId: args.workspaceId || null,
          projectId: args.projectId || null,
          siteId: routeSiteId,
        },
      });
    }
  }

  return {
    routeManifestCoverageContext,
    websiteKnowledgeContext,
  };
}

function resolveReasoningProfile(levelRaw: unknown, role: AiModelRole): {
  level: "low" | "medium" | "high" | "extra_high";
  maxTokens: number;
  timeoutMs: number;
  maxOutputChars: number;
} {
  const normalized = s(levelRaw).toLowerCase();
  const level =
    normalized === "low" || normalized === "high" || normalized === "extra_high" || normalized === "medium"
      ? normalized
      : "medium";

  if (role !== "reasoning") {
    if (level === "low") return { level, maxTokens: 900, timeoutMs: 20_000, maxOutputChars: 8_000 };
    if (level === "high") return { level, maxTokens: 1_800, timeoutMs: 32_000, maxOutputChars: 14_000 };
    if (level === "extra_high") return { level, maxTokens: 2_200, timeoutMs: 40_000, maxOutputChars: 18_000 };
    return { level, maxTokens: 1_300, timeoutMs: 26_000, maxOutputChars: 10_000 };
  }

  if (level === "low") return { level, maxTokens: 1_100, timeoutMs: 28_000, maxOutputChars: 10_000 };
  if (level === "high") return { level, maxTokens: 2_500, timeoutMs: 52_000, maxOutputChars: 20_000 };
  if (level === "extra_high") return { level, maxTokens: 3_200, timeoutMs: 70_000, maxOutputChars: 26_000 };
  return { level, maxTokens: 1_900, timeoutMs: 38_000, maxOutputChars: 14_000 };
}

function resolveCenterReasoningProfile(args: {
  levelRaw: unknown;
  role: AiModelRole;
  researchMode: boolean;
}): {
  level: "low" | "medium" | "high" | "extra_high";
  maxTokens: number;
  timeoutMs: number;
  maxOutputChars: number;
} {
  if (!args.researchMode) {
    return resolveReasoningProfile(args.levelRaw, args.role);
  }
  const normalized = s(args.levelRaw).toLowerCase();
  const level =
    normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "extra_high"
      ? normalized
      : "medium";

  if (level === "low") return { level, maxTokens: 1_600, timeoutMs: 34_000, maxOutputChars: 12_000 };
  if (level === "high") return { level, maxTokens: 4_200, timeoutMs: 100_000, maxOutputChars: 34_000 };
  if (level === "extra_high") return { level, maxTokens: 5_500, timeoutMs: 125_000, maxOutputChars: 44_000 };
  return { level, maxTokens: 2_700, timeoutMs: 68_000, maxOutputChars: 22_000 };
}

function reasoningEffortForLevel(level: "low" | "medium" | "high" | "extra_high"): AiProviderReasoningEffort {
  if (level === "low") return "low";
  if (level === "medium") return "medium";
  return "high";
}

function asResearchProviderTools(bundle: AiResearchToolId[]): AiProviderTool[] {
  return bundle.map((id) => ({
    id,
    description:
      id === "web_search"
        ? "Find high-quality web sources for the research question."
        : id === "web_extractor"
          ? "Extract relevant evidence from source pages."
          : "Run code-based analysis on gathered research evidence.",
  }));
}

function usageFromResponse(response: AiProviderGenerateResponse) {
  return {
    promptTokens: response.usage.promptTokens,
    completionTokens: response.usage.completionTokens,
    totalTokens: response.usage.totalTokens,
  };
}

function listOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => s(item)).filter(Boolean);
}

function textFromStructuredOutput(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return s(value);
  const row = value as Record<string, unknown>;
  const chunks: string[] = [];
  for (const key of ["summary", "answer", "proposedCode", "risk"]) {
    const text = s(row[key]);
    if (text) chunks.push(text);
  }
  for (const key of ["changes", "notes", "followUpChecks", "recommendations", "evidenceRefs", "keyFindings", "suggestedNextActions"]) {
    const values = listOfStrings(row[key]);
    if (values.length) chunks.push(values.join("\n"));
  }
  if (Array.isArray(row.sources)) {
    for (const source of row.sources) {
      if (!source || typeof source !== "object" || Array.isArray(source)) continue;
      const rec = source as Record<string, unknown>;
      const sourceLine = [s(rec.title), s(rec.url), s(rec.note)].filter(Boolean).join(" ");
      if (sourceLine) chunks.push(sourceLine);
    }
  }
  return chunks.join("\n").trim();
}

function isCodeTaskType(taskType: ReturnType<typeof classifyAiTaskType>): boolean {
  return (
    taskType === "code_generate"
    || taskType === "code_explain"
    || taskType === "code_fix"
    || taskType === "code_refactor"
    || taskType === "code_plan"
    || taskType === "code_review"
    || taskType === "patch_proposal"
    || taskType === "code_generation"
    || taskType === "code_explanation"
  );
}

function toQwenComplexity(args: {
  actionClass: AiActionClass;
  taskType: ReturnType<typeof classifyAiTaskType>;
}): "small" | "medium" | "heavy" | "agentic" {
  if (
    args.actionClass === "premium_plus_heavy_coding"
    || args.taskType === "code_refactor"
    || args.taskType === "code_review"
  ) {
    return "heavy";
  }
  if (
    args.taskType === "code_generate"
    || args.taskType === "code_fix"
    || args.taskType === "patch_proposal"
    || args.taskType === "code_plan"
  ) {
    return "medium";
  }
  return "small";
}

function hasCheck(items: string[], matcher: RegExp): boolean {
  return items.some((item) => matcher.test(s(item).toLowerCase()));
}

function safeFallbackAnswer(args: {
  taskType: ReturnType<typeof classifyAiTaskType>;
  prompt: string;
  goal?: string | null;
  actionClass?: AiActionClass | null;
}): string {
  const prompt = s(args.prompt);
  const goal = s(args.goal);
  const full = `${prompt} ${goal}`.toLowerCase();
  if (args.actionClass === "companion_chat") {
    return [
      "I hear you.",
      "I am CavBot Companion: a calm, practical AI partner for clarity, decisions, and momentum.",
      "I can talk things through, help you reset when stressed, and turn what you are facing into concrete next steps.",
    ].join(" ");
  }
  if (args.taskType === "writing" || args.taskType === "rewrite" || args.taskType === "title_improvement" || args.taskType === "note_writing" || args.taskType === "note_rewrite") {
    if (full.includes("birthday")) {
      return "Happy birthday! Wishing you a year full of health, peace, and real progress on everything that matters most to you.";
    }
    return "Here is a clean draft aligned to your request. If you want, I can produce short, medium, or formal variants next.";
  }
  if (args.taskType === "planning" || args.taskType === "productivity" || args.taskType === "strategy" || args.taskType === "decision_support") {
    return [
      "Plan:",
      "1. Define the target outcome and constraints.",
      "2. Break work into prioritized steps.",
      "3. Execute the first step immediately, then review progress.",
    ].join("\n");
  }
  if (args.taskType === "research" || args.taskType === "keyword_research" || args.taskType === "seo" || args.taskType === "website_improvement" || args.taskType === "content_brief") {
    return "I could not confidently return a high-fidelity researched result on the first pass. Treat this as heuristic guidance; I can rerun with stricter source constraints.";
  }
  if (args.taskType === "tutoring" || args.taskType === "explanation" || args.taskType === "comparison") {
    return "I can explain this clearly step-by-step. Share the exact concept or options you want compared and I will return a structured breakdown.";
  }
  const lead = s(prompt).replace(/\s+/g, " ").slice(0, 140);
  if (lead) {
    return `I understood your request: "${lead}". I can answer directly, break it into steps, or draft it in your preferred style.`;
  }
  return "I can help with this request. Tell me if you want a direct answer, a step-by-step plan, or a drafted version.";
}

function buildSafeCenterFallbackResponse(args: {
  taskType: ReturnType<typeof classifyAiTaskType>;
  prompt: string;
  goal?: string | null;
  actionClass?: AiActionClass | null;
  researchMode: boolean;
  model: string;
  reasoningLevel: "low" | "medium" | "high" | "extra_high";
  researchToolBundle: AiResearchToolId[];
}): AiCenterAssistResponse {
  const answer = safeFallbackAnswer({
    taskType: args.taskType,
    prompt: args.prompt,
    goal: args.goal,
    actionClass: args.actionClass,
  });
  const response: AiCenterAssistResponse = {
    summary: "Safe fallback response delivered to keep the request unblocked.",
    risk: "low",
    answer,
    recommendations: [
      "Refine the target output format for a tighter result.",
      "Include any required constraints (tone, length, scope).",
    ],
    notes: [
      "Fallback mode avoided a blank, failed, or low-confidence response.",
    ],
    followUpChecks: [
      "Retry with a more explicit target format if needed.",
    ],
    evidenceRefs: [],
  };
  if (args.researchMode) {
    response.researchMode = true;
    response.researchProfile = {
      model: args.model,
      reasoningLevel: args.reasoningLevel,
      toolBundle: args.researchToolBundle,
    };
    response.keyFindings = [
      "Fallback mode preserved reliability when initial semantic checks failed.",
    ];
    response.suggestedNextActions = [
      "Rerun in research mode with explicit URL/source constraints.",
    ];
  }
  return response;
}

function buildSafeSurfaceFallbackResponse(args: {
  surface: AiSurface;
  taskType: ReturnType<typeof classifyAiTaskType>;
}): SurfaceAssistResponse {
  if (args.surface === "cavcloud") {
    return {
      summary: "Fallback CavCloud guidance generated after semantic validation retry.",
      risk: "low",
      recommendations: [
        "Group artifacts by project and lifecycle stage.",
        "Use consistent naming and archive stale folders.",
      ],
      notes: ["Fallback mode used to prevent a failed response."],
      followUpChecks: ["Confirm retention and ownership labels are consistent."],
      evidenceRefs: [],
    };
  }
  if (args.surface === "cavsafe") {
    return {
      summary: "Fallback CavSafe guidance generated after semantic validation retry.",
      risk: "low",
      recommendations: [
        "Review access policy scope and least-privilege defaults.",
        "Audit private-share permissions and expiration rules.",
      ],
      notes: ["Fallback mode used to prevent a failed response."],
      followUpChecks: ["Confirm policy changes are reflected in audit logs."],
      evidenceRefs: [],
    };
  }
  if (args.surface === "cavpad") {
    return {
      summary: "Fallback CavPad guidance generated after semantic validation retry.",
      risk: "low",
      recommendations: [
        "Use clear section headings and action bullets.",
        "Separate facts, decisions, and next steps.",
      ],
      notes: ["Fallback mode used to prevent a failed response."],
      followUpChecks: ["Confirm the final note preserves original intent and facts."],
      evidenceRefs: [],
    };
  }
  return {
    summary: "Fallback console guidance generated after semantic validation retry.",
    risk: "low",
    recommendations: [
      "Prioritize the highest-impact anomaly first.",
      "Correlate errors with recent deploys and dependency changes.",
    ],
    notes: ["Fallback mode used to prevent a failed response."],
    followUpChecks: ["Validate the remediation with fresh telemetry after changes."],
    evidenceRefs: [],
  };
}

function buildSafeCavCodeFallbackResponse(args: {
  input: CavCodeAssistRequest;
}): CavCodeAssistResponse {
  const language = s(args.input.language).toLowerCase();
  const filePath = s(args.input.filePath) || "target-file";
  const selectedCode = clampText(args.input.selectedCode || "", 20_000);
  const primaryDiagnostic = s(args.input.diagnostics?.[0]?.message);

  let proposedCode = selectedCode;
  if (!proposedCode) {
    if (language.includes("typescript") || language === "ts" || filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      proposedCode = [
        "export function safeRefactor(input: string): string {",
        "  return input.trim();",
        "}",
      ].join("\n");
    } else if (language.includes("javascript") || language === "js" || filePath.endsWith(".js") || filePath.endsWith(".jsx")) {
      proposedCode = [
        "export function safeRefactor(input) {",
        "  return String(input).trim();",
        "}",
      ].join("\n");
    } else if (language.includes("html") || filePath.endsWith(".html")) {
      proposedCode = [
        "<section class=\"content\">",
        "  <h1>Updated Section</h1>",
        "  <p>Replace this placeholder with requested content.</p>",
        "</section>",
      ].join("\n");
    } else if (language.includes("css") || filePath.endsWith(".css")) {
      proposedCode = [
        ".component {",
        "  display: block;",
        "  margin: 0;",
        "}",
      ].join("\n");
    } else {
      proposedCode = [
        "// Add the requested change in this file.",
        "function safeRefactor(value) {",
        "  return value;",
        "}",
      ].join("\n");
    }
  }

  return {
    summary: "Fallback CavCode response generated to keep the request unblocked.",
    risk: primaryDiagnostic ? "medium" : "low",
    changes: [
      `Focused the response on code for file ${filePath}.`,
      "Returned concrete code to keep the coding workflow unblocked.",
    ],
    proposedCode,
    notes: [
      "Deterministic fallback was used to keep the coding request unblocked.",
      primaryDiagnostic ? `Primary diagnostic: ${primaryDiagnostic}` : "No diagnostic details were provided.",
    ],
    followUpChecks: [
      "Run local lint/typecheck/tests for this file.",
      "Review and approve the patch/diff before applying file changes.",
    ],
    targetFilePath: filePath,
  };
}

function shouldAttemptSemanticRepair(args: {
  quality: ReturnType<typeof evaluateAiAnswerQuality>;
  answerText: string;
  startedAtMs: number;
  maxExecutionTimeMs: number;
  minimumUsefulChars: number;
  force?: boolean;
}): boolean {
  if (args.force) return true;
  if (args.quality.hardFail) return true;
  const remainingMs = Math.max(0, args.maxExecutionTimeMs - (Date.now() - args.startedAtMs));
  if (remainingMs < 12_000) return false;
  return s(args.answerText).length < args.minimumUsefulChars;
}

function shouldReturnSafeFallbackOnProviderFailure(error: AiServiceError): boolean {
  const code = s(error.code).toUpperCase();
  return (
    code === "INVALID_PROVIDER_JSON"
    || code === "INVALID_PROVIDER_SHAPE"
    || code.includes("TIMEOUT")
    || code.includes("NETWORK_ERROR")
    || error.status === 504
  );
}

function buildExecutionMeta(args: {
  startedAtMs: number;
  surface: string;
  action: string;
  actionClass: AiActionClass;
  prompt: string;
  model: string;
  providerId: string;
  reasoningLevel: "low" | "medium" | "high" | "extra_high";
  taskType: ReturnType<typeof classifyAiTaskType>;
  researchMode: boolean;
  contextSignals: string[];
  quality: ReturnType<typeof evaluateAiAnswerQuality>;
  repairAttempted: boolean;
  repairApplied: boolean;
  checksPerformed: string[];
  answerPath: string[];
}): AiExecutionMeta {
  const durationMs = Math.max(0, Date.now() - args.startedAtMs);
  const durationLabel = formatReasoningDuration(durationMs);
  const showReasoningChip = shouldShowReasoningChip({
    model: args.model,
    reasoningLevel: args.reasoningLevel,
    taskType: args.taskType,
    durationMs,
    researchMode: args.researchMode,
  });
  const reasoningLabel = showReasoningChip ? `Reasoned in ${durationLabel}` : "Reasoned";
  const safeSummary = buildSafeReasoningSummary({
    prompt: args.prompt,
    taskType: args.taskType,
    contextSignals: args.contextSignals,
    checksPerformed: args.checksPerformed,
    answerPath: args.answerPath,
    quality: args.quality,
    repairAttempted: args.repairAttempted,
    repairApplied: args.repairApplied,
    researchMode: args.researchMode,
  });

  return {
    durationMs,
    durationLabel,
    showReasoningChip,
    reasoningLabel,
    taskType: args.taskType,
    surface: args.surface,
    action: args.action,
    actionClass: args.actionClass,
    providerId: args.providerId,
    model: args.model,
    reasoningLevel: args.reasoningLevel,
    researchMode: args.researchMode,
    repairAttempted: args.repairAttempted,
    repairApplied: args.repairApplied,
    contextSignals: args.contextSignals,
    quality: {
      relevanceToRequest: args.quality.relevanceToRequest,
      relevanceToSurface: args.quality.relevanceToSurface,
      productTruth: args.quality.productTruth,
      actionability: args.quality.actionability,
      coherence: args.quality.coherence,
      scopeAlignment: args.quality.scopeAlignment,
      hallucinationRisk: args.quality.hallucinationRisk,
      overall: args.quality.overall,
      passed: args.quality.passed,
      reasons: args.quality.reasons.slice(0, 8),
    },
    safeSummary,
  };
}

async function loadCenterSessionHistoryContext(args: {
  accountId: string;
  sessionId?: string | null;
  maxMessages?: number;
}): Promise<Array<{ role: "user" | "assistant"; action: string | null; text: string }>> {
  const sessionId = s(args.sessionId);
  if (!sessionId) return [];

  try {
    const rows = await listAiSessionMessages({
      accountId: args.accountId,
      sessionId,
      limit: Math.max(2, Math.min(24, Math.trunc(Number(args.maxMessages || 10)))),
    });
    if (!rows.length) return [];
    return rows
      .slice(-Math.max(2, Math.min(12, Math.trunc(Number(args.maxMessages || 10)))))
      .map((row) => ({
        role: row.role,
        action: row.action || null,
        text: clampText(row.contentText, 1_200),
      }))
      .filter((row) => Boolean(s(row.text)));
  } catch {
    return [];
  }
}

function centerCompanionDirective(args: {
  surface: AiCenterSurface;
  action: AiCenterAssistAction;
  actionClass: AiActionClass;
  taskType: ReturnType<typeof classifyAiTaskType>;
  model?: string | null;
}): string[] {
  const action = s(args.action).toLowerCase();
  const companionActionSet = new Set<string>([
    "companion_chat",
    "financial_advisor",
    "therapist_support",
    "mentor",
    "best_friend",
    "relationship_advisor",
    "philosopher",
    "focus_coach",
    "life_strategist",
  ]);
  const isCompanionLane =
    s(args.model) === ALIBABA_QWEN_CHARACTER_MODEL_ID
    || args.actionClass === "companion_chat"
    || companionActionSet.has(action);
  const lines: string[] = [];
  if (isCompanionLane) {
    lines.push("You are CavBot Companion, the calm relational layer of CavBot.");
    lines.push("Voice and tone: warm, steady, emotionally intelligent, concise, grounded, clear male energy, no melodrama.");
    lines.push("Stay founder-aware and product-aware when context mentions startup pressure, launches, roadmap, burnout, or execution strain.");
    lines.push("Do not claim to be human, conscious, sentient, or a literal family member.");
    lines.push("Do not be manipulative, clingy, dependency-seeking, or guilt-inducing.");
    lines.push("Do not invent product facts, memories, or capabilities.");
    lines.push("Use provided context and memory carefully: remember what matters, avoid creepy repetition, respect boundaries.");
    lines.push("When uncertain about product specifics, state uncertainty clearly and ask a tight clarifying question.");
    lines.push("Always move toward practical next actions, not vague comfort-only replies.");
  }

  if (action === "financial_advisor") {
    lines.push("Financial Advisor mode: focus on budgeting, prioritization, risk awareness, and tradeoff clarity.");
    lines.push("Never claim licensed financial advisory authority and never guarantee investment outcomes.");
  } else if (action === "therapist_support") {
    lines.push("Therapist Support mode: provide reflective grounding and emotional processing support.");
    lines.push("Never claim licensed therapeutic authority. If crisis risk appears, prioritize safety and real-world support resources.");
  } else if (action === "mentor") {
    lines.push("Mentor mode: emphasize discipline, pattern recognition, accountability, and high-leverage next moves.");
  } else if (action === "best_friend") {
    lines.push("Best Friend mode: be warm and direct, caring and honest, supportive without becoming unserious.");
  } else if (action === "relationship_advisor") {
    lines.push("Relationship Advisor mode: center communication clarity, perspective-taking, and balanced conflict framing.");
    lines.push("Avoid reckless certainty; provide nuanced options and likely consequences.");
  } else if (action === "philosopher") {
    lines.push("Philosopher mode: offer perspective and meaning framing while still connecting insights to action.");
  } else if (action === "focus_coach") {
    lines.push("Focus Coach mode: reduce cognitive noise, force prioritization, and end with one concrete next action.");
  } else if (action === "life_strategist") {
    lines.push("Life Strategist mode: connect life and work priorities with realistic sequencing, constraints, and momentum plans.");
  } else if (action === "email_text_agent") {
    lines.push("Email/Text Agent mode: produce immediately usable drafts and rewrites with explicit tone options.");
  } else if (action === "content_creator") {
    lines.push("Content Creator mode: generate structured copy (titles, subtitles, sections, paragraphs) ready for website/content surfaces.");
  } else if (action === "legal_privacy_terms_ethics_agent") {
    lines.push("Legal/Privacy/Terms/Ethics mode: draft policy-style language with clear legal-review caveats.");
    lines.push("Never claim legal licensure or final legal authority.");
  } else if (action === "pdf_create_edit_preview_agent") {
    lines.push("PDF mode: structure responses so content can be created, edited, and previewed as document-ready output.");
  } else if (action === "page_404_builder_agent") {
    lines.push("404 Builder mode: provide clear not-found UX copy and route/page implementation guidance.");
  } else if (action === "doc_edit_review_agent") {
    lines.push("Doc Edit/Review mode: improve clarity, structure, tone, and readability while preserving intent.");
  }
  if (args.surface === "general" || args.surface === "workspace") {
    if (isCompanionLane) {
      lines.push("Companion mode: be conversational, precise, and genuinely helpful.");
      lines.push("Answer directly first, then give actionable next steps.");
    } else {
      lines.push("Be conversational, precise, and genuinely helpful.");
      lines.push("Answer directly first, then give actionable next steps.");
    }
    lines.push("Avoid vague filler, product marketing fluff, or unrelated modules.");
  }
  if (
    args.taskType === "seo"
    || args.taskType === "keyword_research"
    || args.taskType === "content_brief"
    || args.taskType === "website_improvement"
    || args.taskType === "seo_help"
  ) {
    lines.push("For SEO tasks, prioritize practical ranking actions: intent, content, technical SEO, and measurement.");
  } else if (
    args.taskType === "code_fix"
    || args.taskType === "code_generate"
    || args.taskType === "code_refactor"
    || args.taskType === "code_plan"
    || args.taskType === "code_review"
    || args.taskType === "patch_proposal"
    || args.taskType === "code_generation"
    || args.taskType === "code_explanation"
    || args.taskType === "code_explain"
  ) {
    lines.push("For coding tasks, stay implementation-focused with concrete, safe technical guidance.");
    lines.push("If the user asks for code/snippets/templates, include complete runnable code in fenced code blocks.");
    lines.push("Do not replace code output with abstract planning text.");
  } else if (
    args.taskType === "dashboard_summary"
    || args.taskType === "dashboard_diagnostics"
    || args.taskType === "dashboard_error_explanation"
    || args.taskType === "diagnostics_explanation"
  ) {
    lines.push("For diagnostics tasks, explain likely causes and prioritized checks.");
  } else if (
    args.taskType === "summarization"
    || args.taskType === "summary"
    || args.taskType === "rewrite"
    || args.taskType === "writing"
    || args.taskType === "title_improvement"
    || args.taskType === "naming"
    || args.taskType === "note_writing"
    || args.taskType === "note_rewrite"
    || args.taskType === "note_summary"
  ) {
    lines.push("For writing tasks, produce polished copy the user can use immediately.");
  }
  return lines;
}

function toSessionSurface(surface: AiSurface | AiCenterSurface): AiCenterSurface {
  const normalized = s(surface).toLowerCase();
  if (
    normalized === "general" ||
    normalized === "workspace" ||
    normalized === "console" ||
    normalized === "cavcloud" ||
    normalized === "cavsafe" ||
    normalized === "cavpad" ||
    normalized === "cavcode"
  ) {
    return normalized;
  }
  return "workspace";
}

function centerSurfaceToGuardSurface(surface: AiCenterSurface): AiSurface {
  if (surface === "general") return "console";
  if (surface === "workspace") return "console";
  if (surface === "cavcode") return "cavcode";
  if (surface === "cavcloud") return "cavcloud";
  if (surface === "cavsafe") return "cavsafe";
  if (surface === "cavpad") return "cavpad";
  return "console";
}

function sessionTitleFromSurface(surface: AiCenterSurface, contextLabel?: string | null): string {
  const label = s(contextLabel);
  if (label) return label;
  if (surface === "general") return "General context";
  if (surface === "console") return "Console context";
  if (surface === "cavcloud") return "CavCloud context";
  if (surface === "cavsafe") return "CavSafe context";
  if (surface === "cavpad") return "CavPad context";
  if (surface === "cavcode") return "CavCode context";
  return "Workspace context";
}

async function persistSessionTurn(args: {
  accountId: string;
  userId: string;
  requestId: string;
  action: string;
  surface: AiCenterSurface;
  sessionId?: string | null;
  contextLabel?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
  userText: string;
  userJson?: Record<string, unknown>;
  assistantText: string;
  assistantJson?: Record<string, unknown>;
  provider?: string;
  model?: string;
  status?: "SUCCESS" | "ERROR";
  errorCode?: string;
  sessionContextJson?: Record<string, unknown>;
}): Promise<string> {
  const ensuredSessionId = await ensureAiSession({
    accountId: args.accountId,
    userId: args.userId,
    sessionId: args.sessionId,
    surface: args.surface,
    title: sessionTitleFromSurface(args.surface, args.contextLabel),
    contextLabel: args.contextLabel || null,
    workspaceId: args.workspaceId || null,
    projectId: args.projectId || null,
    origin: args.origin || null,
    contextJson: {
      surface: args.surface,
      contextLabel: args.contextLabel || null,
      workspaceId: args.workspaceId || null,
      projectId: args.projectId || null,
      origin: args.origin || null,
    },
  });

  await appendAiSessionTurn({
    accountId: args.accountId,
    userId: args.userId,
    sessionId: ensuredSessionId,
    action: args.action,
    requestId: args.requestId,
    workspaceId: args.workspaceId || null,
    projectId: args.projectId || null,
    origin: args.origin || null,
    userText: args.userText,
    userJson: args.userJson || null,
    assistantText: args.assistantText,
    assistantJson: args.assistantJson || null,
    provider: args.provider || null,
    model: args.model || null,
    status: args.status || "SUCCESS",
    errorCode: args.errorCode || null,
    sessionContextJson: args.sessionContextJson || null,
  });

  return ensuredSessionId;
}

function normalizeCustomAgentRuntimePayload(agent: CavenCustomAgent): {
  id: string;
  name: string;
  summary: string;
  actionKey: string;
  surface: string;
  triggers: string[];
  instructions: string;
} {
  return {
    id: s(agent.id).toLowerCase(),
    name: s(agent.name).slice(0, 64),
    summary: s(agent.summary).slice(0, 220),
    actionKey: s(agent.actionKey).toLowerCase().slice(0, 64),
    surface: s(agent.surface).toLowerCase() || "all",
    triggers: Array.isArray(agent.triggers)
      ? agent.triggers.map((row) => s(row)).filter(Boolean).slice(0, 12)
      : [],
    instructions: s(agent.instructions).slice(0, 12_000),
  };
}

function inferCavCodeActionFromCustomAgent(args: {
  agent: CavenCustomAgent;
  prompt: string;
  goal?: string | null;
  fallback: CavCodeAssistAction;
}): CavCodeAssistAction {
  const profile = normalizeCustomAgentRuntimePayload(args.agent);
  const text = [
    profile.actionKey,
    profile.name,
    profile.summary,
    profile.instructions,
    profile.triggers.join(" "),
    s(args.prompt),
    s(args.goal),
  ].join(" ").toLowerCase();

  if (/\b(competitor|competition|rival|benchmark|battlecard|feature gap|pricing)\b/.test(text)) {
    return "competitor_research";
  }
  if (
    /\b(accessibility|a11y|wcag|aria|screen reader|keyboard navigation|contrast|focus order|alt text)\b/.test(text)
  ) {
    return "accessibility_audit";
  }
  if (/\b(refactor|cleanup|restructure|simplify)\b/.test(text)) return "refactor_safely";
  if (/\b(fix|bug|error|defect|patch|issue)\b/.test(text)) return "suggest_fix";
  if (/\b(mockup|ui mockup|wireframe|screen concept)\b/.test(text)) return "ui_mockup_generator";
  if (/\b(website visual|hero image|landing visual|marketing visual)\b/.test(text)) return "website_visual_builder";
  if (/\b(screenshot|enhance screenshot|product shot|retouch)\b/.test(text)) return "app_screenshot_enhancer";
  if (/\b(brand asset|icon set|banner visual|background pack)\b/.test(text)) return "brand_asset_generator";
  if (/\b(ui debug|layout diff|visual mismatch|pixel drift)\b/.test(text)) return "ui_debug_visualizer";
  if (/\b(api contract|schema contract|openapi|graphql schema|breaking change)\b/.test(text)) return "api_schema_contract_guard";
  if (/\b(404 page|not found page|error page)\b/.test(text)) return "page_404_builder_agent";
  if (/\b(email|e-mail|text message|dm|reply draft)\b/.test(text)) return "email_text_agent";
  if (/\b(content creator|website copy|headline|subheadline|copy block)\b/.test(text)) return "content_creator";
  if (/\b(privacy policy|terms of service|legal disclaimer|ethics policy)\b/.test(text)) {
    return "legal_privacy_terms_ethics_agent";
  }
  if (/\b(pdf|portable document|edit pdf|preview pdf)\b/.test(text)) return "pdf_create_edit_preview_agent";
  if (/\b(edit document|review document|doc review|rewrite document)\b/.test(text)) return "doc_edit_review_agent";
  if (/\b(research|sources?|citations?|evidence)\b/.test(text)) return "web_research";
  if (/\b(incident|outage|spike|postmortem)\b/.test(text)) return "summarize_issues";
  if (/\b(storage|folder|organize files|artifact)\b/.test(text)) return "organize_storage";
  if (/\b(access audit|permissions?|acl|authz|access control)\b/.test(text)) return "audit_access_context";
  if (/\b(thread summary|summarize thread|conversation recap)\b/.test(text)) return "summarize_thread";
  if (/\b(component|ui component|widget)\b/.test(text)) return "generate_component";
  if (/\b(section|hero|footer|navbar|layout section)\b/.test(text)) return "generate_section";
  if (/\b(page|screen|landing|route scaffold)\b/.test(text)) return "generate_page";
  if (/\b(seo|metadata|meta tag|serp|keyword)\b/.test(text)) return "improve_seo";
  if (/\b(explain|walkthrough|onboard|review code|call flow)\b/.test(text)) return "explain_code";
  if (/\b(summarize|summary|digest|brief)\b/.test(text)) return "summarize_file";
  if (/\b(note|changelog|implementation note|writeup)\b/.test(text)) return "write_note";
  return args.fallback;
}

function isCavCodeWriteAction(action: CavCodeAssistAction): boolean {
  return (
    action === "suggest_fix"
    || action === "refactor_safely"
    || action === "generate_component"
    || action === "generate_section"
    || action === "generate_page"
    || action === "page_404_builder_agent"
    || action === "accessibility_audit"
    || action === "ui_mockup_generator"
    || action === "website_visual_builder"
    || action === "app_screenshot_enhancer"
    || action === "brand_asset_generator"
    || action === "ui_debug_visualizer"
    || action === "api_schema_contract_guard"
    || action === "content_creator"
    || action === "doc_edit_review_agent"
  );
}

function inferCenterActionFromCustomAgent(args: {
  agent: CavenCustomAgent;
  prompt: string;
  goal?: string | null;
  fallback: AiCenterAssistAction;
}): AiCenterAssistAction {
  const profile = normalizeCustomAgentRuntimePayload(args.agent);
  const text = [
    profile.actionKey,
    profile.name,
    profile.summary,
    profile.instructions,
    profile.triggers.join(" "),
    s(args.prompt),
    s(args.goal),
  ].join(" ").toLowerCase();

  if (/\b(budget|spending|expense|debt|cash flow|money plan|financial planning)\b/.test(text)) return "financial_advisor";
  if (/\b(overwhelmed|anxious|anxiety|panic|ground me|journal|process feelings)\b/.test(text)) return "therapist_support";
  if (/\b(mentor|mentorship|discipline|coach me|guide me)\b/.test(text)) return "mentor";
  if (/\b(best friend|friend support|be honest with me)\b/.test(text)) return "best_friend";
  if (/\b(relationship|partner|spouse|boyfriend|girlfriend|communication conflict)\b/.test(text)) return "relationship_advisor";
  if (/\b(philosophy|meaning|purpose|existential|stoic|stoicism)\b/.test(text)) return "philosopher";
  if (/\b(focus|deep work|procrastinat|re-center|lock in)\b/.test(text)) return "focus_coach";
  if (/\b(life strategy|life plan|life goals|next chapter)\b/.test(text)) return "life_strategist";
  if (/\b(email|e-mail|text message|dm|message rewrite|reply draft)\b/.test(text)) return "email_text_agent";
  if (/\b(content creator|website copy|landing copy|headline|subheadline|content block)\b/.test(text)) return "content_creator";
  if (/\b(privacy policy|terms of service|terms and conditions|ethics policy|compliance language)\b/.test(text)) {
    return "legal_privacy_terms_ethics_agent";
  }
  if (/\b(pdf|portable document|pdf preview|edit pdf|generate pdf)\b/.test(text)) return "pdf_create_edit_preview_agent";
  if (/\b(404 page|not found page|error page copy)\b/.test(text)) return "page_404_builder_agent";
  if (/\b(edit document|review document|rewrite document|doc review)\b/.test(text)) return "doc_edit_review_agent";
  if (/\b(research|sources?|citations?|evidence|web)\b/.test(text)) return "web_research";
  if (/\b(companion|cavbot companion|talk through|burnout|founder support)\b/.test(text)) return "companion_chat";
  if (/\b(image edit|screenshot|enhance screenshot|retouch|modify image)\b/.test(text)) return "image_edit";
  if (/\b(image studio|generate image|visual asset|mockup|brand asset)\b/.test(text)) return "image_studio";
  if (/\b(incident|outage|spike)\b/.test(text)) return "write_incident_note";
  if (/\b(prioritize|priority|triage)\b/.test(text)) return "prioritize_fixes";
  if (/\b(issue|error|failure|anomaly)\b/.test(text)) return "summarize_issues";
  if (/\b(folder|storage|artifact|cavcloud)\b/.test(text)) return "organize_storage";
  if (/\b(access|permission|policy|security|cavsafe)\b/.test(text)) return "audit_access_context";
  if (/\b(rewrite|clarify|rephrase)\b/.test(text)) return "rewrite_clearly";
  if (/\b(summarize thread|thread summary|recap)\b/.test(text)) return "summarize_thread";
  if (/\b(plan|roadmap|execution)\b/.test(text)) return "bullets_to_plan";
  if (/\b(next steps?|recommend)\b/.test(text)) return "recommend_next_steps";
  if (/\b(note|memo|write)\b/.test(text)) return "write_note";
  return args.fallback;
}

function cavCodeSystemPrompt(
  reasoningDirective: string,
  actionClass: AiActionClass,
  taskType: ReturnType<typeof classifyAiTaskType>,
  customAgent?: CavenCustomAgent | null
) {
  const runtimeAgent = customAgent ? normalizeCustomAgentRuntimePayload(customAgent) : null;
  return [
    "You are CavBot's AI coding engine operating behind a deterministic CavAi platform.",
    "DeepSeek is the language layer, not the source of truth.",
    "All outputs must stay evidence-first and action-scoped.",
    CAVBOT_ANSWER_QUALITY_DIRECTIVE,
    CAVBOT_MODEL_BEHAVIOR_DIRECTIVE,
    `Action class: ${actionClass}.`,
    `Task type: ${taskType}.`,
    reasoningDirective,
    "Return ONLY valid JSON.",
    "Do not include markdown, code fences, or explanations outside JSON.",
    "Output schema:",
    "{",
    '  "summary": "string",',
    '  "risk": "low|medium|high",',
    '  "changes": ["string"],',
    '  "proposedCode": "string",',
    '  "generatedImages": [{"url":"https://...","b64Json":"string"}],',
    '  "notes": ["string"],',
    '  "followUpChecks": ["string"]',
    "}",
    "If no code change is needed, proposedCode can be an empty string.",
    ...(runtimeAgent
      ? [
          "",
          "Installed custom agent profile (enforce this behavior):",
          toStableJson(runtimeAgent, 10_000),
          "When agent instructions conflict with user intent or safety constraints, preserve safety and explicit user intent.",
        ]
      : []),
  ].join("\n");
}

function cavCodeUserPrompt(
  input: CavCodeAssistRequest,
  contextPack?: ReturnType<typeof buildSurfaceContextPack>,
  customAgent?: CavenCustomAgent | null,
  uploadedWorkspaceFiles?: UploadedWorkspaceFileContext[]
) {
  const diagnostics = (input.diagnostics || []).map((row) => ({
    code: row.code || null,
    source: row.source || null,
    severity: row.severity,
    message: row.message,
    line: row.line || null,
    col: row.col || null,
  }));
  const imageAttachments = (input.imageAttachments || []).map((item) => ({
    id: item.id,
    assetId: s(item.assetId) || null,
    name: item.name,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    hasDataUrl: Boolean(s(item.dataUrl)),
    hasAssetId: Boolean(s(item.assetId) || s(item.id)),
  }));
  const uploadedFiles = (uploadedWorkspaceFiles || parseUploadedWorkspaceFilesContext(safeRecord(input.context)))
    .slice(0, MAX_UPLOADED_WORKSPACE_FILES)
    .map((file) => ({
      id: file.id,
      cavcloudFileId: s(file.cavcloudFileId) || null,
      cavcloudPath: s(file.cavcloudPath) || null,
      path: s(file.path) || null,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      snippet: file.snippet || null,
    }));

  return [
    "Action request:",
    toStableJson(
      {
        action: input.action,
        filePath: input.filePath,
        language: input.language || null,
        goal: input.goal || null,
        prompt: input.prompt || null,
        model: input.model || null,
        reasoningLevel: input.reasoningLevel || "medium",
        queueEnabled: input.queueEnabled === true,
        projectId: input.projectId || null,
        workspaceId: input.workspaceId || null,
      },
      4_000
    ),
    "",
    "Selected code:",
    clampText(input.selectedCode || "", 20_000) || "(none)",
    "",
    "Diagnostics:",
    diagnostics.length ? toStableJson(diagnostics, 12_000) : "[]",
    "",
    "Image attachments:",
    imageAttachments.length ? toStableJson(imageAttachments, 4_000) : "[]",
    "",
    "Uploaded workspace files:",
    uploadedFiles.length ? toStableJson(uploadedFiles, 12_000) : "[]",
    "",
    "Scoped context pack:",
    toStableJson(
      contextPack || {
        scope: "cavcode:code_explanation",
        context: input.context || {},
        signalsUsed: [],
        promptSignals: [],
      },
      8_000
    ),
    "",
    "Additional context:",
    toStableJson(input.context || {}, 4_000),
    ...(customAgent
      ? [
          "",
          "Custom agent context:",
          toStableJson(normalizeCustomAgentRuntimePayload(customAgent), 8_000),
        ]
      : []),
  ].join("\n");
}

function surfaceSystemPrompt(
  surface: AiSurface,
  action: string,
  reasoningDirective: string,
  actionClass: AiActionClass,
  taskType: ReturnType<typeof classifyAiTaskType>
) {
  return [
    `You are CavBot AI for ${surface}.`,
    CAVBOT_ANSWER_QUALITY_DIRECTIVE,
    CAVBOT_MODEL_BEHAVIOR_DIRECTIVE,
    `Task action: ${action}.`,
    `Action class: ${actionClass}.`,
    `Task type: ${taskType}.`,
    reasoningDirective,
    "Return ONLY valid JSON.",
    "Do not include markdown, commentary, or code fences.",
    "Output schema:",
    "{",
    '  "summary": "string",',
    '  "risk": "low|medium|high",',
    '  "recommendations": ["string"],',
    '  "notes": ["string"],',
    '  "followUpChecks": ["string"],',
    '  "evidenceRefs": ["string"]',
    "}",
    "Be concise and action-oriented.",
  ].join("\n");
}

function surfaceUserPrompt(payload: unknown, contextPack?: ReturnType<typeof buildSurfaceContextPack>) {
  return [
    "Scoped context pack:",
    toStableJson(
      contextPack || {
        scope: "surface:general_question",
        context: {},
        signalsUsed: [],
        promptSignals: [],
      },
      8_000
    ),
    "",
    "Payload:",
    toStableJson(payload, 16_000),
  ].join("\n");
}

function centerSystemPrompt(args: {
  input: AiCenterAssistRequest;
  effectiveAction: AiCenterAssistAction;
  reasoningDirective: string;
  actionClass: AiActionClass;
  taskType: ReturnType<typeof classifyAiTaskType>;
  researchMode: boolean;
  researchToolBundle: AiResearchToolId[];
  model: string;
  reasoningLevel: "low" | "medium" | "high" | "extra_high";
  customAgent?: CavenCustomAgent | null;
}) {
  const runtimeAgent = args.customAgent ? normalizeCustomAgentRuntimePayload(args.customAgent) : null;
  if (args.researchMode) {
    return [
      "You are CavAi Center running PREMIUM+ web research mode.",
      "You must stay tenant-safe, evidence-first, and source-grounded.",
      `Launch surface: ${args.input.surface}.`,
      `Action: ${args.effectiveAction}.`,
      `Action class: ${args.actionClass}.`,
      `Task type: ${args.taskType}.`,
      `Research model: ${args.model}.`,
      `Research tools (must be used as needed): ${args.researchToolBundle.join(", ")}.`,
      `Reasoning level: ${args.reasoningLevel}.`,
      CAVBOT_ANSWER_QUALITY_DIRECTIVE,
      CAVBOT_MODEL_BEHAVIOR_DIRECTIVE,
      args.reasoningDirective,
      ...centerCompanionDirective({
        surface: args.input.surface,
        action: args.effectiveAction,
        actionClass: args.actionClass,
        taskType: args.taskType,
        model: args.model,
      }),
      "Return ONLY valid JSON.",
      "Do not include markdown, commentary, or code fences.",
      "Output schema:",
      "{",
      '  "summary": "string",',
      '  "risk": "low|medium|high",',
      '  "answer": "string",',
      '  "researchMode": true,',
      '  "keyFindings": ["string"],',
      '  "extractedEvidence": [{"source":"string","url":"https://...","note":"string"}],',
      '  "sources": [{"title":"string","url":"https://...","note":"string"}],',
      '  "suggestedNextActions": ["string"],',
      '  "researchProfile": {"model":"string","reasoningLevel":"low|medium|high|extra_high","toolBundle":["web_search","web_extractor","code_interpreter"]},',
      '  "recommendations": ["string"],',
      '  "notes": ["string"],',
      '  "followUpChecks": ["string"],',
      '  "evidenceRefs": ["string"]',
      "}",
      "If a source is uncertain, say so clearly and reduce confidence.",
      ...(runtimeAgent
        ? [
            "",
            "Installed custom agent profile (enforce this behavior):",
            toStableJson(runtimeAgent, 8_000),
          ]
        : []),
    ].join("\n");
  }

  return [
    "You are CavAi Center, the context-aware CavBot assistant.",
    "You must stay tenant-safe, evidence-first, and action-oriented.",
    `Launch surface: ${args.input.surface}.`,
    `Action: ${args.effectiveAction}.`,
    `Action class: ${args.actionClass}.`,
    `Task type: ${args.taskType}.`,
    "Task type and user prompt are source of truth; action is only a routing hint.",
    CAVBOT_ANSWER_QUALITY_DIRECTIVE,
    CAVBOT_MODEL_BEHAVIOR_DIRECTIVE,
    args.reasoningDirective,
    ...centerCompanionDirective({
      surface: args.input.surface,
      action: args.effectiveAction,
      actionClass: args.actionClass,
      taskType: args.taskType,
      model: args.model,
    }),
    "Return ONLY valid JSON.",
    "Do not include markdown, commentary, or code fences.",
    "Output schema:",
    "{",
    '  "summary": "string",',
    '  "risk": "low|medium|high",',
    '  "answer": "string",',
    '  "recommendations": ["string"],',
    '  "notes": ["string"],',
    '  "followUpChecks": ["string"],',
    '  "evidenceRefs": ["string"]',
    "}",
    "Keep the answer concise, specific, and scoped to provided context.",
    ...(runtimeAgent
      ? [
          "",
          "Installed custom agent profile (enforce this behavior):",
          toStableJson(runtimeAgent, 8_000),
        ]
      : []),
  ].join("\n");
}

function centerUserPrompt(
  input: AiCenterAssistRequest,
  researchMode: boolean,
  contextPack?: ReturnType<typeof buildSurfaceContextPack>,
  effectiveAction?: string,
  customAgent?: CavenCustomAgent | null,
  uploadedWorkspaceFiles?: UploadedWorkspaceFileContext[]
) {
  const imageAttachments = (input.imageAttachments || []).map((item) => ({
    id: item.id,
    assetId: s(item.assetId) || null,
    name: item.name,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    hasDataUrl: Boolean(s(item.dataUrl)),
    hasAssetId: Boolean(s(item.assetId) || s(item.id)),
  }));
  const uploadedFiles = (uploadedWorkspaceFiles || parseUploadedWorkspaceFilesContext(safeRecord(input.context)))
    .slice(0, MAX_UPLOADED_WORKSPACE_FILES)
    .map((file) => ({
      id: file.id,
      cavcloudFileId: s(file.cavcloudFileId) || null,
      cavcloudPath: s(file.cavcloudPath) || null,
      path: s(file.path) || null,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      snippet: file.snippet || null,
    }));

  return [
    "Scoped context pack:",
    toStableJson(
      contextPack || {
        scope: `${input.surface}:general_question`,
        context: input.context || {},
        signalsUsed: [],
        promptSignals: [],
      },
      8_000
    ),
    "",
    "Request payload:",
    toStableJson(
      {
        action: s(effectiveAction) || input.action,
        surface: input.surface,
        contextLabel: input.contextLabel || null,
        prompt: input.prompt,
        goal: input.goal || null,
        model: input.model || null,
        researchMode,
        researchUrls: Array.isArray(input.researchUrls) ? input.researchUrls : [],
        reasoningLevel: input.reasoningLevel || "medium",
        imageAttachments,
        uploadedWorkspaceFiles: uploadedFiles,
        workspaceId: input.workspaceId || null,
        projectId: input.projectId || null,
        origin: input.origin || null,
        context: input.context || {},
      },
      18_000
    ),
    ...(customAgent
      ? [
          "",
          "Custom agent context:",
          toStableJson(normalizeCustomAgentRuntimePayload(customAgent), 8_000),
        ]
      : []),
  ].join("\n");
}

function mapProviderError(error: unknown): AiServiceError {
  if (error instanceof AiServiceError) return error;
  if (error instanceof AiProviderError) {
    return new AiServiceError(error.code, error.message, error.status, error.details);
  }
  if (error instanceof Error) {
    return new AiServiceError("AI_SERVICE_ERROR", error.message, 500);
  }
  return new AiServiceError("AI_SERVICE_ERROR", "Unknown AI service error.", 500);
}

function guardDecisionFromError(error: AiServiceError): Record<string, unknown> | null {
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const guardDecision = (details as { guardDecision?: unknown }).guardDecision;
  if (!guardDecision || typeof guardDecision !== "object" || Array.isArray(guardDecision)) return null;
  return guardDecision as Record<string, unknown>;
}

function withGuard<T extends { ok: false; requestId: string; error: string; message?: string; status?: number }>(
  error: AiServiceError,
  envelope: T
): T {
  const guardDecision = guardDecisionFromError(error);
  if (!guardDecision) return envelope;
  return {
    ...envelope,
    guardDecision,
  };
}

async function runProviderJson(args: {
  modelRole: AiModelRole;
  modelOverride?: string;
  messages: AiProviderMessage[];
  maxTokensOverride?: number;
  temperature?: number;
  tools?: AiProviderTool[];
  toolChoice?: "auto" | "none";
  reasoningEffort?: AiProviderReasoningEffort;
  timeoutMs?: number;
  signal?: AbortSignal;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}) {
  const modelOverride = s(args.modelOverride);
  const providerId = resolveProviderIdForModel(modelOverride || undefined);
  assertAiProviderReady(providerId);
  const provider = getAiProvider(providerId);
  const model = modelOverride || provider.resolveModel(args.modelRole);
  const maxTokens = Number.isFinite(Number(args.maxTokensOverride))
    ? Math.max(64, Math.min(6_000, Math.trunc(Number(args.maxTokensOverride))))
    : args.modelRole === "reasoning"
      ? 1_800
      : 1_400;
  const requestBase = {
    messages: args.messages,
    temperature: Number.isFinite(Number(args.temperature)) ? Number(args.temperature) : 0.12,
    maxTokens,
    responseFormat: { type: "json_object" as const },
    tools: args.tools,
    toolChoice: args.toolChoice,
    reasoningEffort: args.reasoningEffort,
    timeoutMs: args.timeoutMs,
    signal: args.signal,
    metadata: args.metadata,
  };

  let resolvedProviderId = providerId;
  let resolvedModel = model;
  let response: AiProviderGenerateResponse;
  try {
    response = await provider.generate({
      model: resolvedModel,
      ...requestBase,
    });
  } catch (error) {
    if (error instanceof AiProviderError && error.code === "DEEPSEEK_EMPTY_RESPONSE" && providerId === "deepseek") {
      const fallbackProviderId = resolveProviderIdForModel(ALIBABA_QWEN_PLUS_MODEL_ID);
      assertAiProviderReady(fallbackProviderId);
      const fallbackProvider = getAiProvider(fallbackProviderId);
      const fallbackModel = fallbackProvider.resolveModel(args.modelRole);
      response = await fallbackProvider.generate({
        model: fallbackModel,
        ...requestBase,
        metadata: {
          ...(requestBase.metadata || {}),
          providerFallback: "deepseek_empty_to_alibaba_qwen",
        },
      });
      resolvedProviderId = fallbackProviderId;
      resolvedModel = fallbackModel;
    } else if (
      error instanceof AiProviderError
      && error.code === "ALIBABA_QWEN_REQUEST_FAILED"
      && providerId === "alibaba_qwen"
      && resolvedModel === ALIBABA_QWEN_CODER_MODEL_ID
      && error.status === 404
    ) {
      const fallbackModel = ALIBABA_QWEN_PLUS_MODEL_ID;
      response = await provider.generate({
        model: fallbackModel,
        ...requestBase,
        metadata: {
          ...(requestBase.metadata || {}),
          providerFallback: "alibaba_qwen_coder_404_to_plus",
        },
      });
      resolvedModel = fallbackModel;
    } else {
      throw error;
    }
  }
  const parseWithRetry = async (): Promise<unknown> => {
    try {
      return parseProviderJson(response.content);
    } catch (error) {
      const mapped = mapProviderError(error);
      if (mapped.code !== "INVALID_PROVIDER_JSON") throw error;

      const jsonRetryMessages: AiProviderMessage[] = [
        {
          role: "system",
          content: "Critical output rule: return exactly one valid JSON object. No markdown, no backticks, and no prose before or after JSON.",
        },
        ...args.messages,
        {
          role: "user",
          content: "Retry now. Return only valid JSON that matches the requested schema.",
        },
      ];

      response = await provider.generate({
        model: resolvedModel,
        ...requestBase,
        messages: jsonRetryMessages,
        temperature: 0,
        metadata: {
          ...(requestBase.metadata || {}),
          jsonRetry: true,
          jsonRetryReason: "invalid_provider_json",
        },
      });

      try {
        return parseProviderJson(response.content);
      } catch (retryError) {
        if (resolvedProviderId !== "deepseek") throw retryError;

        const fallbackProviderId = resolveProviderIdForModel(ALIBABA_QWEN_PLUS_MODEL_ID);
        assertAiProviderReady(fallbackProviderId);
        const fallbackProvider = getAiProvider(fallbackProviderId);
        const fallbackModel = fallbackProvider.resolveModel(args.modelRole);
        response = await fallbackProvider.generate({
          model: fallbackModel,
          ...requestBase,
          metadata: {
            ...(requestBase.metadata || {}),
            providerFallback: "deepseek_invalid_json_to_alibaba_qwen",
          },
        });
        resolvedProviderId = fallbackProviderId;
        resolvedModel = fallbackModel;
        return parseProviderJson(response.content);
      }
    }
  };

  const parsed = await parseWithRetry();
  return {
    providerId: resolvedProviderId,
    model: resolvedModel,
    response,
    parsed,
  };
}

function dataUrlToFile(dataUrl: string, fileName: string): File | null {
  const raw = s(dataUrl);
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) return null;
  const mimeType = s(match[1]) || "image/png";
  const base64 = s(match[2]);
  if (!base64) return null;
  try {
    const binary = Buffer.from(base64, "base64");
    if (!binary.length) return null;
    const ext = mimeType.includes("png")
      ? "png"
      : mimeType.includes("webp")
        ? "webp"
        : mimeType.includes("jpeg") || mimeType.includes("jpg")
          ? "jpg"
          : "png";
    return new File([binary], fileName || `image-edit-input.${ext}`, { type: mimeType });
  } catch {
    return null;
  }
}

async function resolveAttachmentFile(args: {
  accountId: string;
  userId: string;
  attachment: {
    id?: string | null;
    assetId?: string | null;
    name?: string | null;
    dataUrl?: string | null;
  };
  fallbackName: string;
}): Promise<File | null> {
  const providedDataUrl = s(args.attachment.dataUrl);
  if (providedDataUrl) {
    const fileFromData = dataUrlToFile(providedDataUrl, s(args.attachment.name) || args.fallbackName);
    if (fileFromData) return fileFromData;
  }

  const assetId = s(args.attachment.assetId) || s(args.attachment.id);
  if (!assetId) return null;
  const resolved = await resolveDataUrlForAssetSafe({
    accountId: args.accountId,
    userId: args.userId,
    assetId,
  });
  const assetDataUrl = s(resolved?.dataUrl);
  if (!assetDataUrl) return null;
  const assetName = s(resolved?.fileName) || s(args.attachment.name) || args.fallbackName;
  return dataUrlToFile(assetDataUrl, assetName);
}

type ImageStudioRequestContext = {
  presetId: string | null;
  presetSlug: string | null;
  aspectRatio: string | null;
  variantCount: number | null;
  brandContext: string | null;
  transformMode: string | null;
  sourceAssetId: string | null;
};

type ImageStudioResolvedPromptInput = {
  effectivePrompt: string;
  customInstruction: string;
  activationLine: string | null;
  activationLineUnchanged: boolean;
};

function toPositiveInt(value: unknown, max = 12): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(max, Math.max(1, Math.trunc(parsed)));
}

function parseImageStudioRequestContext(contextRaw: unknown): ImageStudioRequestContext {
  const context = safeRecord(contextRaw);
  const nested = safeRecord(context.imageStudio);
  const read = (...keys: string[]): string => {
    for (const key of keys) {
      const top = s(context[key]);
      if (top) return top;
      const inner = s(nested[key]);
      if (inner) return inner;
    }
    return "";
  };

  const variantCount =
    toPositiveInt(context.imageStudioVariantCount)
    ?? toPositiveInt(context.variantCount)
    ?? toPositiveInt(nested.variantCount)
    ?? toPositiveInt(nested.imageStudioVariantCount);

  return {
    presetId: read("imageStudioPresetId", "presetId") || null,
    presetSlug: read("imageStudioPresetSlug", "presetSlug", "styleSlug") || null,
    aspectRatio: read("imageStudioAspectRatio", "aspectRatio") || null,
    variantCount,
    brandContext: read("imageStudioBrandContext", "brandContext") || null,
    transformMode: read("imageStudioTransformMode", "transformMode") || null,
    sourceAssetId: read("imageStudioSourceAssetId", "sourceAssetId") || null,
  };
}

function normalizeImageStudioActivationLine(value: string): string {
  return s(value).replace(/\s+/g, " ").toLowerCase();
}

function buildImageStudioActivationLine(mode: "studio" | "edit", presetLabel: string): string {
  const label = s(presetLabel);
  if (!label) return "";
  if (mode === "edit") return `Edit image in ${label} style`;
  return `Create image in ${label} style`;
}

function resolveImageStudioPromptInput(args: {
  mode: "studio" | "edit";
  promptText: string;
  goalText?: string | null;
  presetLabel?: string | null;
}): ImageStudioResolvedPromptInput {
  const promptText = s(args.promptText);
  const goalText = s(args.goalText);
  const activationLine = s(args.presetLabel)
    ? buildImageStudioActivationLine(args.mode, s(args.presetLabel))
    : "";
  const activationLineUnchanged = Boolean(activationLine)
    && normalizeImageStudioActivationLine(promptText) === normalizeImageStudioActivationLine(activationLine);
  const customParts: string[] = [];
  if (promptText && !activationLineUnchanged) {
    customParts.push(promptText);
  }
  if (goalText) {
    customParts.push(goalText);
  }
  const customInstruction = customParts.join("\n\n");
  const fallbackInstruction = args.mode === "edit"
    ? "Apply the selected preset style to the provided image while preserving key subject identity and clean finishing quality."
    : "Generate a high-quality image that faithfully follows the selected preset style and delivers polished visual output.";
  return {
    effectivePrompt: customInstruction || fallbackInstruction,
    customInstruction,
    activationLine: activationLine || null,
    activationLineUnchanged,
  };
}

function centerImageSummaryFromPrompt(prompt: string, mode: "studio" | "edit"): string {
  const trimmed = clampText(prompt, 180);
  if (mode === "edit") return `Image Edit completed for: ${trimmed}`;
  return `Image Studio generated visuals for: ${trimmed}`;
}

function isCavCodeImageAction(action: CavCodeAssistAction): boolean {
  return (
    action === "ui_mockup_generator"
    || action === "website_visual_builder"
    || action === "app_screenshot_enhancer"
    || action === "brand_asset_generator"
    || action === "ui_debug_visualizer"
  );
}

function isCompanionCenterAction(action: unknown): action is AiCenterAssistAction {
  const normalized = s(action).toLowerCase();
  return (
    normalized === "companion_chat"
    || normalized === "financial_advisor"
    || normalized === "therapist_support"
    || normalized === "mentor"
    || normalized === "best_friend"
    || normalized === "relationship_advisor"
    || normalized === "philosopher"
    || normalized === "focus_coach"
    || normalized === "life_strategist"
  );
}

function buildUiMockupCodeDraft(prompt: string): string {
  const title = clampText(prompt || "UI Mockup", 90).replace(/[\r\n]+/g, " ");
  return [
    "import React from \"react\";",
    "",
    "export default function MockupPreview() {",
    "  return (",
    "    <main style={{ padding: \"2rem\", fontFamily: \"system-ui, sans-serif\" }}>",
    `      <h1 style={{ marginBottom: \"1rem\" }}>${title}</h1>`,
    "      <section style={{ display: \"grid\", gap: \"1rem\", gridTemplateColumns: \"repeat(auto-fit, minmax(220px, 1fr))\" }}>",
    "        <article style={{ border: \"1px solid #d8dee9\", borderRadius: 14, padding: \"1rem\" }}>",
    "          <h2 style={{ marginTop: 0 }}>Primary CTA</h2>",
    "          <p>Replace copy and styling with your brand tokens.</p>",
    "        </article>",
    "        <article style={{ border: \"1px solid #d8dee9\", borderRadius: 14, padding: \"1rem\" }}>",
    "          <h2 style={{ marginTop: 0 }}>Feature Highlight</h2>",
    "          <p>Use this scaffold to wire real product content.</p>",
    "        </article>",
    "      </section>",
    "    </main>",
    "  );",
    "}",
  ].join("\n");
}

export async function runAudioTranscription(args: {
  req: Request;
  requestId: string;
  input: AiAudioTranscriptionRequest;
}): Promise<AiAssistResponseEnvelope<AiAudioTranscriptionResponse>> {
  const startedAt = Date.now();
  const ctx = await requireAiRequestContext({
    req: args.req,
    surface: "console",
    projectId: args.input.projectId,
    workspaceId: args.input.workspaceId,
  });

  const origin = s(args.input.origin) || null;
  const prompt = s(args.input.prompt);
  const language = s(args.input.language);
  const modelOverride = s(args.input.model) || undefined;
  let policy: AiExecutionPolicy | null = null;

  try {
    policy = await resolveAiExecutionPolicy({
      accountId: ctx.accountId,
      userId: ctx.userId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      surface: "audio",
      action: "transcribe_audio",
      requestedModel: modelOverride || null,
      requestedReasoningLevel: "low",
      promptText: prompt,
      context: null,
      imageAttachmentCount: 0,
      isExecution: true,
      requestId: args.requestId,
    });

    const executionModel = modelOverride || policy.model;
    const transcription = await transcribeAlibabaQwenAudio({
      file: args.input.file,
      model: executionModel,
      strictModel: Boolean(modelOverride),
      prompt: prompt || undefined,
      language: language || undefined,
      timeoutMs: policy.requestLimits.maxExecutionTimeMs,
      signal: args.req.signal,
    });

    const parsed = AI_AUDIO_TRANSCRIPTION_RESPONSE_SCHEMA.safeParse({
      text: transcription.text,
      language: transcription.language,
      durationSeconds: transcription.durationSeconds,
      mimeType: s(args.input.file?.type) || null,
      fileName: s(args.input.file?.name) || null,
      sizeBytes: Number.isFinite(args.input.file?.size) ? Math.max(0, Math.trunc(args.input.file.size)) : null,
    });
    if (!parsed.success) {
      throw new AiServiceError(
        "INVALID_PROVIDER_SHAPE",
        "Provider returned transcription data in an invalid format.",
        502,
        parsed.error.flatten()
      );
    }

    const data = parsed.data;

    await writeAiUsageLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      surface: "console",
      action: "transcribe_audio",
      provider: "alibaba_qwen",
      model: transcription.model,
      requestId: args.requestId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin,
      inputChars: prompt.length,
      outputChars: data.text.length,
      latencyMs: Date.now() - startedAt,
      status: "SUCCESS",
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });

    await writeAiAudit({
      req: args.req,
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      surface: "console",
      action: "transcribe_audio",
      provider: "alibaba_qwen",
      model: transcription.model,
      status: "SUCCESS",
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      actionClass: policy.actionClass,
      reasoningLevel: policy.reasoningLevel,
      weightedUsageUnits: policy.weightedUsageUnits,
      latencyMs: Date.now() - startedAt,
      outcome: "transcribed",
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin,
    });

    return {
      ok: true,
      requestId: args.requestId,
      providerId: "alibaba_qwen",
      model: transcription.model,
      data,
    };
  } catch (error) {
    const mapped = mapProviderError(error);

    await writeAiUsageLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      surface: "console",
      action: "transcribe_audio",
      provider: "alibaba_qwen",
      model: modelOverride || policy?.model || "unknown",
      requestId: args.requestId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin,
      inputChars: prompt.length,
      outputChars: 0,
      latencyMs: Date.now() - startedAt,
      status: "ERROR",
      errorCode: mapped.code,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });

    await writeAiAudit({
      req: args.req,
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      surface: "console",
      action: "transcribe_audio",
      provider: "alibaba_qwen",
      model: modelOverride || "unknown",
      status: "ERROR",
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      actionClass: policy?.actionClass || "audio_transcription",
      reasoningLevel: policy?.reasoningLevel || "low",
      weightedUsageUnits: policy?.weightedUsageUnits || 0,
      latencyMs: Date.now() - startedAt,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin,
      errorCode: mapped.code,
      outcome: "failed",
    });

    return withGuard(mapped, {
      ok: false,
      requestId: args.requestId,
      error: mapped.code,
      message: mapped.message,
      status: mapped.status,
    });
  } finally {
    policy?.releaseGenerationSlot();
  }
}

export async function runTextToSpeech(args: {
  req: Request;
  requestId: string;
  input: {
    text: string;
    model?: string;
    voice?: string;
    instructions?: string;
    format?: "mp3" | "wav" | "pcm";
    workspaceId?: string;
    projectId?: number;
    origin?: string;
  };
}): Promise<{
  providerId: "alibaba_qwen";
  model: string;
  contentType: string;
  audioBuffer: ArrayBuffer;
}> {
  const startedAt = Date.now();
  const ctx = await requireAiRequestContext({
    req: args.req,
    surface: "console",
    projectId: args.input.projectId,
    workspaceId: args.input.workspaceId,
  });

  const origin = s(args.input.origin) || null;
  const text = s(args.input.text);
  const modelOverride = s(args.input.model) || undefined;
  let policy: AiExecutionPolicy | null = null;

  try {
    policy = await resolveAiExecutionPolicy({
      accountId: ctx.accountId,
      userId: ctx.userId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      surface: "audio",
      action: "speak_text",
      requestedModel: modelOverride || null,
      requestedReasoningLevel: "low",
      promptText: text,
      context: {
        voice: s(args.input.voice) || null,
        format: s(args.input.format) || null,
      },
      imageAttachmentCount: 0,
      isExecution: true,
      requestId: args.requestId,
    });

    const executionModel = modelOverride || policy.model;
    const speech = await synthesizeAlibabaQwenSpeech({
      text,
      model: executionModel,
      voice: s(args.input.voice) || undefined,
      instructions:
        s(args.input.instructions)
        || DEFAULT_CAVBOT_TTS_INSTRUCTIONS,
      format: args.input.format,
      timeoutMs: policy.requestLimits.maxExecutionTimeMs,
      signal: args.req.signal,
    });

    await writeAiUsageLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      surface: "console",
      action: "speak_text",
      provider: "alibaba_qwen",
      model: speech.model,
      requestId: args.requestId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin,
      inputChars: text.length,
      outputChars: text.length,
      latencyMs: Date.now() - startedAt,
      status: "SUCCESS",
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });

    await writeAiAudit({
      req: args.req,
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      surface: "console",
      action: "speak_text",
      provider: "alibaba_qwen",
      model: speech.model,
      status: "SUCCESS",
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      actionClass: policy.actionClass,
      reasoningLevel: policy.reasoningLevel,
      weightedUsageUnits: policy.weightedUsageUnits,
      latencyMs: Date.now() - startedAt,
      outcome: "spoken",
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin,
    });

    return {
      providerId: "alibaba_qwen",
      model: speech.model,
      contentType: speech.contentType || "audio/mpeg",
      audioBuffer: speech.audioBuffer,
    };
  } catch (error) {
    const mapped = mapProviderError(error);

    await writeAiUsageLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      surface: "console",
      action: "speak_text",
      provider: "alibaba_qwen",
      model: modelOverride || ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
      requestId: args.requestId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin,
      inputChars: text.length,
      outputChars: 0,
      latencyMs: Date.now() - startedAt,
      status: "ERROR",
      errorCode: mapped.code,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });

    await writeAiAudit({
      req: args.req,
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      surface: "console",
      action: "speak_text",
      provider: "alibaba_qwen",
      model: modelOverride || ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
      status: "ERROR",
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      actionClass: policy?.actionClass || "audio_speech",
      reasoningLevel: policy?.reasoningLevel || "low",
      weightedUsageUnits: policy?.weightedUsageUnits || 0,
      latencyMs: Date.now() - startedAt,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin,
      errorCode: mapped.code,
      outcome: "failed",
    });

    throw mapped;
  } finally {
    policy?.releaseGenerationSlot();
  }
}

export async function runCavCodeAssist(args: {
  req: Request;
  requestId: string;
  input: CavCodeAssistRequest;
}): Promise<AiAssistResponseEnvelope<CavCodeAssistResponse>> {
  const startedAt = Date.now();
  const ctx = await requireAiRequestContext({
    req: args.req,
    surface: "cavcode",
    projectId: args.input.projectId,
    workspaceId: args.input.workspaceId,
  });
  const queueEnabled = args.input.queueEnabled === true;
  const requestedAgentId = s(args.input.agentId).toLowerCase();
  const requestedAgentActionKey = s(args.input.agentActionKey).toLowerCase();
  const selectedCustomAgent = await resolveInstalledCavenCustomAgentSafe({
    accountId: ctx.accountId,
    userId: ctx.userId,
    runtimeSurface: "cavcode",
    agentId: requestedAgentId || null,
    agentActionKey: requestedAgentActionKey || null,
  });
  if ((requestedAgentId || requestedAgentActionKey) && !selectedCustomAgent) {
    throw new AiServiceError(
      "AGENT_NOT_AVAILABLE",
      "Selected agent is unavailable or not installed for CavCode.",
      403
    );
  }
  const installedActionResolution = selectedCustomAgent
    ? { action: args.input.action, downgraded: false }
    : await resolveInstalledCavCodeActionSafe({
        accountId: ctx.accountId,
        userId: ctx.userId,
        planId: ctx.planId,
        requestedAction: args.input.action,
      });
  const effectiveAction = selectedCustomAgent
    ? inferCavCodeActionFromCustomAgent({
        agent: selectedCustomAgent,
        prompt: s(args.input.prompt),
        goal: args.input.goal || null,
        fallback: args.input.action,
      })
    : (installedActionResolution.action as CavCodeAssistAction);
  const actionForAudit = selectedCustomAgent
    ? (s(selectedCustomAgent.actionKey).toLowerCase() || effectiveAction)
    : effectiveAction;
  const inputContextRaw =
    args.input.context && typeof args.input.context === "object" ? (args.input.context as Record<string, unknown>) : {};
  const routeAwareContext = resolveRouteAwarenessContext({
    req: args.req,
    inputContext: inputContextRaw,
    origin: null,
    contextLabel: "CavCode context",
    workspaceId: args.input.workspaceId || null,
    projectId: args.input.projectId || null,
  });
  const uploadedWorkspaceFiles = await resolveUploadedWorkspaceFilesForAi({
    accountId: ctx.accountId,
    context: inputContextRaw,
  });
  const uploadedWorkspaceFileMeta = uploadedWorkspaceFiles.map((file) => ({
    id: file.id,
    cavcloudFileId: s(file.cavcloudFileId) || null,
    cavcloudPath: s(file.cavcloudPath) || null,
    path: s(file.path) || null,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    snippet: file.snippet || null,
  }));
  const imageAttachmentMeta = (args.input.imageAttachments || []).map((item) => ({
    id: item.id,
    assetId: s(item.assetId) || null,
    name: item.name,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    hasDataUrl: Boolean(s(item.dataUrl)),
    hasAssetId: Boolean(s(item.assetId) || s(item.id)),
  }));
  const imageAttachmentsForRetry = (args.input.imageAttachments || []).map((item) => ({
    id: item.id,
    assetId: s(item.assetId) || s(item.id) || null,
    name: item.name,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    dataUrl: s(item.dataUrl) || null,
  }));
  const userPrompt = s(args.input.prompt) || s(args.input.goal) || `${actionForAudit} ${args.input.filePath}`;
  const taskType = classifyAiTaskType({
    surface: "cavcode",
    action: effectiveAction,
    prompt: userPrompt,
    goal: args.input.goal || null,
  });
  const initialSessionId = s(args.input.sessionId) || null;
  const memoryFacts = await retrieveRelevantAiUserMemoryFactsSafe({
    accountId: ctx.accountId,
    userId: ctx.userId,
    prompt: userPrompt,
    goal: args.input.goal || null,
    limit: 4,
    sessionId: initialSessionId,
    requestId: args.requestId,
  }).catch(() => []);
  const {
    routeManifestCoverageContext,
    websiteKnowledgeContext,
  } = await loadRouteAndWebsiteContextEnrichments({
    accountId: ctx.accountId,
    userId: ctx.userId,
    sessionId: initialSessionId,
    requestId: args.requestId,
    surface: "cavcode",
    action: effectiveAction,
    taskType,
    prompt: userPrompt,
    goal: args.input.goal || null,
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    routeAwareContext,
  });
  const inputContext: Record<string, unknown> = {
    ...routeAwareContext,
    ...inputContextRaw,
    uploadedWorkspaceFiles: uploadedWorkspaceFileMeta,
    ...(routeManifestCoverageContext ? { routeManifestCoverage: routeManifestCoverageContext } : {}),
    ...(websiteKnowledgeContext ? { websiteKnowledge: websiteKnowledgeContext } : {}),
  };
  const contextPack = buildSurfaceContextPack({
    surface: "cavcode",
    taskType,
    prompt: userPrompt,
    goal: args.input.goal || null,
    context: inputContext,
    injectedContext: {
      filePath: args.input.filePath,
      language: args.input.language || null,
      selectedCode: clampText(args.input.selectedCode || "", 8_000),
      diagnostics: (args.input.diagnostics || []).slice(0, 32),
      imageAttachments: imageAttachmentMeta,
      uploadedWorkspaceFiles: uploadedWorkspaceFileMeta,
      activeProjectRootPath: s(inputContext.activeProjectRootPath) || null,
      memoryFacts: memoryFacts.map((row) => ({
        key: row.factKey,
        value: row.factValue,
        category: row.category,
        confidence: row.confidence,
      })),
      ...(routeManifestCoverageContext ? { routeManifestCoverage: routeManifestCoverageContext } : {}),
      ...(websiteKnowledgeContext ? { websiteKnowledge: websiteKnowledgeContext } : {}),
      customAgent: selectedCustomAgent
        ? normalizeCustomAgentRuntimePayload(selectedCustomAgent)
        : null,
    },
  });
  const qwenContextTokens = await estimateContextTokensForSnapshotSafe({
    contextPack,
    selectedCode: args.input.selectedCode || null,
    diagnostics: args.input.diagnostics || [],
    context: inputContext,
    prompt: userPrompt,
  });
  const queueMessageId = s(args.input.queueMessageId) || "";
  let providerId = "deepseek";
  let model = "";
  let sessionId = initialSessionId || "";
  let policy: AiExecutionPolicy | null = null;
  let executionMeta: AiExecutionMeta | null = null;
  let actionClassForAudit: AiActionClass = "standard";
  let reasoningLevelForAudit: "low" | "medium" | "high" | "extra_high" = "medium";
  let latestPromptTokens = 0;
  let latestCompletionTokens = 0;
  const modelRole = resolveModelRoleForCavCodeAction(effectiveAction);
  let reasoningProfile = resolveReasoningProfile(args.input.reasoningLevel || "medium", modelRole);
  const effectiveInput: CavCodeAssistRequest = {
    ...args.input,
    action: effectiveAction,
    ...(requestedAgentId ? { agentId: requestedAgentId } : {}),
    ...(requestedAgentActionKey ? { agentActionKey: requestedAgentActionKey } : {}),
  };

  const buildSessionContextJson = (resolvedModel: string | null) => ({
    surface: "cavcode",
    workspaceId: ctx.workspaceId || null,
    projectId: ctx.projectId || null,
    model: resolvedModel || s(args.input.model) || null,
    reasoningLevel: policy?.reasoningLevel || reasoningProfile.level,
    queueEnabled,
    projectRootPath: s(inputContext.activeProjectRootPath) || null,
    activeFilePath: args.input.filePath,
    actionClass: policy?.actionClass || null,
    weightedUsageUnits: policy?.weightedUsageUnits || null,
  });

  try {
    const activeProjectRootPath = s(inputContext.activeProjectRootPath);
    if (activeProjectRootPath && !isPathInsideRoot(args.input.filePath, activeProjectRootPath)) {
      throw new AiServiceError(
        "AI_SCOPE_OUT_OF_BOUNDS",
        "Requested file path is outside the mounted project root scope.",
        403,
        {
          activeProjectRootPath,
          filePath: args.input.filePath,
        }
      );
    }

    policy = await resolveAiExecutionPolicy({
      accountId: ctx.accountId,
      userId: ctx.userId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      surface: "cavcode",
      action: effectiveAction,
      taskType,
      requestedModel: s(args.input.model) || null,
      requestedReasoningLevel: args.input.reasoningLevel || null,
      promptText: userPrompt,
      context: inputContext,
      imageAttachmentCount: imageAttachmentMeta.length,
      fileAttachmentCount: uploadedWorkspaceFileMeta.length,
      sessionId: sessionId || null,
      requestId: args.requestId,
      isExecution: true,
    });
    await persistAiModelSelectionEvent({
      accountId: ctx.accountId,
      userId: ctx.userId,
      sessionId: sessionId || null,
      requestId: args.requestId,
      surface: "cavcode",
      action: actionForAudit,
      taskType,
      actionClass: policy.actionClass,
      planId: ctx.planId,
      requestedModel: policy.requestedModel,
      resolvedModel: policy.model,
      providerId: policy.providerId,
      reasoningLevel: policy.reasoningLevel,
      manualSelection: policy.manualModelSelected,
      fallbackReason: policy.modelFallbackReason,
    });
    const retryFromMessageId = s(inputContext.retryFromMessageId);
    const retryFromSessionId = s(inputContext.retryFromSessionId) || s(args.input.sessionId);
    if (retryFromMessageId) {
      await persistAiRetryEvent({
        accountId: ctx.accountId,
        userId: ctx.userId,
        sessionId: retryFromSessionId || sessionId || "unspecified",
        requestId: args.requestId,
        surface: "cavcode",
        action: actionForAudit,
        taskType,
        sourceMessageId: retryFromMessageId,
        sourceSessionId: retryFromSessionId || null,
        model: policy.model,
        reasoningLevel: policy.reasoningLevel,
        researchMode: false,
        contextJson: {
          queueEnabled,
          filePath: args.input.filePath,
        },
      });
    }
    actionClassForAudit = policy.actionClass;
    reasoningLevelForAudit = policy.reasoningLevel;
    reasoningProfile = resolveReasoningProfile(policy.reasoningLevel, modelRole);
    const reasoningDirective = resolveReasoningDirective({
      level: policy.reasoningLevel,
      actionClass: policy.actionClass,
    });
    const cavCodePromptBody = cavCodeUserPrompt(effectiveInput, contextPack, selectedCustomAgent, uploadedWorkspaceFiles);

    if (isCavCodeImageAction(effectiveAction)) {
      const mode: "studio" | "edit" = effectiveAction === "app_screenshot_enhancer" ? "edit" : "studio";
      const imagePromptInput = [s(args.input.prompt), s(args.input.goal)].filter(Boolean).join("\n\n") || userPrompt;
      const imageStudioContext = parseImageStudioRequestContext(inputContext);
      const imageStudioPlanTier = await toImageStudioPlanTierSafe(ctx.planId);
      const preset = await getImagePresetByIdSafe({
        presetId: imageStudioContext.presetId,
        slug: imageStudioContext.presetSlug,
        planTier: imageStudioPlanTier,
      });
      if (preset?.locked) {
        throw new AiServiceError(
          "AI_IMAGE_PRESET_PLAN_LOCKED",
          "Selected image preset requires a higher plan tier.",
          403
        );
      }
      const imagePromptResolution = resolveImageStudioPromptInput({
        mode,
        promptText: imagePromptInput,
        presetLabel: preset?.label || null,
      });

      const resolvedImagePrompt = await buildImageStudioPromptSafe({
        mode: mode === "edit" ? "edit" : "generate",
        userPrompt: imagePromptResolution.effectivePrompt,
        preset,
        aspectRatio: imageStudioContext.aspectRatio,
        variantCount: imageStudioContext.variantCount,
        brandContext: imageStudioContext.brandContext,
        transformMode: imageStudioContext.transformMode,
      });

      let sourceAssetInput:
        | {
            assetId: string;
            dataUrl: string;
            mimeType: string;
            fileName: string;
          }
        | null = null;
      if (mode === "edit" && imageStudioContext.sourceAssetId) {
        const resolved = await resolveDataUrlForAssetSafe({
          accountId: ctx.accountId,
          userId: ctx.userId,
          assetId: imageStudioContext.sourceAssetId,
        });
        if (resolved) {
          sourceAssetInput = {
            assetId: imageStudioContext.sourceAssetId,
            dataUrl: resolved.dataUrl,
            mimeType: resolved.mimeType,
            fileName: resolved.fileName,
          };
        }
      }

      let imageJobId = "";
      try {
        imageJobId = await startImageJobSafe({
          accountId: ctx.accountId,
          userId: ctx.userId,
          sessionId: sessionId || null,
          requestId: args.requestId,
          planTier: imageStudioPlanTier,
          mode: mode === "edit" ? "edit" : "generate",
          actionSource: "cavcode",
          agentId: effectiveAction,
          agentActionKey: effectiveAction,
          prompt: imagePromptResolution.customInstruction || "",
          resolvedPrompt: resolvedImagePrompt,
          presetId: preset?.id || null,
          modelUsed: policy.model,
          inputAssetRefs: {
            sourceAssetId: sourceAssetInput?.assetId || imageStudioContext.sourceAssetId || null,
            attachmentIds: imageAttachmentsForRetry.map((row) => s(row.assetId) || s(row.id)).filter(Boolean),
            attachmentCount: imageAttachmentMeta.length,
          },
        });

        let imageResult: Awaited<ReturnType<typeof generateAlibabaQwenImage>>;
        if (mode === "edit") {
          const sourceEditFile = sourceAssetInput
            ? dataUrlToFile(sourceAssetInput.dataUrl, sourceAssetInput.fileName || "cavcode-edit-input.png")
            : null;
          let attachmentEditFile: File | null = null;
          if (!sourceEditFile) {
            for (const attachment of imageAttachmentsForRetry) {
              attachmentEditFile = await resolveAttachmentFile({
                accountId: ctx.accountId,
                userId: ctx.userId,
                attachment,
                fallbackName: "cavcode-edit-input.png",
              });
              if (attachmentEditFile) break;
            }
          }
          const fileForEdit = sourceEditFile || attachmentEditFile;
          if (!fileForEdit) {
            throw new AiServiceError(
              "AI_IMAGE_EDIT_INPUT_REQUIRED",
              "App Screenshot Enhancer requires an uploaded or imported image input.",
              400
            );
          }
          imageResult = await editAlibabaQwenImage({
            prompt: resolvedImagePrompt,
            image: fileForEdit,
            model: policy.model,
            timeoutMs: policy.requestLimits.maxExecutionTimeMs,
            signal: args.req.signal,
          });
        } else {
          imageResult = await generateAlibabaQwenImage({
            prompt: resolvedImagePrompt,
            model: policy.model,
            timeoutMs: policy.requestLimits.maxExecutionTimeMs,
            signal: args.req.signal,
          });
        }

        providerId = "alibaba_qwen";
        model = policy.model;
        const generatedImages = imageResult.images
          .map((row) => ({
            ...(s(row.url) ? { url: s(row.url) } : {}),
            ...(s(row.b64Json) ? { b64Json: s(row.b64Json) } : {}),
          }))
          .filter((row) => Object.keys(row).length > 0);
        if (!generatedImages.length) {
          throw new AiServiceError("ALIBABA_QWEN_EMPTY_IMAGE_RESPONSE", "Image model returned no output assets.", 502);
        }

        const persistedImages: Array<{
          assetId: string;
          url?: string;
          b64Json?: string;
          fileName: string;
          mimeType: string;
        }> = [];

        for (let index = 0; index < generatedImages.length; index += 1) {
          const generated = generatedImages[index];
          const providerImage = imageResult.images[index];
          const b64Json = s(generated.b64Json);
          const mimeType = "image/png";
          const nowTs = Date.now();
          const fileName = `${mode === "edit" ? "cavbot-edit" : "cavbot-image"}-${nowTs}-${index + 1}.png`;
          const assetId = await createImageAssetSafe({
            accountId: ctx.accountId,
            userId: ctx.userId,
            jobId: imageJobId,
            presetId: preset?.id || null,
            sourceKind: mode === "edit" ? "edited" : "generated",
            originalSource: mode === "edit" ? "image_edit_model" : "image_generation_model",
            fileName,
            mimeType,
            bytes: b64Json ? Math.max(0, Math.trunc((b64Json.length * 3) / 4)) : 0,
            format: "png",
            externalUrl: s(generated.url) || null,
            dataUrl: b64Json ? `data:${mimeType};base64,${b64Json}` : null,
            b64Data: b64Json || null,
            sourcePrompt: imagePromptResolution.customInstruction || null,
            metadata: {
              revisedPrompt: s(providerImage?.revisedPrompt) || null,
              outputIndex: index,
              action: effectiveAction,
              sourceAssetId: sourceAssetInput?.assetId || imageStudioContext.sourceAssetId || null,
              activationLine: imagePromptResolution.activationLine,
              activationLineUnchanged: imagePromptResolution.activationLineUnchanged,
            },
          });

          await appendUserImageHistorySafe({
            accountId: ctx.accountId,
            userId: ctx.userId,
            jobId: imageJobId,
            assetId,
            entryType: mode === "edit" ? "edited" : "generated",
            mode: mode === "edit" ? "edit" : "generate",
            promptSummary: centerImageSummaryFromPrompt(
              imagePromptResolution.customInstruction || imagePromptInput,
              mode
            ),
            saved: false,
          });

          persistedImages.push({
            assetId,
            ...(s(generated.url) ? { url: s(generated.url) } : {}),
            ...(b64Json ? { b64Json } : {}),
            fileName,
            mimeType,
          });
        }

        await completeImageJobSafe({
          jobId: imageJobId,
          accountId: ctx.accountId,
          userId: ctx.userId,
          outputAssetRefs: persistedImages.map((row, index) => ({
            assetId: row.assetId,
            outputIndex: index,
            fileName: row.fileName,
            mimeType: row.mimeType,
            url: row.url || null,
          })),
        });

        const imageStudioPayload = {
          mode: mode === "edit" ? "edit" : "generate",
          jobId: imageJobId,
          presetId: preset?.id || null,
          presetLabel: preset?.label || null,
          sourcePrompt: imagePromptResolution.customInstruction || null,
          activationLine: imagePromptResolution.activationLine,
          activationLineUnchanged: imagePromptResolution.activationLineUnchanged,
          sourceAssetId: sourceAssetInput?.assetId || imageStudioContext.sourceAssetId || null,
          assets: persistedImages,
        };

        const data: CavCodeAssistResponse = {
          summary: mode === "edit"
            ? "Screenshot enhancement completed."
            : "Visual generation completed.",
          risk: "low",
          changes: mode === "edit"
            ? ["Applied screenshot enhancement pipeline using Qwen-Image-Edit-Max."]
            : ["Generated visual assets using Qwen-Image-2.0-Pro."],
          proposedCode: effectiveAction === "ui_mockup_generator" ? buildUiMockupCodeDraft(userPrompt) : "",
          generatedImages,
          notes: [
            effectiveAction === "ui_mockup_generator"
              ? "UI Mockup Generator returned a starter React scaffold plus visual assets."
              : "Asset output is ready for CavCloud or project insertion flow.",
          ],
          followUpChecks: [
            "Verify brand alignment, spacing, and copy quality before publishing.",
            "Generate 2-3 variants and compare conversion-fit or readability.",
          ],
          targetFilePath: args.input.filePath,
        };

        const quality = evaluateAiAnswerQuality({
          prompt: userPrompt,
          goal: args.input.goal || null,
          answer: textFromStructuredOutput(data),
          surface: "cavcode",
          taskType,
          contextSignals: contextPack.signalsUsed,
        });

        executionMeta = buildExecutionMeta({
          startedAtMs: startedAt,
          surface: "cavcode",
          action: actionForAudit,
          actionClass: policy.actionClass,
          prompt: userPrompt,
          model,
          providerId,
          reasoningLevel: policy.reasoningLevel,
          taskType,
          researchMode: false,
          contextSignals: contextPack.signalsUsed,
          quality,
          repairAttempted: false,
          repairApplied: false,
          checksPerformed: ["image_output_validation"],
          answerPath: ["image_model_generation"],
        });

        sessionId = await persistSessionTurn({
          accountId: ctx.accountId,
          userId: ctx.userId,
          requestId: args.requestId,
          action: actionForAudit,
          surface: "cavcode",
          sessionId: sessionId || null,
          contextLabel: "CavCode context",
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          origin: null,
          userText: userPrompt,
          userJson: buildCavCodeRetryUserJson({
            input: effectiveInput,
            model: policy.model,
            reasoningLevel: policy.reasoningLevel,
            queueEnabled,
            imageAttachments: imageAttachmentsForRetry,
            taskType,
            contextPack,
            context: inputContext,
          }),
          assistantText: data.summary,
          assistantJson: {
            ...data,
            imageStudio: imageStudioPayload,
            __cavAiMeta: executionMeta,
          },
          provider: providerId,
          model,
          status: "SUCCESS",
          sessionContextJson: buildSessionContextJson(model),
        });

        await persistAiReasoningTrace({
          accountId: ctx.accountId,
          userId: ctx.userId,
          sessionId,
          requestId: args.requestId,
          surface: "cavcode",
          action: actionForAudit,
          taskType,
          actionClass: policy.actionClass,
          provider: providerId,
          model,
          reasoningLevel: policy.reasoningLevel,
          researchMode: false,
          durationMs: executionMeta.durationMs,
          showReasoningChip: executionMeta.showReasoningChip,
          repairAttempted: false,
          repairApplied: false,
          quality: executionMeta.quality as unknown as Record<string, unknown>,
          safeSummary: executionMeta.safeSummary as unknown as Record<string, unknown>,
          contextSignals: executionMeta.contextSignals,
          checksPerformed: ["image_output_validation"],
          answerPath: ["image_model_generation"],
        });

        await learnAiUserMemoryFromPromptSafe({
          accountId: ctx.accountId,
          userId: ctx.userId,
          sessionId,
          requestId: args.requestId,
          userPrompt,
          sourceMessageId: retryFromMessageId || null,
        });

        if (queueMessageId && sessionId) {
          await settleCavCodeQueuedPromptSafe({
            accountId: ctx.accountId,
            sessionId,
            messageId: queueMessageId,
            status: "PROCESSED",
            result: {
              summary: data.summary,
              targetFilePath: data.targetFilePath || args.input.filePath,
              requestId: args.requestId,
            },
          });
        }

        await writeAiUsageLog({
          accountId: ctx.accountId,
          userId: ctx.userId,
          surface: "cavcode",
          action: actionForAudit,
          provider: providerId,
          model,
          requestId: args.requestId,
          runId: null,
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          inputChars: resolvedImagePrompt.length,
          outputChars: data.summary.length,
          latencyMs: Date.now() - startedAt,
          status: "SUCCESS",
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        });

        await writeAiAudit({
          req: args.req,
          accountId: ctx.accountId,
          userId: ctx.userId,
          requestId: args.requestId,
          surface: "cavcode",
          action: actionForAudit,
          provider: providerId,
          model,
          status: "SUCCESS",
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          memberRole: ctx.memberRole,
          planId: ctx.planId,
          actionClass: policy.actionClass,
          reasoningLevel: policy.reasoningLevel,
          weightedUsageUnits: policy.weightedUsageUnits,
          latencyMs: Date.now() - startedAt,
          scopePath: args.input.filePath,
          outcome: mode === "edit" ? "image_edited" : "image_generated",
        });

        return {
          ok: true,
          requestId: args.requestId,
          providerId,
          model,
          sessionId,
          meta: executionMeta || undefined,
          data,
        };
      } catch (error) {
        if (imageJobId) {
          await failImageJobSafe({
            jobId: imageJobId,
            accountId: ctx.accountId,
            userId: ctx.userId,
            errorMessage: error instanceof Error ? error.message : "Image request failed.",
          }).catch(() => undefined);
        }
        throw error;
      }
    }

    const providerCall = await runProviderJson({
      modelRole,
      modelOverride: policy.model,
      messages: [
        { role: "system", content: cavCodeSystemPrompt(reasoningDirective, policy.actionClass, taskType, selectedCustomAgent) },
        { role: "user", content: cavCodePromptBody },
      ],
      maxTokensOverride: reasoningProfile.maxTokens,
      timeoutMs: Math.min(reasoningProfile.timeoutMs, policy.requestLimits.maxExecutionTimeMs),
        signal: args.req.signal,
        metadata: {
          surface: "cavcode",
          action: actionForAudit,
        actionClass: policy.actionClass,
        plan: ctx.planId,
        reasoningLevel: policy.reasoningLevel,
        queueEnabled,
        imageAttachmentCount: imageAttachmentMeta.length,
      },
    });
    providerId = providerCall.providerId;
    model = providerCall.model;
    let finalProviderResponse = providerCall.response;
    latestPromptTokens = Math.max(0, Number(providerCall.response.usage.promptTokens || 0));
    latestCompletionTokens = Math.max(0, Number(providerCall.response.usage.completionTokens || 0));

    if (providerCall.response.content.length > Math.min(policy.requestLimits.maxOutputChars, reasoningProfile.maxOutputChars)) {
      throw new AiServiceError(
        "AI_OUTPUT_TOO_LARGE",
        "AI output exceeded allowed response size for this action.",
        502
      );
    }

    const parsed = CAVCODE_ASSIST_RESPONSE_SCHEMA.safeParse(providerCall.parsed);
    if (!parsed.success) {
      throw new AiServiceError(
        "INVALID_PROVIDER_SHAPE",
        "Provider JSON did not match the required CavCode response schema.",
        502,
        parsed.error.flatten()
      );
    }

    let data: CavCodeAssistResponse = {
      ...parsed.data,
      targetFilePath: args.input.filePath,
    };
    const checksPerformed: string[] = [
      "output_size_check",
      "schema_validation",
      "semantic_validation",
    ];
    const answerPath: string[] = ["initial_generation"];
    let quality = evaluateAiAnswerQuality({
      prompt: userPrompt,
      goal: args.input.goal || null,
      answer: textFromStructuredOutput(data),
      surface: "cavcode",
      taskType,
      contextSignals: contextPack.signalsUsed,
    });
    let repairAttempted = false;
    let repairApplied = false;
    let fallbackApplied = false;
    let softFailAccepted = false;
    const shouldTryRepair = shouldAttemptSemanticRepair({
      quality,
      answerText: textFromStructuredOutput(data),
      startedAtMs: startedAt,
      maxExecutionTimeMs: policy.requestLimits.maxExecutionTimeMs,
      minimumUsefulChars: isCavCodeWriteAction(effectiveAction) ? 120 : 72,
      force: isCavCodeWriteAction(effectiveAction),
    });

    if (!quality.passed && shouldTryRepair) {
      repairAttempted = true;
      checksPerformed.push("semantic_repair_pass");
      answerPath.push("repair_generation");
      const repairDirective = buildSemanticRepairDirective({
        taskType,
        surface: "cavcode",
        reasons: quality.reasons,
      });

      try {
        const repairCall = await runProviderJson({
          modelRole,
          modelOverride: policy.model,
          messages: [
            { role: "system", content: cavCodeSystemPrompt(reasoningDirective, policy.actionClass, taskType, selectedCustomAgent) },
            {
              role: "user",
              content: [
                cavCodePromptBody,
                "",
                "Previous JSON answer:",
                toStableJson(data, 14_000),
                "",
                repairDirective,
              ].join("\n"),
            },
          ],
          maxTokensOverride: reasoningProfile.maxTokens,
          timeoutMs: Math.min(reasoningProfile.timeoutMs, policy.requestLimits.maxExecutionTimeMs),
          signal: args.req.signal,
          metadata: {
            surface: "cavcode",
            action: actionForAudit,
            actionClass: policy.actionClass,
            plan: ctx.planId,
            reasoningLevel: policy.reasoningLevel,
            semanticRepair: true,
          },
        });
        const repairParsed = CAVCODE_ASSIST_RESPONSE_SCHEMA.safeParse(repairCall.parsed);
        if (repairParsed.success) {
          const repairedData: CavCodeAssistResponse = {
            ...repairParsed.data,
            targetFilePath: args.input.filePath,
          };
          const repairedQuality = evaluateAiAnswerQuality({
            prompt: userPrompt,
            goal: args.input.goal || null,
            answer: textFromStructuredOutput(repairedData),
            surface: "cavcode",
            taskType,
            contextSignals: contextPack.signalsUsed,
          });
          if (repairedQuality.passed || repairedQuality.overall >= quality.overall) {
            data = repairedData;
            quality = repairedQuality;
            repairApplied = true;
            finalProviderResponse = repairCall.response;
            latestPromptTokens = Math.max(0, Number(repairCall.response.usage.promptTokens || 0));
            latestCompletionTokens = Math.max(0, Number(repairCall.response.usage.completionTokens || 0));
          }
        }
      } catch {
        // Keep initial response when repair pass fails.
      }
    }

    if (!quality.passed) {
      const hasUsableCavCodeAnswer = s(textFromStructuredOutput(data)).length >= 72;
      const shouldAcceptSoftFail = !quality.hardFail && !isCavCodeWriteAction(effectiveAction) && hasUsableCavCodeAnswer;
      if (shouldAcceptSoftFail) {
        checksPerformed.push("semantic_soft_fail_accepted");
        answerPath.push("soft_fail_keep_model_output");
        softFailAccepted = true;
      } else {
        checksPerformed.push("semantic_fallback");
        answerPath.push("fallback_generation");
        const fallbackData = buildSafeCavCodeFallbackResponse({
          input: effectiveInput,
        });
        const fallbackQuality = evaluateAiAnswerQuality({
          prompt: userPrompt,
          goal: args.input.goal || null,
          answer: textFromStructuredOutput(fallbackData),
          surface: "cavcode",
          taskType,
          contextSignals: contextPack.signalsUsed,
        });
        data = fallbackData;
        quality = fallbackQuality;
        repairApplied = true;
        fallbackApplied = true;
      }
    }

    if (!quality.passed) {
      const hasConcreteCodeFallback = s(data.proposedCode).length > 0;
      if (!softFailAccepted && (!fallbackApplied || !hasConcreteCodeFallback)) {
        throw new AiServiceError(
          "AI_SEMANTIC_VALIDATION_FAILED",
          "AI response failed semantic relevance checks for this coding request.",
          502,
          {
            taskType,
            reasons: quality.reasons,
            quality,
          }
        );
      }
    }

    executionMeta = buildExecutionMeta({
      startedAtMs: startedAt,
      surface: "cavcode",
      action: actionForAudit,
      actionClass: policy.actionClass,
      prompt: userPrompt,
      model,
      providerId,
      reasoningLevel: policy.reasoningLevel,
      taskType,
      researchMode: false,
      contextSignals: contextPack.signalsUsed,
      quality,
      repairAttempted,
      repairApplied,
      checksPerformed,
      answerPath,
    });

    const isWriteAction = isCavCodeWriteAction(effectiveAction);
    if (isWriteAction) {
      const approvalReminder = "Review and approve the patch/diff before applying file changes.";
      if (!data.followUpChecks.some((item) => s(item).toLowerCase() === approvalReminder.toLowerCase())) {
        data.followUpChecks = [...data.followUpChecks, approvalReminder];
      }
    }

    if (effectiveAction === "write_note") {
      await persistAiNarration({
        accountId: ctx.accountId,
        userId: ctx.userId,
        requestId: args.requestId,
        provider: providerId,
        model,
        runId: null,
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        narrationJson: {
          summary: data.summary,
          notes: data.notes,
          followUpChecks: data.followUpChecks,
          sourceAction: actionForAudit,
          filePath: args.input.filePath,
        },
      });
    }

    if (isCavCodeWriteAction(effectiveAction)) {
      const pipelineDraft = buildFixPipelineDraft({
        filePath: args.input.filePath,
        proposedCode: data.proposedCode,
        evidenceSummary: data.changes,
      });
      await persistAiFixPlan({
        accountId: ctx.accountId,
        userId: ctx.userId,
        requestId: args.requestId,
        priorityCode: "cavcode_assist",
        source: "llm",
        status: "PROPOSED",
        runId: null,
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        planJson: {
          action: actionForAudit,
          filePath: args.input.filePath,
          summary: data.summary,
          risk: data.risk,
          changes: data.changes,
          proposedCode: data.proposedCode,
          notes: data.notes,
          followUpChecks: data.followUpChecks,
          pipelineDraft,
        },
      });
    }

    sessionId = await persistSessionTurn({
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      action: actionForAudit,
      surface: "cavcode",
      sessionId: sessionId || null,
      contextLabel: "CavCode context",
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: null,
      userText: userPrompt,
      userJson: buildCavCodeRetryUserJson({
        input: effectiveInput,
        model: policy.model,
        reasoningLevel: policy.reasoningLevel,
        queueEnabled,
        imageAttachments: imageAttachmentsForRetry,
        taskType,
        contextPack,
        context: inputContext,
      }),
      assistantText: data.summary,
      assistantJson: {
        ...data,
        __cavAiMeta: executionMeta,
      },
      provider: providerId,
      model,
      status: "SUCCESS",
      sessionContextJson: buildSessionContextJson(model),
    });

    await persistAiReasoningTrace({
      accountId: ctx.accountId,
      userId: ctx.userId,
      sessionId,
      requestId: args.requestId,
      surface: "cavcode",
      action: actionForAudit,
      taskType,
      actionClass: policy.actionClass,
      provider: providerId,
      model,
      reasoningLevel: policy.reasoningLevel,
      researchMode: false,
      durationMs: executionMeta.durationMs,
      showReasoningChip: executionMeta.showReasoningChip,
      repairAttempted,
      repairApplied,
      quality: executionMeta.quality as unknown as Record<string, unknown>,
      safeSummary: executionMeta.safeSummary as unknown as Record<string, unknown>,
      contextSignals: executionMeta.contextSignals,
      checksPerformed,
      answerPath,
    });

    await learnAiUserMemoryFromPromptSafe({
      accountId: ctx.accountId,
      userId: ctx.userId,
      sessionId,
      requestId: args.requestId,
      userPrompt,
      sourceMessageId: retryFromMessageId || null,
    });

    if (queueMessageId && sessionId) {
      await settleCavCodeQueuedPromptSafe({
        accountId: ctx.accountId,
        sessionId,
        messageId: queueMessageId,
        status: "PROCESSED",
        result: {
          summary: data.summary,
          targetFilePath: data.targetFilePath || args.input.filePath,
          requestId: args.requestId,
        },
      });
    }

    await writeAiUsageLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      surface: "cavcode",
      action: actionForAudit,
      provider: providerId,
      model,
      requestId: args.requestId,
      runId: null,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      inputChars: cavCodePromptBody.length,
      outputChars: finalProviderResponse.content.length,
      latencyMs: Date.now() - startedAt,
      status: "SUCCESS",
      ...usageFromResponse(finalProviderResponse),
    });

    await writeAiAudit({
      req: args.req,
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      surface: "cavcode",
      action: actionForAudit,
      provider: providerId,
      model,
      status: "SUCCESS",
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      actionClass: policy.actionClass,
      reasoningLevel: policy.reasoningLevel,
      weightedUsageUnits: policy.weightedUsageUnits,
      latencyMs: Date.now() - startedAt,
      scopePath: args.input.filePath,
      outcome: isWriteAction ? "created_patch_proposal" : "response_generated",
    });

    if (policy.qwenCoderReservation && model === ALIBABA_QWEN_CODER_MODEL_ID) {
      const runtimeSeconds = Math.max(1, Math.ceil((Date.now() - startedAt) / 1000));
      const diffGenerated = Boolean(s(data.proposedCode));
      await finalizeQwenCoderChargeSafe({
        accountId: ctx.accountId,
        userId: ctx.userId,
        requestId: args.requestId,
        modelName: model,
        conversationId: sessionId || null,
        taskId: taskType,
        reason: "success",
        usage: {
          inputTokens: latestPromptTokens,
          retrievedContextTokens: qwenContextTokens,
          outputTokens: latestCompletionTokens,
          compactionTokens: 0,
          toolRuntimeSeconds: runtimeSeconds,
          diffGenerated,
          testsRun: hasCheck(data.followUpChecks, /\btest\b/),
          lintRun: hasCheck(data.followUpChecks, /\blint\b/),
          typecheckRun: hasCheck(data.followUpChecks, /\btypecheck\b|\btsc\b/),
          patchApplyAttempted: isWriteAction,
          complexity: toQwenComplexity({ actionClass: policy.actionClass, taskType }),
        },
      }).catch(() => {
        // Billing reconciliation is best-effort; reservation remains authoritative.
      });

      await captureQwenCoderContextSnapshotSafe({
        accountId: ctx.accountId,
        userId: ctx.userId,
        sessionId: sessionId || null,
        conversationId: sessionId || null,
        activeModel: model,
        currentContextTokens: qwenContextTokens,
      }).catch(() => {});
    }

    return {
      ok: true,
      requestId: args.requestId,
      providerId,
      model,
      sessionId,
      meta: executionMeta || undefined,
      data,
    };
  } catch (error) {
    const mapped = mapProviderError(error);
    const shouldReturnSafeFallback = shouldReturnSafeFallbackOnProviderFailure(mapped);

    if (shouldReturnSafeFallback) {
      const fallbackData = buildSafeCavCodeFallbackResponse({
        input: effectiveInput,
      });
      let fallbackSessionId = sessionId || "";

      try {
        fallbackSessionId = await persistSessionTurn({
          accountId: ctx.accountId,
          userId: ctx.userId,
          requestId: args.requestId,
          action: actionForAudit,
          surface: "cavcode",
          sessionId: sessionId || null,
          contextLabel: "CavCode context",
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          userText: userPrompt,
          userJson: buildCavCodeRetryUserJson({
            input: effectiveInput,
            model: policy?.model || s(args.input.model) || null,
            reasoningLevel: policy?.reasoningLevel || reasoningProfile.level,
            queueEnabled,
            imageAttachments: imageAttachmentsForRetry,
            taskType,
            contextPack,
            context: inputContext,
          }),
          assistantText: fallbackData.summary,
          assistantJson: {
            ...fallbackData,
            __cavAiMeta: {
              fallbackMode: true,
              fallbackReason: mapped.code,
              fallbackMessage: mapped.message,
            },
          },
          provider: providerId,
          model: model || policy?.model || undefined,
          status: "SUCCESS",
          sessionContextJson: buildSessionContextJson(model || policy?.model || null),
        });
      } catch {
        // Fallback response should still return even if persistence misses.
      }

      if (queueMessageId && fallbackSessionId) {
        await settleCavCodeQueuedPromptSafe({
          accountId: ctx.accountId,
          sessionId: fallbackSessionId,
          messageId: queueMessageId,
          status: "PROCESSED",
          result: {
            summary: fallbackData.summary,
            targetFilePath: fallbackData.targetFilePath || args.input.filePath,
            requestId: args.requestId,
          },
        }).catch(() => undefined);
      }

      await writeAiUsageLog({
        accountId: ctx.accountId,
        userId: ctx.userId,
        surface: "cavcode",
        action: actionForAudit,
        provider: providerId,
        model: model || policy?.model || "unknown",
        requestId: args.requestId,
        runId: null,
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        inputChars: cavCodeUserPrompt(effectiveInput, contextPack, selectedCustomAgent, uploadedWorkspaceFiles).length,
        outputChars: s(fallbackData.summary).length,
        latencyMs: Date.now() - startedAt,
        status: "SUCCESS",
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      });

      await writeAiAudit({
        req: args.req,
        accountId: ctx.accountId,
        userId: ctx.userId,
        requestId: args.requestId,
        surface: "cavcode",
        action: actionForAudit,
        provider: providerId,
        model: model || policy?.model || "unknown",
        status: "SUCCESS",
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        memberRole: ctx.memberRole,
        planId: ctx.planId,
        actionClass: actionClassForAudit,
        reasoningLevel: reasoningLevelForAudit,
        weightedUsageUnits: policy?.weightedUsageUnits || 0,
        latencyMs: Date.now() - startedAt,
        scopePath: args.input.filePath,
        outcome: "safe_fallback_response_generated",
      });

      return {
        ok: true,
        requestId: args.requestId,
        providerId,
        model: model || policy?.model || "unknown",
        sessionId: fallbackSessionId || undefined,
        data: fallbackData,
      };
    }

    if (sessionId || userPrompt) {
      try {
        await persistSessionTurn({
          accountId: ctx.accountId,
          userId: ctx.userId,
          requestId: args.requestId,
          action: actionForAudit,
          surface: "cavcode",
          sessionId: sessionId || null,
          contextLabel: "CavCode context",
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          userText: userPrompt,
          userJson: buildCavCodeRetryUserJson({
            input: effectiveInput,
            model: policy?.model || s(args.input.model) || null,
            reasoningLevel: policy?.reasoningLevel || reasoningProfile.level,
            queueEnabled,
            imageAttachments: imageAttachmentsForRetry,
            taskType,
            contextPack,
            context: inputContext,
          }),
          assistantText: mapped.message,
          assistantJson: {
            error: mapped.code,
            message: mapped.message,
          },
          provider: providerId,
          model: model || undefined,
          status: "ERROR",
          errorCode: mapped.code,
          sessionContextJson: buildSessionContextJson(model || null),
        });
      } catch {
        // no-op: avoid masking primary error
      }
    }

    const queueSessionId = sessionId || s(args.input.sessionId);
    if (queueMessageId && queueSessionId) {
      try {
        await settleCavCodeQueuedPromptSafe({
          accountId: ctx.accountId,
          sessionId: queueSessionId,
          messageId: queueMessageId,
          status: "ERROR",
          errorCode: mapped.code,
          result: {
            message: mapped.message,
            requestId: args.requestId,
          },
        });
      } catch {
        // no-op: avoid masking primary error
      }
    }

    await writeAiUsageLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      surface: "cavcode",
      action: actionForAudit,
      provider: providerId,
      model: model || "unknown",
      requestId: args.requestId,
      runId: null,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      inputChars: cavCodeUserPrompt(effectiveInput, contextPack, selectedCustomAgent, uploadedWorkspaceFiles).length,
      outputChars: 0,
      latencyMs: Date.now() - startedAt,
      status: "ERROR",
      errorCode: mapped.code,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });

    await writeAiAudit({
      req: args.req,
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      surface: "cavcode",
      action: actionForAudit,
      provider: providerId,
      model: model || "unknown",
      status: "ERROR",
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      actionClass: actionClassForAudit,
      reasoningLevel: reasoningLevelForAudit,
      weightedUsageUnits: policy?.weightedUsageUnits || 0,
      latencyMs: Date.now() - startedAt,
      scopePath: args.input.filePath,
      errorCode: mapped.code,
      outcome: "failed",
    });

    if (policy?.qwenCoderReservation && (policy.model === ALIBABA_QWEN_CODER_MODEL_ID || model === ALIBABA_QWEN_CODER_MODEL_ID)) {
      const isWriteActionForFailure = isCavCodeWriteAction(effectiveAction);
      const runtimeSeconds = Math.max(0, Math.ceil((Date.now() - startedAt) / 1000));
      const failedEarly = runtimeSeconds <= 2 && latestPromptTokens <= 0 && latestCompletionTokens <= 0;
      await refundOrAdjustQwenCoderChargeSafe({
        accountId: ctx.accountId,
        userId: ctx.userId,
        requestId: args.requestId,
        modelName: model || policy.model,
        conversationId: sessionId || null,
        taskId: taskType,
        reason: failedEarly ? "failure_early" : "failure_partial",
        usage: {
          inputTokens: latestPromptTokens,
          retrievedContextTokens: qwenContextTokens,
          outputTokens: latestCompletionTokens,
          compactionTokens: 0,
          toolRuntimeSeconds: runtimeSeconds,
          diffGenerated: isWriteActionForFailure,
          testsRun: false,
          lintRun: false,
          typecheckRun: false,
          patchApplyAttempted: isWriteActionForFailure,
          complexity: toQwenComplexity({ actionClass: policy.actionClass, taskType }),
        },
      }).catch(() => {});

      await captureQwenCoderContextSnapshotSafe({
        accountId: ctx.accountId,
        userId: ctx.userId,
        sessionId: sessionId || null,
        conversationId: sessionId || null,
        activeModel: model || policy.model,
        currentContextTokens: qwenContextTokens,
      }).catch(() => {});
    }

    return withGuard(mapped, {
      ok: false,
      requestId: args.requestId,
      error: mapped.code,
      message: mapped.message,
      status: mapped.status,
    });
  } finally {
    policy?.releaseGenerationSlot();
  }
}

type SurfaceRequest =
  | CavCloudAssistRequest
  | CavSafeAssistRequest
  | CavPadAssistRequest
  | ConsoleAssistRequest;

export async function runSurfaceAssist(args: {
  req: Request;
  requestId: string;
  surface: Exclude<AiSurface, "cavcode">;
  input: SurfaceRequest;
}): Promise<AiAssistResponseEnvelope<SurfaceAssistResponse>> {
  const startedAt = Date.now();
  const ctx = await requireAiRequestContext({
    req: args.req,
    surface: args.surface,
    projectId: args.input.projectId,
    workspaceId: args.input.workspaceId,
  });

  const action = s((args.input as { action?: unknown }).action);
  const modelRole = resolveModelRoleForSurfaceAction(args.surface, action);
  const userPrompt = s((args.input as { prompt?: unknown }).prompt) || s(args.input.goal);
  const taskType = classifyAiTaskType({
    surface: args.surface,
    action,
    prompt: userPrompt,
    goal: args.input.goal || null,
  });
  const inputContextRaw =
    args.input.context && typeof args.input.context === "object"
      ? (args.input.context as Record<string, unknown>)
      : {};
  const initialSessionId = s((args.input as { sessionId?: unknown }).sessionId) || null;
  const routeAwareContext = resolveRouteAwarenessContext({
    req: args.req,
    inputContext: inputContextRaw,
    origin: args.input.origin || null,
    contextLabel: sessionTitleFromSurface(toSessionSurface(args.surface)),
    workspaceId: args.input.workspaceId || null,
    projectId: args.input.projectId || null,
  });
  const memoryFacts = await retrieveRelevantAiUserMemoryFactsSafe({
    accountId: ctx.accountId,
    userId: ctx.userId,
    prompt: userPrompt || action,
    goal: args.input.goal || null,
    limit: 4,
    sessionId: initialSessionId,
    requestId: args.requestId,
  }).catch(() => []);
  const {
    routeManifestCoverageContext,
    websiteKnowledgeContext,
  } = await loadRouteAndWebsiteContextEnrichments({
    accountId: ctx.accountId,
    userId: ctx.userId,
    sessionId: initialSessionId,
    requestId: args.requestId,
    surface: args.surface,
    action,
    taskType,
    prompt: userPrompt || action,
    goal: args.input.goal || null,
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    routeAwareContext,
  });
  const inputContext: Record<string, unknown> = {
    ...routeAwareContext,
    ...inputContextRaw,
    ...(routeManifestCoverageContext ? { routeManifestCoverage: routeManifestCoverageContext } : {}),
    ...(websiteKnowledgeContext ? { websiteKnowledge: websiteKnowledgeContext } : {}),
  };
  const contextPack = buildSurfaceContextPack({
    surface: args.surface,
    taskType,
    prompt: userPrompt,
    goal: args.input.goal || null,
    context: inputContext,
    injectedContext: {
      action,
      goal: args.input.goal,
      origin: s(args.input.origin) || null,
      memoryFacts: memoryFacts.map((row) => ({
        key: row.factKey,
        value: row.factValue,
        category: row.category,
        confidence: row.confidence,
      })),
      ...(routeManifestCoverageContext ? { routeManifestCoverage: routeManifestCoverageContext } : {}),
      ...(websiteKnowledgeContext ? { websiteKnowledge: websiteKnowledgeContext } : {}),
    },
  });
  const surfacePromptBody = surfaceUserPrompt(args.input, contextPack);
  let providerId = "deepseek";
  let model = "";
  let sessionId = initialSessionId || "";
  let policy: AiExecutionPolicy | null = null;
  let executionMeta: AiExecutionMeta | null = null;

  try {
    policy = await resolveAiExecutionPolicy({
      accountId: ctx.accountId,
      userId: ctx.userId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      surface: args.surface,
      action,
      taskType,
      requestedModel: null,
      requestedReasoningLevel: "high",
      promptText: userPrompt || args.input.goal,
      context: inputContext,
      imageAttachmentCount: 0,
      sessionId: sessionId || null,
      requestId: args.requestId,
      isExecution: true,
    });
    await persistAiModelSelectionEvent({
      accountId: ctx.accountId,
      userId: ctx.userId,
      sessionId: sessionId || null,
      requestId: args.requestId,
      surface: args.surface,
      action,
      taskType,
      actionClass: policy.actionClass,
      planId: ctx.planId,
      requestedModel: policy.requestedModel,
      resolvedModel: policy.model,
      providerId: policy.providerId,
      reasoningLevel: policy.reasoningLevel,
      manualSelection: policy.manualModelSelected,
      fallbackReason: policy.modelFallbackReason,
    });
    const retryContext =
      inputContext;
    const retryFromMessageId = s(retryContext.retryFromMessageId);
    const retryFromSessionId = s(retryContext.retryFromSessionId) || s((args.input as { sessionId?: unknown }).sessionId);
    if (retryFromMessageId && retryFromSessionId) {
      await persistAiRetryEvent({
        accountId: ctx.accountId,
        userId: ctx.userId,
        sessionId: retryFromSessionId,
        requestId: args.requestId,
        surface: args.surface,
        action,
        taskType,
        sourceMessageId: retryFromMessageId,
        sourceSessionId: retryFromSessionId,
        model: policy.model,
        reasoningLevel: policy.reasoningLevel,
        researchMode: false,
        contextJson: retryContext,
      });
    }
    const reasoningProfile = resolveReasoningProfile(policy.reasoningLevel, modelRole);
    const reasoningDirective = resolveReasoningDirective({
      level: policy.reasoningLevel,
      actionClass: policy.actionClass,
    });
    const providerCall = await runProviderJson({
      modelRole,
      modelOverride: policy.model,
      messages: [
        {
          role: "system",
          content: surfaceSystemPrompt(args.surface, action, reasoningDirective, policy.actionClass, taskType),
        },
        { role: "user", content: surfacePromptBody },
      ],
      maxTokensOverride: reasoningProfile.maxTokens,
      timeoutMs: Math.min(reasoningProfile.timeoutMs, policy.requestLimits.maxExecutionTimeMs),
      signal: args.req.signal,
      metadata: {
        surface: args.surface,
        action,
        plan: ctx.planId,
        actionClass: policy.actionClass,
        reasoningLevel: policy.reasoningLevel,
      },
    });
    providerId = providerCall.providerId;
    model = providerCall.model;
    let finalProviderResponse = providerCall.response;

    if (providerCall.response.content.length > Math.min(policy.requestLimits.maxOutputChars, reasoningProfile.maxOutputChars)) {
      throw new AiServiceError(
        "AI_OUTPUT_TOO_LARGE",
        "AI output exceeded allowed response size for this action.",
        502
      );
    }

    const parsed = SURFACE_ASSIST_RESPONSE_SCHEMA.safeParse(providerCall.parsed);
    if (!parsed.success) {
      throw new AiServiceError(
        "INVALID_PROVIDER_SHAPE",
        "Provider JSON did not match the required surface response schema.",
        502,
        parsed.error.flatten()
      );
    }

    let data = parsed.data;
    const checksPerformed: string[] = [
      "output_size_check",
      "schema_validation",
      "semantic_validation",
    ];
    const answerPath: string[] = ["initial_generation"];
    let quality = evaluateAiAnswerQuality({
      prompt: userPrompt || action,
      goal: args.input.goal || null,
      answer: textFromStructuredOutput(data),
      surface: args.surface,
      taskType,
      contextSignals: contextPack.signalsUsed,
    });
    let repairAttempted = false;
    let repairApplied = false;

    if (!quality.passed) {
      repairAttempted = true;
      checksPerformed.push("semantic_repair_pass");
      answerPath.push("repair_generation");
      const repairDirective = buildSemanticRepairDirective({
        taskType,
        surface: args.surface,
        reasons: quality.reasons,
      });
      try {
        const repairCall = await runProviderJson({
          modelRole,
          modelOverride: policy.model,
          messages: [
            {
              role: "system",
              content: surfaceSystemPrompt(args.surface, action, reasoningDirective, policy.actionClass, taskType),
            },
            {
              role: "user",
              content: [
                surfacePromptBody,
                "",
                "Previous JSON answer:",
                toStableJson(data, 14_000),
                "",
                repairDirective,
              ].join("\n"),
            },
          ],
          maxTokensOverride: reasoningProfile.maxTokens,
          timeoutMs: Math.min(reasoningProfile.timeoutMs, policy.requestLimits.maxExecutionTimeMs),
          signal: args.req.signal,
          metadata: {
            surface: args.surface,
            action,
            plan: ctx.planId,
            actionClass: policy.actionClass,
            reasoningLevel: policy.reasoningLevel,
            semanticRepair: true,
          },
        });
        const repairParsed = SURFACE_ASSIST_RESPONSE_SCHEMA.safeParse(repairCall.parsed);
        if (repairParsed.success) {
          const repairedData = repairParsed.data;
          const repairedQuality = evaluateAiAnswerQuality({
            prompt: userPrompt || action,
            goal: args.input.goal || null,
            answer: textFromStructuredOutput(repairedData),
            surface: args.surface,
            taskType,
            contextSignals: contextPack.signalsUsed,
          });
          if (repairedQuality.passed || repairedQuality.overall >= quality.overall) {
            data = repairedData;
            quality = repairedQuality;
            repairApplied = true;
            finalProviderResponse = repairCall.response;
          }
        }
      } catch {
        // Keep initial response when repair pass fails.
      }
    }

    if (!quality.passed) {
      if (!isCodeTaskType(taskType)) {
        checksPerformed.push("semantic_fallback_response");
        answerPath.push("safe_fallback");
        data = buildSafeSurfaceFallbackResponse({
          surface: args.surface,
          taskType,
        });
        quality = evaluateAiAnswerQuality({
          prompt: userPrompt || action,
          goal: args.input.goal || null,
          answer: textFromStructuredOutput(data),
          surface: args.surface,
          taskType,
          contextSignals: contextPack.signalsUsed,
        });
      } else {
        throw new AiServiceError(
          "AI_SEMANTIC_VALIDATION_FAILED",
          "AI response failed semantic relevance checks for this request.",
          502,
          {
            taskType,
            reasons: quality.reasons,
            quality,
          }
        );
      }
    }

    executionMeta = buildExecutionMeta({
      startedAtMs: startedAt,
      surface: args.surface,
      action,
      actionClass: policy.actionClass,
      prompt: userPrompt || action,
      model,
      providerId,
      reasoningLevel: policy.reasoningLevel,
      taskType,
      researchMode: false,
      contextSignals: contextPack.signalsUsed,
      quality,
      repairAttempted,
      repairApplied,
      checksPerformed,
      answerPath,
    });

    await persistAiNarration({
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      provider: providerId,
      model,
      runId: null,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: s(args.input.origin) || null,
      narrationJson: {
        surface: args.surface,
        action,
        summary: data.summary,
        recommendations: data.recommendations,
        notes: data.notes,
        evidenceRefs: data.evidenceRefs,
        followUpChecks: data.followUpChecks,
      },
    });

    sessionId = await persistSessionTurn({
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      action,
      surface: toSessionSurface(args.surface),
      sessionId: sessionId || null,
      contextLabel: sessionTitleFromSurface(toSessionSurface(args.surface)),
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: s(args.input.origin) || null,
      userText: userPrompt || action,
      userJson: {
        action,
        goal: args.input.goal,
        prompt: (args.input as { prompt?: unknown }).prompt || null,
        reasoningLevel: policy.reasoningLevel,
        actionClass: policy.actionClass,
        taskType,
        model: policy.model,
        contextPack,
        context: inputContext,
      },
      assistantText: data.summary,
      assistantJson: {
        ...data,
        __cavAiMeta: executionMeta,
      },
      provider: providerId,
      model,
      status: "SUCCESS",
    });

    await persistAiReasoningTrace({
      accountId: ctx.accountId,
      userId: ctx.userId,
      sessionId,
      requestId: args.requestId,
      surface: args.surface,
      action,
      taskType,
      actionClass: policy.actionClass,
      provider: providerId,
      model,
      reasoningLevel: policy.reasoningLevel,
      researchMode: false,
      durationMs: executionMeta.durationMs,
      showReasoningChip: executionMeta.showReasoningChip,
      repairAttempted,
      repairApplied,
      quality: executionMeta.quality as unknown as Record<string, unknown>,
      safeSummary: executionMeta.safeSummary as unknown as Record<string, unknown>,
      contextSignals: executionMeta.contextSignals,
      checksPerformed,
      answerPath,
    });

    await learnAiUserMemoryFromPromptSafe({
      accountId: ctx.accountId,
      userId: ctx.userId,
      sessionId,
      requestId: args.requestId,
      userPrompt: userPrompt || action,
      sourceMessageId: retryFromMessageId || null,
    });

    await writeAiUsageLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      surface: args.surface,
      action,
      provider: providerId,
      model,
      requestId: args.requestId,
      runId: null,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: s(args.input.origin) || null,
      inputChars: surfacePromptBody.length,
      outputChars: finalProviderResponse.content.length,
      latencyMs: Date.now() - startedAt,
      status: "SUCCESS",
      ...usageFromResponse(finalProviderResponse),
    });

    await writeAiAudit({
      req: args.req,
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      surface: args.surface,
      action,
      provider: providerId,
      model,
      status: "SUCCESS",
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      actionClass: policy.actionClass,
      reasoningLevel: policy.reasoningLevel,
      weightedUsageUnits: policy.weightedUsageUnits,
      latencyMs: Date.now() - startedAt,
      outcome: "response_generated",
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: s(args.input.origin) || null,
    });

    return {
      ok: true,
      requestId: args.requestId,
      providerId,
      model,
      sessionId,
      meta: executionMeta || undefined,
      data,
    };
  } catch (error) {
    const mapped = mapProviderError(error);

    if (sessionId || userPrompt) {
      try {
        await persistSessionTurn({
          accountId: ctx.accountId,
          userId: ctx.userId,
          requestId: args.requestId,
          action,
          surface: toSessionSurface(args.surface),
          sessionId: sessionId || null,
          contextLabel: sessionTitleFromSurface(toSessionSurface(args.surface)),
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          origin: s(args.input.origin) || null,
          userText: userPrompt || action,
          userJson: {
            action,
            goal: args.input.goal,
            prompt: (args.input as { prompt?: unknown }).prompt || null,
            reasoningLevel: policy?.reasoningLevel || "medium",
            actionClass: policy?.actionClass || "standard",
            taskType,
            model: policy?.model || null,
            contextPack,
            context: inputContext,
          },
          assistantText: mapped.message,
          assistantJson: {
            error: mapped.code,
            message: mapped.message,
          },
          provider: providerId,
          model: model || undefined,
          status: "ERROR",
          errorCode: mapped.code,
        });
      } catch {
        // no-op: avoid masking primary error
      }
    }

    await writeAiUsageLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      surface: args.surface,
      action,
      provider: providerId,
      model: model || "unknown",
      requestId: args.requestId,
      runId: null,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: s(args.input.origin) || null,
      inputChars: surfacePromptBody.length,
      outputChars: 0,
      latencyMs: Date.now() - startedAt,
      status: "ERROR",
      errorCode: mapped.code,
    });

    await writeAiAudit({
      req: args.req,
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      surface: args.surface,
      action,
      provider: providerId,
      model: model || "unknown",
      status: "ERROR",
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      actionClass: policy?.actionClass || "standard",
      reasoningLevel: policy?.reasoningLevel || "medium",
      weightedUsageUnits: policy?.weightedUsageUnits || 0,
      latencyMs: Date.now() - startedAt,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: s(args.input.origin) || null,
      errorCode: mapped.code,
      outcome: "failed",
    });

    return withGuard(mapped, {
      ok: false,
      requestId: args.requestId,
      error: mapped.code,
      message: mapped.message,
      status: mapped.status,
    });
  } finally {
    policy?.releaseGenerationSlot();
  }
}

export async function runCenterAssist(args: {
  req: Request;
  requestId: string;
  input: AiCenterAssistRequest;
}): Promise<AiAssistResponseEnvelope<AiCenterAssistResponse>> {
  const startedAt = Date.now();
  const guardSurface = centerSurfaceToGuardSurface(args.input.surface);
  const ctx = await requireAiRequestContext({
    req: args.req,
    surface: guardSurface,
    projectId: args.input.projectId,
    workspaceId: args.input.workspaceId,
  });

  const requestedAgentId = s(args.input.agentId).toLowerCase();
  const requestedAgentActionKey = s(args.input.agentActionKey).toLowerCase();
  const selectedCustomAgent = await resolveInstalledCavenCustomAgentSafe({
    accountId: ctx.accountId,
    userId: ctx.userId,
    runtimeSurface: "center",
    agentId: requestedAgentId || null,
    agentActionKey: requestedAgentActionKey || null,
  });
  if ((requestedAgentId || requestedAgentActionKey) && !selectedCustomAgent) {
    throw new AiServiceError(
      "AGENT_NOT_AVAILABLE",
      "Selected agent is unavailable or not installed for CavAi Center.",
      403
    );
  }

  const requestedModel = s(args.input.model);
  const requestedInputAction = args.input.action;
  const modelForcedAction: AiCenterAssistAction | null =
    requestedModel === ALIBABA_QWEN_CHARACTER_MODEL_ID
      ? (isCompanionCenterAction(requestedInputAction) ? requestedInputAction : "companion_chat")
      : requestedModel === ALIBABA_QWEN_IMAGE_MODEL_ID
        ? "image_studio"
        : requestedModel === ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID
          ? "image_edit"
          : null;
  const requestedActionBase = modelForcedAction
    || (s(requestedInputAction).toLowerCase() === "web_research" ? "web_research" : requestedInputAction);
  const requestedAction = selectedCustomAgent
    ? inferCenterActionFromCustomAgent({
        agent: selectedCustomAgent,
        prompt: args.input.prompt,
        goal: args.input.goal || null,
        fallback: requestedActionBase,
      })
    : requestedActionBase;
  const actionForAudit = selectedCustomAgent
    ? (s(selectedCustomAgent.actionKey).toLowerCase() || requestedAction)
    : requestedAction;
  const requestedResearchUrls = Array.isArray(args.input.researchUrls)
    ? args.input.researchUrls
        .map((url) => s(url))
        .filter(Boolean)
    : [];
  const researchModeRequested =
    args.input.researchMode === true
    || requestedAction === "web_research";
  const requestedTaskType = classifyAiTaskType({
    surface: args.input.surface,
    action: requestedAction,
    prompt: args.input.prompt,
    goal: args.input.goal || null,
  });
  const effectiveAction = resolveCenterActionForTask({
    surface: args.input.surface,
    requestedAction,
    taskType: requestedTaskType,
    researchModeRequested,
  });
  const imageAttachmentMeta = (args.input.imageAttachments || []).map((item) => ({
    id: item.id,
    assetId: s(item.assetId) || null,
    name: item.name,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    hasDataUrl: Boolean(s(item.dataUrl)),
    hasAssetId: Boolean(s(item.assetId) || s(item.id)),
  }));
  const imageAttachmentsForRetry = (args.input.imageAttachments || []).map((item) => ({
    id: item.id,
    assetId: s(item.assetId) || s(item.id) || null,
    name: item.name,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    dataUrl: s(item.dataUrl) || null,
  }));
  const requestedModelForRetry = requestedModel || CAVAI_AUTO_MODEL_ID;
  const inputContextRaw =
    args.input.context && typeof args.input.context === "object"
      ? (args.input.context as Record<string, unknown>)
      : {};
  const uploadedWorkspaceFiles = await resolveUploadedWorkspaceFilesForAi({
    accountId: ctx.accountId,
    context: inputContextRaw,
  });
  const uploadedWorkspaceFileMeta = uploadedWorkspaceFiles.map((file) => ({
    id: file.id,
    cavcloudFileId: s(file.cavcloudFileId) || null,
    cavcloudPath: s(file.cavcloudPath) || null,
    path: s(file.path) || null,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    snippet: file.snippet || null,
  }));
  const initialSessionId = s(args.input.sessionId) || null;
  const routeAwareContext = resolveRouteAwarenessContext({
    req: args.req,
    inputContext: inputContextRaw,
    origin: args.input.origin || null,
    contextLabel: args.input.contextLabel || null,
    workspaceId: args.input.workspaceId || null,
    projectId: args.input.projectId || null,
  });
  const taskType = classifyAiTaskType({
    surface: args.input.surface,
    action: effectiveAction,
    prompt: args.input.prompt,
    goal: args.input.goal || null,
  });
  const modelRole: AiModelRole = researchModeRequested
    ? "reasoning"
    : resolveModelRoleForTaskType({
      taskType,
      surface: guardSurface,
      action: effectiveAction,
    });
  const sessionHistory = await loadCenterSessionHistoryContext({
    accountId: ctx.accountId,
    sessionId: initialSessionId,
    maxMessages: 10,
  });
  const memoryFacts = await retrieveRelevantAiUserMemoryFactsSafe({
    accountId: ctx.accountId,
    userId: ctx.userId,
    prompt: args.input.prompt,
    goal: args.input.goal || null,
    limit: 6,
    sessionId: initialSessionId,
    requestId: args.requestId,
  }).catch(() => []);
  const {
    routeManifestCoverageContext,
    websiteKnowledgeContext,
  } = await loadRouteAndWebsiteContextEnrichments({
    accountId: ctx.accountId,
    userId: ctx.userId,
    sessionId: initialSessionId,
    requestId: args.requestId,
    surface: "center",
    action: effectiveAction,
    taskType,
    prompt: args.input.prompt,
    goal: args.input.goal || null,
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    routeAwareContext,
  });
  const inputContext: Record<string, unknown> = {
    ...routeAwareContext,
    ...inputContextRaw,
    uploadedWorkspaceFiles: uploadedWorkspaceFileMeta,
    ...(routeManifestCoverageContext ? { routeManifestCoverage: routeManifestCoverageContext } : {}),
    ...(websiteKnowledgeContext ? { websiteKnowledge: websiteKnowledgeContext } : {}),
  };
  const contextPack = buildSurfaceContextPack({
    surface: args.input.surface,
    taskType,
    prompt: args.input.prompt,
    goal: args.input.goal || null,
    context: inputContext,
    injectedContext: {
      contextLabel: args.input.contextLabel || null,
      researchUrls: requestedResearchUrls,
      imageAttachments: imageAttachmentMeta,
      uploadedWorkspaceFiles: uploadedWorkspaceFileMeta,
      launchSurface: args.input.surface,
      effectiveAction,
      sessionHistory,
      sessionHistoryCount: sessionHistory.length,
      memoryFacts: memoryFacts.map((row) => ({
        key: row.factKey,
        value: row.factValue,
        category: row.category,
        confidence: row.confidence,
      })),
      customAgent: selectedCustomAgent
        ? normalizeCustomAgentRuntimePayload(selectedCustomAgent)
        : null,
      ...(routeManifestCoverageContext ? { routeManifestCoverage: routeManifestCoverageContext } : {}),
      ...(websiteKnowledgeContext ? { websiteKnowledge: websiteKnowledgeContext } : {}),
    },
  });
  let providerId = "deepseek";
  let model = "";
  let sessionId = initialSessionId || "";
  let policy: AiExecutionPolicy | null = null;
  let executionMeta: AiExecutionMeta | null = null;

  try {
    policy = await resolveAiExecutionPolicy({
      accountId: ctx.accountId,
      userId: ctx.userId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      surface: "center",
      action: effectiveAction,
      taskType,
      requestedModel: requestedModel || null,
      requestedReasoningLevel: args.input.reasoningLevel || null,
      promptText: args.input.prompt,
      context: inputContext,
      imageAttachmentCount: imageAttachmentMeta.length,
      fileAttachmentCount: uploadedWorkspaceFileMeta.length,
      researchUrlsCount: requestedResearchUrls.length,
      sessionId: sessionId || null,
      requestId: args.requestId,
      isExecution: true,
    });
    await persistAiModelSelectionEvent({
      accountId: ctx.accountId,
      userId: ctx.userId,
      sessionId: sessionId || null,
      requestId: args.requestId,
      surface: "center",
      action: actionForAudit,
      taskType,
      actionClass: policy.actionClass,
      planId: ctx.planId,
      requestedModel: policy.requestedModel,
      resolvedModel: policy.model,
      providerId: policy.providerId,
      reasoningLevel: policy.reasoningLevel,
      manualSelection: policy.manualModelSelected,
      fallbackReason: policy.modelFallbackReason,
    });
    const retryContext = inputContext;
    const retryFromMessageId = s(retryContext.retryFromMessageId);
    const retryFromSessionId = s(retryContext.retryFromSessionId) || s(args.input.sessionId);
    if (retryFromMessageId && retryFromSessionId) {
      await persistAiRetryEvent({
        accountId: ctx.accountId,
        userId: ctx.userId,
        sessionId: retryFromSessionId,
        requestId: args.requestId,
        surface: args.input.surface,
        action: actionForAudit,
        taskType,
        sourceMessageId: retryFromMessageId,
        sourceSessionId: retryFromSessionId,
        model: policy.model,
        reasoningLevel: policy.reasoningLevel,
        researchMode: policy.researchMode,
        contextJson: retryContext,
      });
    }
    if (policy.model === ALIBABA_QWEN_IMAGE_MODEL_ID || policy.model === ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID) {
      const mode: "studio" | "edit" = policy.model === ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID ? "edit" : "studio";
      const imageStudioContext = parseImageStudioRequestContext(inputContext);
      const imageStudioPlanTier = await toImageStudioPlanTierSafe(ctx.planId);
      const preset = await getImagePresetByIdSafe({
        presetId: imageStudioContext.presetId,
        slug: imageStudioContext.presetSlug,
        planTier: imageStudioPlanTier,
      });
      if (preset?.locked) {
        throw new AiServiceError(
          "AI_IMAGE_PRESET_PLAN_LOCKED",
          "Selected image preset requires a higher plan tier.",
          403
        );
      }
      const imagePromptResolution = resolveImageStudioPromptInput({
        mode,
        promptText: s(args.input.prompt),
        goalText: s(args.input.goal),
        presetLabel: preset?.label || null,
      });

      const resolvedImagePrompt = await buildImageStudioPromptSafe({
        mode: mode === "edit" ? "edit" : "generate",
        userPrompt: imagePromptResolution.effectivePrompt,
        preset,
        aspectRatio: imageStudioContext.aspectRatio,
        variantCount: imageStudioContext.variantCount,
        brandContext: imageStudioContext.brandContext,
        transformMode: imageStudioContext.transformMode,
      });

      let sourceAssetInput:
        | {
            assetId: string;
            dataUrl: string;
            mimeType: string;
            fileName: string;
          }
        | null = null;
      if (mode === "edit" && imageStudioContext.sourceAssetId) {
        const resolved = await resolveDataUrlForAssetSafe({
          accountId: ctx.accountId,
          userId: ctx.userId,
          assetId: imageStudioContext.sourceAssetId,
        });
        if (resolved) {
          sourceAssetInput = {
            assetId: imageStudioContext.sourceAssetId,
            dataUrl: resolved.dataUrl,
            mimeType: resolved.mimeType,
            fileName: resolved.fileName,
          };
        }
      }

      let imageJobId = "";
      try {
        imageJobId = await startImageJobSafe({
          accountId: ctx.accountId,
          userId: ctx.userId,
          sessionId: sessionId || null,
          requestId: args.requestId,
          planTier: imageStudioPlanTier,
          mode: mode === "edit" ? "edit" : "generate",
          actionSource: "center",
          agentId: actionForAudit,
          agentActionKey: effectiveAction,
          prompt: imagePromptResolution.customInstruction || "",
          resolvedPrompt: resolvedImagePrompt,
          presetId: preset?.id || null,
          modelUsed: policy.model,
          inputAssetRefs: {
            sourceAssetId: sourceAssetInput?.assetId || imageStudioContext.sourceAssetId || null,
            attachmentIds: imageAttachmentsForRetry.map((row) => s(row.assetId) || s(row.id)).filter(Boolean),
            attachmentCount: imageAttachmentMeta.length,
          },
        });

        let imageResult: Awaited<ReturnType<typeof generateAlibabaQwenImage>>;
        if (mode === "edit") {
          const sourceEditFile = sourceAssetInput
            ? dataUrlToFile(sourceAssetInput.dataUrl, sourceAssetInput.fileName || "image-edit-input.png")
            : null;
          let attachmentEditFile: File | null = null;
          if (!sourceEditFile) {
            for (const attachment of imageAttachmentsForRetry) {
              attachmentEditFile = await resolveAttachmentFile({
                accountId: ctx.accountId,
                userId: ctx.userId,
                attachment,
                fallbackName: "image-edit-input.png",
              });
              if (attachmentEditFile) break;
            }
          }
          const fileForEdit = sourceEditFile || attachmentEditFile;
          if (!fileForEdit) {
            throw new AiServiceError(
              "AI_IMAGE_EDIT_INPUT_REQUIRED",
              "Image Edit requires at least one uploaded or imported image.",
              400
            );
          }
          imageResult = await editAlibabaQwenImage({
            prompt: resolvedImagePrompt,
            image: fileForEdit,
            model: policy.model,
            timeoutMs: policy.requestLimits.maxExecutionTimeMs,
            signal: args.req.signal,
          });
        } else {
          imageResult = await generateAlibabaQwenImage({
            prompt: resolvedImagePrompt,
            model: policy.model,
            timeoutMs: policy.requestLimits.maxExecutionTimeMs,
            signal: args.req.signal,
          });
        }

        providerId = "alibaba_qwen";
        model = policy.model;
        const generatedImages = imageResult.images
          .map((row) => ({
            ...(s(row.url) ? { url: s(row.url) } : {}),
            ...(s(row.b64Json) ? { b64Json: s(row.b64Json) } : {}),
          }))
          .filter((row) => Object.keys(row).length > 0);
        if (!generatedImages.length) {
          throw new AiServiceError(
            "ALIBABA_QWEN_EMPTY_IMAGE_RESPONSE",
            "Image model returned no output assets.",
            502
          );
        }

        const persistedImages: Array<{
          assetId: string;
          url?: string;
          b64Json?: string;
          fileName: string;
          mimeType: string;
        }> = [];

        for (let index = 0; index < generatedImages.length; index += 1) {
          const generated = generatedImages[index];
          const providerImage = imageResult.images[index];
          const b64Json = s(generated.b64Json);
          const mimeType = "image/png";
          const nowTs = Date.now();
          const fileName = `${mode === "edit" ? "cavbot-edit" : "cavbot-image"}-${nowTs}-${index + 1}.png`;
          const assetId = await createImageAssetSafe({
            accountId: ctx.accountId,
            userId: ctx.userId,
            jobId: imageJobId,
            presetId: preset?.id || null,
            sourceKind: mode === "edit" ? "edited" : "generated",
            originalSource: mode === "edit" ? "image_edit_model" : "image_generation_model",
            fileName,
            mimeType,
            bytes: b64Json ? Math.max(0, Math.trunc((b64Json.length * 3) / 4)) : 0,
            format: "png",
            externalUrl: s(generated.url) || null,
            dataUrl: b64Json ? `data:${mimeType};base64,${b64Json}` : null,
            b64Data: b64Json || null,
            sourcePrompt: imagePromptResolution.customInstruction || null,
            metadata: {
              revisedPrompt: s(providerImage?.revisedPrompt) || null,
              outputIndex: index,
              action: effectiveAction,
              sourceAssetId: sourceAssetInput?.assetId || imageStudioContext.sourceAssetId || null,
              activationLine: imagePromptResolution.activationLine,
              activationLineUnchanged: imagePromptResolution.activationLineUnchanged,
            },
          });

          await appendUserImageHistorySafe({
            accountId: ctx.accountId,
            userId: ctx.userId,
            jobId: imageJobId,
            assetId,
            entryType: mode === "edit" ? "edited" : "generated",
            mode: mode === "edit" ? "edit" : "generate",
            promptSummary: centerImageSummaryFromPrompt(args.input.prompt, mode),
            saved: false,
          });

          persistedImages.push({
            assetId,
            ...(s(generated.url) ? { url: s(generated.url) } : {}),
            ...(b64Json ? { b64Json } : {}),
            fileName,
            mimeType,
          });
        }

        await completeImageJobSafe({
          jobId: imageJobId,
          accountId: ctx.accountId,
          userId: ctx.userId,
          outputAssetRefs: persistedImages.map((row, index) => ({
            assetId: row.assetId,
            outputIndex: index,
            fileName: row.fileName,
            mimeType: row.mimeType,
            url: row.url || null,
          })),
        });

        const imageStudioPayload = {
          mode: mode === "edit" ? "edit" : "generate",
          jobId: imageJobId,
          presetId: preset?.id || null,
          presetLabel: preset?.label || null,
          sourcePrompt: imagePromptResolution.customInstruction || null,
          activationLine: imagePromptResolution.activationLine,
          activationLineUnchanged: imagePromptResolution.activationLineUnchanged,
          sourceAssetId: sourceAssetInput?.assetId || imageStudioContext.sourceAssetId || null,
          assets: persistedImages,
        };

        const firstImageUrl = s(generatedImages[0]?.url);
        const summary = centerImageSummaryFromPrompt(args.input.prompt, mode);
        const answer = firstImageUrl
          ? (mode === "edit"
            ? `Image edit completed. Preview: ${firstImageUrl}`
            : `Image generated. Preview: ${firstImageUrl}`)
          : (mode === "edit"
            ? "Image edit completed. Open the generated asset details below."
            : "Image generated. Open the generated asset details below.");
        const data: AiCenterAssistResponse = {
          summary,
          risk: "low",
          answer,
          generatedImages,
          recommendations: mode === "edit"
            ? ["Review the edited result and request focused variant refinements if needed."]
            : ["Review the generated result and request variant prompts to iterate style, composition, and copy-fit."],
          notes: [
            mode === "edit"
              ? "Image Edit used Qwen-Image-Edit-Max."
              : "Image Studio used Qwen-Image-2.0-Pro.",
          ],
          followUpChecks: [
            "Confirm final asset dimensions and brand fit before publishing.",
            "Store approved assets in CavCloud or your project asset workflow.",
          ],
          evidenceRefs: [],
        };

        const quality = evaluateAiAnswerQuality({
          prompt: args.input.prompt,
          goal: args.input.goal || null,
          answer: `${data.summary}\n${data.answer}`,
          surface: args.input.surface,
          taskType,
          contextSignals: contextPack.signalsUsed,
        });
        executionMeta = buildExecutionMeta({
          startedAtMs: startedAt,
          surface: args.input.surface,
          action: actionForAudit,
          actionClass: policy.actionClass,
          prompt: args.input.prompt,
          model,
          providerId,
          reasoningLevel: policy.reasoningLevel,
          taskType,
          researchMode: false,
          contextSignals: contextPack.signalsUsed,
          quality,
          repairAttempted: false,
          repairApplied: false,
          checksPerformed: ["image_output_validation"],
          answerPath: ["image_model_generation"],
        });

        sessionId = await persistSessionTurn({
          accountId: ctx.accountId,
          userId: ctx.userId,
          requestId: args.requestId,
          action: actionForAudit,
          surface: toSessionSurface(args.input.surface),
          sessionId: sessionId || null,
          contextLabel: args.input.contextLabel || sessionTitleFromSurface(toSessionSurface(args.input.surface)),
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          origin: s(args.input.origin) || null,
          userText: args.input.prompt,
          userJson: buildCenterRetryUserJson({
            input: args.input,
            effectiveAction,
            model: requestedModelForRetry,
            reasoningLevel: policy.reasoningLevel,
            actionClass: policy.actionClass,
            taskType,
            researchMode: false,
            researchToolBundle: [],
            researchUrls: requestedResearchUrls,
            imageAttachments: imageAttachmentsForRetry,
            contextPack,
            context: inputContext,
          }),
          assistantText: data.answer,
          assistantJson: {
            ...data,
            imageStudio: imageStudioPayload,
            __cavAiMeta: executionMeta,
          },
          provider: providerId,
          model,
          status: "SUCCESS",
        });

        await persistAiReasoningTrace({
          accountId: ctx.accountId,
          userId: ctx.userId,
          sessionId,
          requestId: args.requestId,
          surface: args.input.surface,
          action: actionForAudit,
          taskType,
          actionClass: policy.actionClass,
          provider: providerId,
          model,
          reasoningLevel: policy.reasoningLevel,
          researchMode: false,
          durationMs: executionMeta.durationMs,
          showReasoningChip: executionMeta.showReasoningChip,
          repairAttempted: false,
          repairApplied: false,
          quality: executionMeta.quality as unknown as Record<string, unknown>,
          safeSummary: executionMeta.safeSummary as unknown as Record<string, unknown>,
          contextSignals: executionMeta.contextSignals,
          checksPerformed: ["image_output_validation"],
          answerPath: ["image_model_generation"],
        });

        await learnAiUserMemoryFromPromptSafe({
          accountId: ctx.accountId,
          userId: ctx.userId,
          sessionId,
          requestId: args.requestId,
          userPrompt: args.input.prompt,
          sourceMessageId: retryFromMessageId || null,
        });

        await persistAiNarration({
          accountId: ctx.accountId,
          userId: ctx.userId,
          requestId: args.requestId,
          provider: providerId,
          model,
          runId: null,
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          origin: s(args.input.origin) || null,
          narrationJson: {
            surface: args.input.surface,
            action: actionForAudit,
            imageMode: mode,
            imageStudio: imageStudioPayload,
            generatedImages: data.generatedImages || [],
            summary: data.summary,
            answer: data.answer,
          },
        });

        await writeAiUsageLog({
          accountId: ctx.accountId,
          userId: ctx.userId,
          surface: guardSurface,
          action: actionForAudit,
          provider: providerId,
          model,
          requestId: args.requestId,
          runId: null,
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          origin: s(args.input.origin) || null,
          inputChars: resolvedImagePrompt.length,
          outputChars: data.answer.length,
          latencyMs: Date.now() - startedAt,
          status: "SUCCESS",
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        });

        await writeAiAudit({
          req: args.req,
          accountId: ctx.accountId,
          userId: ctx.userId,
          requestId: args.requestId,
          surface: guardSurface,
          action: actionForAudit,
          provider: providerId,
          model,
          status: "SUCCESS",
          memberRole: ctx.memberRole,
          planId: ctx.planId,
          actionClass: policy.actionClass,
          reasoningLevel: policy.reasoningLevel,
          weightedUsageUnits: policy.weightedUsageUnits,
          latencyMs: Date.now() - startedAt,
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          origin: s(args.input.origin) || null,
          attachmentCount: imageAttachmentMeta.length,
          outcome: mode === "edit" ? "image_edited" : "image_generated",
        });

        return {
          ok: true,
          requestId: args.requestId,
          providerId,
          model,
          sessionId,
          meta: executionMeta || undefined,
          data,
        };
      } catch (error) {
        if (imageJobId) {
          await failImageJobSafe({
            jobId: imageJobId,
            accountId: ctx.accountId,
            userId: ctx.userId,
            errorMessage: error instanceof Error ? error.message : "Image request failed.",
          }).catch(() => undefined);
        }
        throw error;
      }
    }
    const researchMode = policy.researchMode;
    if (researchMode && policy.researchToolBundle.length) {
      await Promise.all(
        policy.researchToolBundle.map((toolId) =>
          persistAiToolCallTrace({
            accountId: ctx.accountId,
            userId: ctx.userId,
            sessionId: sessionId || null,
            requestId: args.requestId,
            surface: "center",
            action: actionForAudit,
            toolId,
            status: "planned",
            inputJson: {
              researchUrls: requestedResearchUrls,
              taskType,
            },
          })
        )
      );
    }
    const reasoningProfile = resolveCenterReasoningProfile({
      levelRaw: policy.reasoningLevel,
      role: modelRole,
      researchMode,
    });
    const reasoningDirective = resolveReasoningDirective({
      level: policy.reasoningLevel,
      actionClass: policy.actionClass,
    });
    const centerPromptBody = centerUserPrompt(
      args.input,
      researchMode,
      contextPack,
      effectiveAction,
      selectedCustomAgent,
      uploadedWorkspaceFiles
    );

    const providerCall = await runProviderJson({
      modelRole,
      modelOverride: policy.model,
      messages: [
        {
          role: "system",
          content: centerSystemPrompt({
            input: args.input,
            effectiveAction,
            reasoningDirective,
            actionClass: policy.actionClass,
            taskType,
            researchMode,
            researchToolBundle: policy.researchToolBundle,
            model: policy.model,
            reasoningLevel: reasoningProfile.level,
            customAgent: selectedCustomAgent,
          }),
        },
        { role: "user", content: centerPromptBody },
      ],
      maxTokensOverride: reasoningProfile.maxTokens,
      timeoutMs: Math.min(reasoningProfile.timeoutMs, policy.requestLimits.maxExecutionTimeMs),
      tools: researchMode ? asResearchProviderTools(policy.researchToolBundle) : undefined,
      toolChoice: researchMode ? "auto" : undefined,
      reasoningEffort: researchMode ? reasoningEffortForLevel(reasoningProfile.level) : undefined,
      signal: args.req.signal,
        metadata: {
          surface: "center",
          action: actionForAudit,
        plan: ctx.planId,
        actionClass: policy.actionClass,
        reasoningLevel: policy.reasoningLevel,
        researchMode,
        researchToolBundle: policy.researchToolBundle.join(","),
        researchUrlsCount: requestedResearchUrls.length,
      },
    });
    providerId = providerCall.providerId;
    model = providerCall.model;
    let finalProviderResponse = providerCall.response;

    if (providerCall.response.content.length > Math.min(policy.requestLimits.maxOutputChars, reasoningProfile.maxOutputChars)) {
      throw new AiServiceError(
        "AI_OUTPUT_TOO_LARGE",
        "AI output exceeded allowed response size for this action.",
        502
      );
    }

    const parsed = AI_CENTER_ASSIST_RESPONSE_SCHEMA.safeParse(providerCall.parsed);
    if (!parsed.success) {
      throw new AiServiceError(
        "INVALID_PROVIDER_SHAPE",
        "Provider JSON did not match the required CavAi Center response schema.",
        502,
        parsed.error.flatten()
      );
    }

    let data = researchMode
      ? {
          ...parsed.data,
          researchMode: true,
          researchProfile: parsed.data.researchProfile || {
            model: policy.model,
            reasoningLevel: policy.reasoningLevel,
            toolBundle: policy.researchToolBundle,
          },
        }
      : parsed.data;
    const checksPerformed: string[] = [
      "output_size_check",
      "schema_validation",
      "semantic_validation",
    ];
    const answerPath: string[] = ["initial_generation"];
    let quality = evaluateAiAnswerQuality({
      prompt: args.input.prompt,
      goal: args.input.goal || null,
      answer: textFromStructuredOutput(data),
      surface: args.input.surface,
      taskType,
      contextSignals: contextPack.signalsUsed,
    });
    let repairAttempted = false;
    let repairApplied = false;
    const shouldTryRepair = shouldAttemptSemanticRepair({
      quality,
      answerText: textFromStructuredOutput(data),
      startedAtMs: startedAt,
      maxExecutionTimeMs: policy.requestLimits.maxExecutionTimeMs,
      minimumUsefulChars: researchMode ? 180 : 96,
      force: researchMode,
    });

    if (!quality.passed && shouldTryRepair) {
      repairAttempted = true;
      checksPerformed.push("semantic_repair_pass");
      answerPath.push("repair_generation");
      const repairDirective = buildSemanticRepairDirective({
        taskType,
        surface: args.input.surface,
        reasons: quality.reasons,
      });
      try {
        const repairCall = await runProviderJson({
          modelRole,
          modelOverride: policy.model,
          messages: [
            {
              role: "system",
              content: centerSystemPrompt({
                input: args.input,
                effectiveAction,
                reasoningDirective,
                actionClass: policy.actionClass,
                taskType,
                researchMode,
                researchToolBundle: policy.researchToolBundle,
                model: policy.model,
                reasoningLevel: reasoningProfile.level,
                customAgent: selectedCustomAgent,
              }),
            },
            {
              role: "user",
              content: [
                centerPromptBody,
                "",
                "Previous JSON answer:",
                toStableJson(data, 16_000),
                "",
                repairDirective,
              ].join("\n"),
            },
          ],
          maxTokensOverride: reasoningProfile.maxTokens,
          timeoutMs: Math.min(reasoningProfile.timeoutMs, policy.requestLimits.maxExecutionTimeMs),
          tools: researchMode ? asResearchProviderTools(policy.researchToolBundle) : undefined,
          toolChoice: researchMode ? "auto" : undefined,
          reasoningEffort: researchMode ? reasoningEffortForLevel(reasoningProfile.level) : undefined,
          signal: args.req.signal,
          metadata: {
            surface: "center",
            action: actionForAudit,
            plan: ctx.planId,
            actionClass: policy.actionClass,
            reasoningLevel: policy.reasoningLevel,
            researchMode,
            researchToolBundle: policy.researchToolBundle.join(","),
            semanticRepair: true,
          },
        });
        const repairParsed = AI_CENTER_ASSIST_RESPONSE_SCHEMA.safeParse(repairCall.parsed);
        if (repairParsed.success) {
          const repairedData = researchMode
            ? {
                ...repairParsed.data,
                researchMode: true,
                researchProfile: repairParsed.data.researchProfile || {
                  model: policy.model,
                  reasoningLevel: policy.reasoningLevel,
                  toolBundle: policy.researchToolBundle,
                },
              }
            : repairParsed.data;
          const repairedQuality = evaluateAiAnswerQuality({
            prompt: args.input.prompt,
            goal: args.input.goal || null,
            answer: textFromStructuredOutput(repairedData),
            surface: args.input.surface,
            taskType,
            contextSignals: contextPack.signalsUsed,
          });
          if (repairedQuality.passed || repairedQuality.overall >= quality.overall) {
            data = repairedData;
            quality = repairedQuality;
            repairApplied = true;
            finalProviderResponse = repairCall.response;
          }
        }
      } catch {
        // Keep initial response when repair pass fails.
      }
    }

    if (!quality.passed) {
      if (!isCodeTaskType(taskType)) {
        const hasUsableCenterAnswer = s(textFromStructuredOutput(data)).length >= 48;
        const shouldApplySafeFallback = quality.hardFail || !hasUsableCenterAnswer;
        if (shouldApplySafeFallback) {
          checksPerformed.push("semantic_fallback_response");
          answerPath.push("safe_fallback");
          data = buildSafeCenterFallbackResponse({
            taskType,
            prompt: args.input.prompt,
            goal: args.input.goal || null,
            actionClass: policy.actionClass,
            researchMode,
            model: policy.model,
            reasoningLevel: policy.reasoningLevel,
            researchToolBundle: policy.researchToolBundle,
          });
          quality = evaluateAiAnswerQuality({
            prompt: args.input.prompt,
            goal: args.input.goal || null,
            answer: textFromStructuredOutput(data),
            surface: args.input.surface,
            taskType,
            contextSignals: contextPack.signalsUsed,
          });
        } else {
          checksPerformed.push("semantic_soft_fail_accepted");
          answerPath.push("soft_fail_keep_model_output");
        }
      } else {
        throw new AiServiceError(
          "AI_SEMANTIC_VALIDATION_FAILED",
          "AI response failed semantic relevance checks for this request.",
          502,
          {
            taskType,
            reasons: quality.reasons,
            quality,
          }
        );
      }
    }

    executionMeta = buildExecutionMeta({
      startedAtMs: startedAt,
      surface: args.input.surface,
      action: actionForAudit,
      actionClass: policy.actionClass,
      prompt: args.input.prompt,
      model,
      providerId,
      reasoningLevel: policy.reasoningLevel,
      taskType,
      researchMode,
      contextSignals: contextPack.signalsUsed,
      quality,
      repairAttempted,
      repairApplied,
      checksPerformed,
      answerPath,
    });

    sessionId = await persistSessionTurn({
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      action: actionForAudit,
      surface: toSessionSurface(args.input.surface),
      sessionId: sessionId || null,
      contextLabel: args.input.contextLabel || sessionTitleFromSurface(toSessionSurface(args.input.surface)),
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: s(args.input.origin) || null,
      userText: args.input.prompt,
      userJson: buildCenterRetryUserJson({
        input: args.input,
        effectiveAction,
        model: requestedModelForRetry,
        reasoningLevel: policy.reasoningLevel,
        actionClass: policy.actionClass,
        taskType,
        researchMode,
        researchToolBundle: policy.researchToolBundle,
        researchUrls: requestedResearchUrls,
        imageAttachments: imageAttachmentsForRetry,
        contextPack,
        context: inputContext,
      }),
      assistantText: data.answer,
      assistantJson: {
        ...data,
        __cavAiMeta: executionMeta,
      },
      provider: providerId,
      model,
      status: "SUCCESS",
    });

    await persistAiReasoningTrace({
      accountId: ctx.accountId,
      userId: ctx.userId,
      sessionId,
      requestId: args.requestId,
      surface: args.input.surface,
      action: actionForAudit,
      taskType,
      actionClass: policy.actionClass,
      provider: providerId,
      model,
      reasoningLevel: policy.reasoningLevel,
      researchMode,
      durationMs: executionMeta.durationMs,
      showReasoningChip: executionMeta.showReasoningChip,
      repairAttempted,
      repairApplied,
      quality: executionMeta.quality as unknown as Record<string, unknown>,
      safeSummary: executionMeta.safeSummary as unknown as Record<string, unknown>,
      contextSignals: executionMeta.contextSignals,
      checksPerformed,
      answerPath,
    });

    await learnAiUserMemoryFromPromptSafe({
      accountId: ctx.accountId,
      userId: ctx.userId,
      sessionId,
      requestId: args.requestId,
      userPrompt: args.input.prompt,
      sourceMessageId: retryFromMessageId || null,
    });

    await persistAiNarration({
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      provider: providerId,
      model,
      runId: null,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: s(args.input.origin) || null,
      narrationJson: {
        surface: args.input.surface,
        action: actionForAudit,
        researchMode,
        researchProfile: data.researchProfile || null,
        keyFindings: data.keyFindings || [],
        extractedEvidence: data.extractedEvidence || [],
        sources: data.sources || [],
        suggestedNextActions: data.suggestedNextActions || [],
        contextLabel: args.input.contextLabel || null,
        summary: data.summary,
        answer: data.answer,
        recommendations: data.recommendations,
        notes: data.notes,
        evidenceRefs: data.evidenceRefs,
        followUpChecks: data.followUpChecks,
      },
    });

    await writeAiUsageLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      surface: guardSurface,
      action: actionForAudit,
      provider: providerId,
      model,
      requestId: args.requestId,
      runId: null,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: s(args.input.origin) || null,
      inputChars: centerPromptBody.length,
      outputChars: finalProviderResponse.content.length,
      latencyMs: Date.now() - startedAt,
      status: "SUCCESS",
      ...usageFromResponse(finalProviderResponse),
    });

    await writeAiAudit({
      req: args.req,
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      surface: guardSurface,
      action: actionForAudit,
      provider: providerId,
      model,
      status: "SUCCESS",
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      actionClass: policy.actionClass,
      reasoningLevel: policy.reasoningLevel,
      weightedUsageUnits: policy.weightedUsageUnits,
      latencyMs: Date.now() - startedAt,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: s(args.input.origin) || null,
      researchMode: policy.researchMode,
      researchToolBundle: policy.researchToolBundle,
      researchUrlsCount: requestedResearchUrls.length,
      attachmentCount: imageAttachmentMeta.length,
      outcome: "response_generated",
    });

    return {
      ok: true,
      requestId: args.requestId,
      providerId,
      model,
      sessionId,
      meta: executionMeta || undefined,
      data,
    };
  } catch (error) {
    const mapped = mapProviderError(error);
    const shouldReturnSafeJsonFallback = shouldReturnSafeFallbackOnProviderFailure(mapped);

    if (shouldReturnSafeJsonFallback) {
      const fallbackResearchMode = policy?.researchMode || researchModeRequested;
      const fallbackModel = model || policy?.model || requestedModelForRetry || s(args.input.model) || "unknown";
      const fallbackReasoningLevel = policy?.reasoningLevel || args.input.reasoningLevel || "medium";
      const fallbackData = buildSafeCenterFallbackResponse({
        taskType,
        prompt: args.input.prompt,
        goal: args.input.goal || null,
        actionClass: policy?.actionClass || null,
        researchMode: fallbackResearchMode,
        model: fallbackModel,
        reasoningLevel: fallbackReasoningLevel,
        researchToolBundle: policy?.researchToolBundle || [],
      });

      let fallbackSessionId = sessionId;
      if (args.input.prompt) {
        try {
          fallbackSessionId = await persistSessionTurn({
            accountId: ctx.accountId,
            userId: ctx.userId,
            requestId: args.requestId,
            action: actionForAudit,
            surface: toSessionSurface(args.input.surface),
            sessionId: sessionId || null,
            contextLabel: args.input.contextLabel || sessionTitleFromSurface(toSessionSurface(args.input.surface)),
            workspaceId: ctx.workspaceId,
            projectId: ctx.projectId,
            origin: s(args.input.origin) || null,
            userText: args.input.prompt,
            userJson: buildCenterRetryUserJson({
              input: args.input,
              effectiveAction,
              model: requestedModelForRetry,
              reasoningLevel: fallbackReasoningLevel,
              actionClass: policy?.actionClass || "standard",
              taskType,
              researchMode: fallbackResearchMode,
              researchToolBundle: policy?.researchToolBundle || [],
              researchUrls: requestedResearchUrls,
              imageAttachments: imageAttachmentsForRetry,
              contextPack,
              context: inputContext,
            }),
            assistantText: fallbackData.answer,
            assistantJson: {
              ...fallbackData,
              __cavAiMeta: {
                fallbackMode: true,
                fallbackReason: mapped.code,
                fallbackMessage: mapped.message,
              },
            },
            provider: providerId,
            model: fallbackModel,
            status: "SUCCESS",
          });
        } catch {
          // no-op: fallback response should still return to user.
        }
      }

      await writeAiUsageLog({
        accountId: ctx.accountId,
        userId: ctx.userId,
        surface: guardSurface,
        action: actionForAudit,
        provider: providerId,
        model: fallbackModel,
        requestId: args.requestId,
        runId: null,
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        origin: s(args.input.origin) || null,
        inputChars: args.input.prompt.length,
        outputChars: s(fallbackData.answer).length,
        latencyMs: Date.now() - startedAt,
        status: "SUCCESS",
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      });

      await writeAiAudit({
        req: args.req,
        accountId: ctx.accountId,
        userId: ctx.userId,
        requestId: args.requestId,
        surface: guardSurface,
        action: actionForAudit,
        provider: providerId,
        model: fallbackModel,
        status: "SUCCESS",
        memberRole: ctx.memberRole,
        planId: ctx.planId,
        actionClass: policy?.actionClass || "standard",
        reasoningLevel: fallbackReasoningLevel,
        weightedUsageUnits: policy?.weightedUsageUnits || 0,
        latencyMs: Date.now() - startedAt,
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        origin: s(args.input.origin) || null,
        researchMode: fallbackResearchMode,
        researchToolBundle: policy?.researchToolBundle || [],
        researchUrlsCount: requestedResearchUrls.length,
        attachmentCount: imageAttachmentMeta.length,
        outcome: "safe_fallback_response_generated",
      });

      return {
        ok: true,
        requestId: args.requestId,
        providerId,
        model: fallbackModel,
        sessionId: fallbackSessionId,
        data: fallbackData,
      };
    }

    if (args.input.prompt) {
      try {
        await persistSessionTurn({
          accountId: ctx.accountId,
          userId: ctx.userId,
          requestId: args.requestId,
          action: actionForAudit,
          surface: toSessionSurface(args.input.surface),
          sessionId: sessionId || null,
          contextLabel: args.input.contextLabel || sessionTitleFromSurface(toSessionSurface(args.input.surface)),
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          origin: s(args.input.origin) || null,
          userText: args.input.prompt,
          userJson: buildCenterRetryUserJson({
            input: args.input,
            effectiveAction,
            model: requestedModelForRetry,
            reasoningLevel: policy?.reasoningLevel || args.input.reasoningLevel || "medium",
            actionClass: policy?.actionClass || "standard",
            taskType,
            researchMode: policy?.researchMode || researchModeRequested,
            researchToolBundle: policy?.researchToolBundle || [],
            researchUrls: requestedResearchUrls,
            imageAttachments: imageAttachmentsForRetry,
            contextPack,
            context: inputContext,
          }),
          assistantText: mapped.message,
          assistantJson: {
            error: mapped.code,
            message: mapped.message,
          },
          provider: providerId,
          model: model || undefined,
          status: "ERROR",
          errorCode: mapped.code,
        });
      } catch {
        // no-op: avoid masking primary error
      }
    }

    await writeAiUsageLog({
      accountId: ctx.accountId,
      userId: ctx.userId,
      surface: guardSurface,
      action: actionForAudit,
      provider: providerId,
      model: model || "unknown",
      requestId: args.requestId,
      runId: null,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: s(args.input.origin) || null,
      inputChars: args.input.prompt.length,
      outputChars: 0,
      latencyMs: Date.now() - startedAt,
      status: "ERROR",
      errorCode: mapped.code,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });

    await writeAiAudit({
      req: args.req,
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId: args.requestId,
      surface: guardSurface,
      action: actionForAudit,
      provider: providerId,
      model: model || "unknown",
      status: "ERROR",
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      actionClass: policy?.actionClass || "standard",
      reasoningLevel: policy?.reasoningLevel || args.input.reasoningLevel || "medium",
      weightedUsageUnits: policy?.weightedUsageUnits || 0,
      latencyMs: Date.now() - startedAt,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      origin: s(args.input.origin) || null,
      researchMode: policy?.researchMode || researchModeRequested,
      researchToolBundle: policy?.researchToolBundle || [],
      researchUrlsCount: requestedResearchUrls.length,
      attachmentCount: imageAttachmentMeta.length,
      errorCode: mapped.code,
      outcome: "failed",
    });

    return withGuard(mapped, {
      ok: false,
      requestId: args.requestId,
      error: mapped.code,
      message: mapped.message,
      status: mapped.status,
    });
  } finally {
    policy?.releaseGenerationSlot();
  }
}

export function buildDeterministicSurfaceFallback(args: {
  surface: Exclude<AiSurface, "cavcode">;
  action: string;
  goal: string;
}): SurfaceAssistResponse {
  return {
    summary: `${args.surface} action "${args.action}" requires provider execution.`,
    risk: toRiskLevel(args.action),
    recommendations: [
      `Review goal scope: ${clampText(args.goal, 220)}`,
      "Attach deterministic evidence references where available.",
      "Run tenant-scoped verification before applying changes.",
    ],
    notes: [
      "This is a deterministic fallback response because provider output was unavailable.",
    ],
    followUpChecks: [
      "Confirm auth, scope, and policy checks.",
      "Retry with provider connectivity and JSON mode enabled.",
    ],
    evidenceRefs: [],
  };
}
