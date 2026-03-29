import { z } from "zod";

export const CAVAI_NORMALIZED_INPUT_SCHEMA_VERSION_V1 = "cavai.normalized_input.v1" as const;
export const CAVAI_INSIGHT_PACK_SCHEMA_VERSION_V1 = "cavai.insightpack.v1" as const;
export const CAVAI_NARRATION_SCHEMA_VERSION_V1 = "cavai.narration.v1" as const;
export const CAVAI_FIX_PLAN_SCHEMA_VERSION_V1 = "cavai.fixplan.v1" as const;

export const CAVAI_PILLAR_SCHEMA = z.enum([
  "seo",
  "performance",
  "accessibility",
  "ux",
  "engagement",
  "reliability",
]);

export const CAVAI_SEVERITY_SCHEMA = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "note",
]);

export const CAVAI_CONFIDENCE_SCHEMA = z.enum(["high", "medium", "low"]);
export const CAVAI_RISK_SCHEMA = z.enum(["high", "medium", "low"]);

export const CAVAI_RUN_META_SCHEMA_V1 = z.object({
  packVersion: z.string().trim().min(1).max(80),
  engineVersion: z.string().trim().min(1).max(120),
  createdAt: z.string().datetime(),
  runId: z.string().trim().min(1).max(160),
  requestId: z.string().trim().min(1).max(160),
  origin: z.string().trim().min(1).max(2_000),
  accountId: z.string().trim().min(1).max(160),
  workspaceId: z.string().trim().min(1).max(160).optional(),
  projectId: z.number().int().positive().optional(),
});

const EvidenceDomSchema = z.object({
  type: z.literal("dom"),
  selector: z.string().trim().min(1).max(500),
  snippet: z.string().trim().max(800).optional(),
  attribute: z.string().trim().max(160).optional(),
});

const EvidenceHttpSchema = z.object({
  type: z.literal("http"),
  url: z.string().trim().min(1).max(4_000),
  method: z.string().trim().max(20).optional(),
  status: z.number().int().min(100).max(599),
});

const EvidenceMetricSchema = z.object({
  type: z.literal("metric"),
  name: z.string().trim().min(1).max(160),
  value: z.number().finite(),
  unit: z.string().trim().max(40).optional(),
});

const EvidenceRouteSchema = z.object({
  type: z.literal("route"),
  path: z.string().trim().min(1).max(1_000),
  statusCode: z.number().int().min(100).max(599).optional(),
  reason: z.string().trim().max(800).optional(),
});

const EvidenceLogSchema = z.object({
  type: z.literal("log"),
  level: z.enum(["error", "warn", "info"]),
  fingerprint: z.string().trim().min(1).max(240),
  message: z.string().trim().max(1_000).optional(),
});

const EvidenceConfigSchema = z.object({
  type: z.literal("config"),
  key: z.string().trim().min(1).max(200),
  state: z.enum(["present", "missing", "invalid"]),
  source: z.string().trim().max(200).optional(),
  snippet: z.string().trim().max(1_000).optional(),
});

export const CAVAI_EVIDENCE_REF_SCHEMA_V1 = z.union([
  EvidenceDomSchema,
  EvidenceHttpSchema,
  EvidenceMetricSchema,
  EvidenceRouteSchema,
  EvidenceLogSchema,
  EvidenceConfigSchema,
]);

export const CAVAI_FINDING_SCHEMA_V1 = z.object({
  id: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(120),
  pillar: CAVAI_PILLAR_SCHEMA,
  severity: CAVAI_SEVERITY_SCHEMA,
  evidence: z.array(CAVAI_EVIDENCE_REF_SCHEMA_V1).min(1).max(80),
  origin: z.string().trim().min(1).max(2_000),
  pagePath: z.string().trim().min(1).max(2_000),
  templateHint: z.string().trim().max(200).nullable().optional(),
  detectedAt: z.string().datetime(),
});

export const CAVAI_PATTERN_SCHEMA_V1 = z.object({
  code: z.string().trim().min(1).max(120),
  pillar: CAVAI_PILLAR_SCHEMA,
  severity: CAVAI_SEVERITY_SCHEMA,
  scope: z.enum(["single", "template", "sitewide"]),
  affectedPages: z.number().int().min(0),
  totalPagesScanned: z.number().int().min(1),
  samplePages: z.array(z.string().trim().min(1).max(2_000)).max(50),
  confidence: CAVAI_CONFIDENCE_SCHEMA,
  confidenceReason: z.string().trim().min(1).max(2_000),
  evidenceFindingIds: z.array(z.string().trim().min(1)).min(1).max(200),
  templateHint: z.string().trim().max(200).nullable().optional(),
  routeShape: z.string().trim().max(2_000).nullable().optional(),
});

