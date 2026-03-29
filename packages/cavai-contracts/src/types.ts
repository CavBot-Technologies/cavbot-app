export const CAVAI_INSIGHT_PACK_VERSION_V1 = "cavai.insightpack.v1" as const;
export const CAVAI_NORMALIZED_INPUT_VERSION_V1 = "cavai.normalized_input.v1" as const;
export const CAVAI_FIX_PLAN_VERSION_V1 = "cavai.fixplan.v1" as const;

export type CavAiPillar =
  | "seo"
  | "performance"
  | "accessibility"
  | "ux"
  | "engagement"
  | "reliability";

export type CavAiSeverity = "critical" | "high" | "medium" | "low" | "note";
export type CavAiPriorityConfidence = "high" | "medium" | "low";
export type CavAiRiskLevel = "high" | "medium" | "low";
export type CavAiPatternScope = "single" | "template" | "sitewide";
export type CavAiTargetArea = "content" | "template" | "config";
export type CavAiOpenTargetType = "url" | "file" | "cavcloudFileId" | "cavcloudPath";

export type CavAiEvidenceRefDom = {
  type: "dom";
  selector: string;
  snippet?: string;
  attribute?: string;
};

export type CavAiEvidenceRefHttp = {
  type: "http";
  url: string;
  method?: string;
  status: number;
};

export type CavAiEvidenceRefMetric = {
  type: "metric";
  name: string;
  value: number;
  unit?: string;
};

export type CavAiEvidenceRefRoute = {
  type: "route";
  path: string;
  statusCode?: number;
  reason?: string;
};

export type CavAiEvidenceRefLog = {
  type: "log";
  level: "error" | "warn" | "info";
  fingerprint: string;
  message?: string;
};

export type CavAiEvidenceRefConfig = {
  type: "config";
  key: string;
  state: "present" | "missing" | "invalid";
  source?: string;
  snippet?: string;
};

export type CavAiEvidenceRef =
  | CavAiEvidenceRefDom
  | CavAiEvidenceRefHttp
  | CavAiEvidenceRefMetric
  | CavAiEvidenceRefRoute
  | CavAiEvidenceRefLog
  | CavAiEvidenceRefConfig;

export type CavAiFindingV1 = {
  id: string;
  code: string;
  pillar: CavAiPillar;
  severity: CavAiSeverity;
  evidence: CavAiEvidenceRef[];
  origin: string;
  pagePath: string;
  templateHint?: string | null;
  detectedAt: string;
};

export type CavAiRouteMetadataV1 = Record<string, unknown>;

export type CavAiEnvironmentInfoV1 = {
  sdkVersion?: string;
  appEnv?: string;
  runtime?: string;
};

export type CavAiTelemetrySummaryRefV1 = {
  kind: "error_cluster" | "api_cluster" | "404_cluster" | "metric_rollup";
  refId: string;
  summary: string;
};

export type CavAiContextV1 = {
  routeMetadata?: CavAiRouteMetadataV1;
  environment?: CavAiEnvironmentInfoV1;
  telemetrySummaryRefs?: CavAiTelemetrySummaryRefV1[];
  traits?: Record<string, string | number | boolean | null>;
  piiAllowed?: boolean;
};

export type CavAiRunMetaV1 = {
  packVersion: string;
  engineVersion: string;
  createdAt: string;
  runId: string;
  requestId: string;
  origin: string;
  accountId: string;
  workspaceId?: string;
  projectId?: number;
};

export type NormalizedScanInputV1 = {
  version?: typeof CAVAI_NORMALIZED_INPUT_VERSION_V1;
  origin: string;
  pagesSelected: string[];
  pageLimit: number;
  findings: CavAiFindingV1[];
  context?: CavAiContextV1;
};

export type CavAiPatternV1 = {
  code: string;
  pillar: CavAiPillar;
  severity: CavAiSeverity;
  scope: CavAiPatternScope;
  affectedPages: number;
  totalPagesScanned: number;
  samplePages: string[];
  confidence: CavAiPriorityConfidence;
  confidenceReason: string;
  evidenceFindingIds: string[];
  templateHint?: string | null;
  routeShape?: string | null;
};

export type CavAiOpenTargetV1 = {
  type: CavAiOpenTargetType;
  target: string;
  label: string;
  folderId?: string;
  workspaceId?: string;
  sha256?: string;
  updatedAt?: string;
};

export type CavAiNextActionV1 = {
  id: string;
  code: string;
  title: string;
  detail: string;
  targetArea: CavAiTargetArea;
  safeAutoFix?: boolean;
  evidenceFindingIds: string[];
  openTargets: CavAiOpenTargetV1[];
};