const OpenTargetSchema = z.object({
  type: z.enum(["url", "file", "cavcloudFileId", "cavcloudPath"]),
  target: z.string().trim().min(1).max(2_000),
  label: z.string().trim().min(1).max(400),
  folderId: z.string().trim().max(160).optional(),
  workspaceId: z.string().trim().max(160).optional(),
  sha256: z.string().trim().max(128).optional(),
  updatedAt: z.string().datetime().optional(),
});

const NextActionSchema = z.object({
  id: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(500),
  detail: z.string().trim().min(1).max(8_000),
  targetArea: z.enum(["content", "template", "config"]),
  safeAutoFix: z.boolean().optional(),
  evidenceFindingIds: z.array(z.string().trim().min(1)).min(1).max(200),
  openTargets: z.array(OpenTargetSchema).max(80),
});

export const CAVAI_PRIORITY_SCHEMA_V1 = z.object({
  code: z.string().trim().min(1).max(120),
  pillar: CAVAI_PILLAR_SCHEMA,
  severity: CAVAI_SEVERITY_SCHEMA,
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(6_000),
  affectedPages: z.number().int().min(0),
  totalPagesScanned: z.number().int().min(1),
  coverage: z.number().finite(),
  severityWeight: z.number().finite(),
  coverageWeight: z.number().finite(),
  pageImportanceWeight: z.number().finite(),
  crossPillarWeight: z.number().finite(),
  effortPenalty: z.number().finite(),
  persistenceWeight: z.number().finite(),
  coreScore: z.number().finite(),
  priorityScore: z.number().finite(),
  confidence: CAVAI_CONFIDENCE_SCHEMA,
  confidenceReason: z.string().trim().min(1).max(2_000),
  evidenceFindingIds: z.array(z.string().trim().min(1)).min(1).max(400),
  nextActions: z.array(NextActionSchema).max(120),
});

const ExplanationSchema = z.object({
  id: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(500),
  text: z.string().trim().min(1).max(10_000),
  evidenceFindingIds: z.array(z.string().trim().min(1)).min(1).max(400),
});

const ConfidenceBlockSchema = z.object({
  level: CAVAI_CONFIDENCE_SCHEMA,
  reason: z.string().trim().min(1).max(2_000),
  evidenceFindingIds: z.array(z.string().trim().min(1)).max(400),
});

const RiskBlockSchema = z.object({
  level: CAVAI_RISK_SCHEMA,
  reason: z.string().trim().min(1).max(2_000),
  evidenceFindingIds: z.array(z.string().trim().min(1)).max(400),
});

const OverlaySchema = z.object({
  historyWindow: z.number().int().min(0),
  generatedFromRunIds: z.array(z.string().trim().min(1)).max(200),
  codeHistory: z.record(
    z.string(),
    z.object({
      runsSeen: z.number().int().min(0),
      consecutiveRuns: z.number().int().min(0),
    })
  ),
  diff: z
    .object({
      resolvedCodes: z.array(z.string().trim().min(1)).max(200),
      newCodes: z.array(z.string().trim().min(1)).max(200),
      persistedCodes: z.array(z.string().trim().min(1)).max(200),
      summary: z.string().trim().min(1).max(2_000),
    })
    .optional(),
  praise: z
    .object({
      line: z.string().trim().min(1).max(2_000),
      reason: z.string().trim().min(1).max(2_000),
      nextPriorityCode: z.string().trim().max(160).optional(),
    })
    .optional(),
  trend: z.object({
    state: z.enum(["improving", "stagnating", "degrading"]),
    reason: z.string().trim().min(1).max(2_000),
  }),
  fatigue: z.object({
    level: z.enum(["none", "watch", "high"]),
    message: z.string().trim().min(1).max(2_000),
  }),
});

export const NORMALIZED_SCAN_INPUT_SCHEMA_V1 = z.object({
  version: z
    .literal(CAVAI_NORMALIZED_INPUT_SCHEMA_VERSION_V1)
    .default(CAVAI_NORMALIZED_INPUT_SCHEMA_VERSION_V1),
  origin: z.string().trim().min(1).max(2_000),
  pagesSelected: z.array(z.string().trim().min(1).max(2_000)).min(1).max(500),
  pageLimit: z.number().int().min(1).max(5_000),
  findings: z.array(CAVAI_FINDING_SCHEMA_V1).min(1).max(5_000),
  context: z
    .object({
      routeMetadata: z.record(z.string(), z.unknown()).optional(),
      environment: z
        .object({
          sdkVersion: z.string().trim().max(120).optional(),
          appEnv: z.string().trim().max(120).optional(),
          runtime: z.string().trim().max(120).optional(),
        })
        .optional(),
      telemetrySummaryRefs: z
        .array(
          z.object({
            kind: z.enum(["error_cluster", "api_cluster", "404_cluster", "metric_rollup"]),
            refId: z.string().trim().min(1).max(200),
            summary: z.string().trim().min(1).max(1_000),
          })
        )
        .max(400)
        .optional(),
      traits: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional(),
      piiAllowed: z.boolean().optional(),
    })
    .optional(),
});