export type CavAiPriorityV1 = {
  code: string;
  pillar: CavAiPillar;
  severity: CavAiSeverity;
  title: string;
  summary: string;
  affectedPages: number;
  totalPagesScanned: number;
  coverage: number;
  severityWeight: number;
  coverageWeight: number;
  pageImportanceWeight: number;
  crossPillarWeight: number;
  effortPenalty: number;
  persistenceWeight: number;
  coreScore: number;
  priorityScore: number;
  confidence: CavAiPriorityConfidence;
  confidenceReason: string;
  evidenceFindingIds: string[];
  nextActions: CavAiNextActionV1[];
};

export type CavAiExplanationBlockV1 = {
  id: string;
  title: string;
  text: string;
  evidenceFindingIds: string[];
};

export type CavAiConfidenceBlockV1 = {
  level: CavAiPriorityConfidence;
  reason: string;
  evidenceFindingIds: string[];
};

export type CavAiRiskBlockV1 = {
  level: CavAiRiskLevel;
  reason: string;
  evidenceFindingIds: string[];
};

export type CavAiCodeHistoryV1 = {
  runsSeen: number;
  consecutiveRuns: number;
};

export type CavAiOverlayV1 = {
  historyWindow: number;
  generatedFromRunIds: string[];
  codeHistory: Record<string, CavAiCodeHistoryV1>;
  diff?: {
    resolvedCodes: string[];
    newCodes: string[];
    persistedCodes: string[];
    summary: string;
  };
  praise?: {
    line: string;
    reason: string;
    nextPriorityCode?: string;
  };
  trend: {
    state: "improving" | "stagnating" | "degrading";
    reason: string;
  };
  fatigue: {
    level: "none" | "watch" | "high";
    message: string;
  };
};

export type CavAiCoreDeterministicV1 = {
  findings: CavAiFindingV1[];
  patterns: CavAiPatternV1[];
  priorities: CavAiPriorityV1[];
  explanations: CavAiExplanationBlockV1[];
  nextActions: CavAiNextActionV1[];
  confidence: CavAiConfidenceBlockV1;
  risk: CavAiRiskBlockV1;
};

export type CavAiInsightPackV1 = {
  packVersion: typeof CAVAI_INSIGHT_PACK_VERSION_V1;
  meta?: CavAiRunMetaV1;
  engineVersion: string;
  inputHash: string;
  coreDeterministic: true;
  overlayIncluded: boolean;
  requestId: string;
  runId: string;
  accountId: string;
  origin: string;
  generatedAt: string;
  pagesScanned: number;
  pageLimit: number;
  core: CavAiCoreDeterministicV1;
  priorities: CavAiPriorityV1[];
  explanations: CavAiExplanationBlockV1[];
  nextActions: CavAiNextActionV1[];
  confidence: CavAiConfidenceBlockV1;
  risk: CavAiRiskBlockV1;
  overlay?: CavAiOverlayV1;
};

export type CavAiFixPlanV1 = {
  version?: typeof CAVAI_FIX_PLAN_VERSION_V1;
  meta?: CavAiRunMetaV1;
  runId: string;
  priorityCode: string;
  title: string;
  targetArea: CavAiTargetArea;
  evidenceFindingIds: string[];
  steps: string[];
  verificationSteps: string[];
  openTargets: CavAiOpenTargetV1[];
};

export const CAVAI_NARRATION_VERSION_V1 = "cavai.narration.v1" as const;
export const CAVAI_CODE_FIX_PROPOSAL_VERSION_V1 = "cavai.codefixproposal.v1" as const;

export type CavAiNarrationBlockV1 = {
  id: string;
  title: string;
  text: string;
  evidenceFindingIds: string[];
};

export type CavAiNarrationV1 = {
  version: typeof CAVAI_NARRATION_VERSION_V1;
  meta?: CavAiRunMetaV1;
  runId: string;
  origin: string;
  generatedAt: string;
  summary: string;
  blocks: CavAiNarrationBlockV1[];
};

export type CavAiCodeFixPatchV1 = {
  filePath: string;
  beforeSha256?: string;
  unifiedDiff: string;
};

export type CavAiCodeFixProposalV1 = {
  version: typeof CAVAI_CODE_FIX_PROPOSAL_VERSION_V1;
  runId: string;
  priorityCode: string;
  title: string;
  rationale: string;
  evidenceFindingIds: string[];
  patches: CavAiCodeFixPatchV1[];
  openTargets: CavAiOpenTargetV1[];
};

export type CavAiValidatorErrorCode =
  | "PACK_VERSION_INVALID"
  | "ENGINE_VERSION_MISSING"
  | "REQUEST_ID_MISSING"
  | "RUN_ID_MISSING"
  | "FINDING_ID_DUPLICATE"
  | "PRIORITY_EVIDENCE_EMPTY"
  | "EXPLANATION_EVIDENCE_EMPTY"
  | "EVIDENCE_ID_UNKNOWN"
  | "PRIORITY_CODE_UNKNOWN"
  | "ACTION_CODE_UNKNOWN";

export type CavAiValidatorError = {
  code: CavAiValidatorErrorCode;
  message: string;
  path: string;
};