export const CAVAI_INSIGHT_PACK_SCHEMA_V1 = z.object({
  packVersion: z.literal(CAVAI_INSIGHT_PACK_SCHEMA_VERSION_V1),
  meta: CAVAI_RUN_META_SCHEMA_V1,
  inputHash: z.string().trim().min(1).max(128),
  coreDeterministic: z.literal(true),
  overlayIncluded: z.boolean(),
  origin: z.string().trim().min(1).max(2_000),
  generatedAt: z.string().datetime(),
  pagesScanned: z.number().int().min(0),
  pageLimit: z.number().int().min(1),
  core: z.object({
    findings: z.array(CAVAI_FINDING_SCHEMA_V1),
    patterns: z.array(CAVAI_PATTERN_SCHEMA_V1),
    priorities: z.array(CAVAI_PRIORITY_SCHEMA_V1),
    explanations: z.array(ExplanationSchema),
    nextActions: z.array(NextActionSchema),
    confidence: ConfidenceBlockSchema,
    risk: RiskBlockSchema,
  }),
  priorities: z.array(CAVAI_PRIORITY_SCHEMA_V1),
  explanations: z.array(ExplanationSchema),
  nextActions: z.array(NextActionSchema),
  confidence: ConfidenceBlockSchema,
  risk: RiskBlockSchema,
  overlay: OverlaySchema.optional(),
});

export const CAVAI_NARRATION_SCHEMA_V1 = z.object({
  version: z.literal(CAVAI_NARRATION_SCHEMA_VERSION_V1),
  meta: CAVAI_RUN_META_SCHEMA_V1,
  summary: z.string().trim().min(1).max(8_000),
  blocks: z.array(ExplanationSchema).min(1).max(200),
});

export const CAVAI_FIX_PLAN_SCHEMA_V1 = z.object({
  version: z.literal(CAVAI_FIX_PLAN_SCHEMA_VERSION_V1),
  meta: CAVAI_RUN_META_SCHEMA_V1,
  priorityCode: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(500),
  targetArea: z.enum(["content", "template", "config"]),
  evidenceFindingIds: z.array(z.string().trim().min(1)).min(1).max(400),
  steps: z.array(z.string().trim().min(1).max(2_000)).min(1).max(200),
  verificationSteps: z.array(z.string().trim().min(1).max(2_000)).min(1).max(200),
  openTargets: z.array(OpenTargetSchema).max(200),
});

export type CavAiRunMetaSchemaV1 = z.infer<typeof CAVAI_RUN_META_SCHEMA_V1>;
export type NormalizedScanInputSchemaV1 = z.infer<typeof NORMALIZED_SCAN_INPUT_SCHEMA_V1>;
export type CavAiFindingSchemaV1 = z.infer<typeof CAVAI_FINDING_SCHEMA_V1>;
export type CavAiPatternSchemaV1 = z.infer<typeof CAVAI_PATTERN_SCHEMA_V1>;
export type CavAiPrioritySchemaV1 = z.infer<typeof CAVAI_PRIORITY_SCHEMA_V1>;
export type CavAiInsightPackSchemaV1 = z.infer<typeof CAVAI_INSIGHT_PACK_SCHEMA_V1>;
export type CavAiNarrationSchemaV1 = z.infer<typeof CAVAI_NARRATION_SCHEMA_V1>;
export type CavAiFixPlanSchemaV1 = z.infer<typeof CAVAI_FIX_PLAN_SCHEMA_V1>;

export function parseNormalizedInputV1(raw: unknown) {
  return NORMALIZED_SCAN_INPUT_SCHEMA_V1.safeParse(raw);
}

export function parseInsightPackV1(raw: unknown) {
  return CAVAI_INSIGHT_PACK_SCHEMA_V1.safeParse(raw);
}

export function parseNarrationV1(raw: unknown) {
  return CAVAI_NARRATION_SCHEMA_V1.safeParse(raw);
}

export function parseFixPlanV1(raw: unknown) {
  return CAVAI_FIX_PLAN_SCHEMA_V1.safeParse(raw);
}
