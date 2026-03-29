import "server-only";

export type CavAiPatchTargetArea = "config" | "template" | "content" | "code";

export type CavAiVerificationKind =
  | "typecheck"
  | "lint"
  | "unit_tests"
  | "diagnostics_delta"
  | "intent_match";

export type CavAiVerificationStep = {
  id: string;
  kind: CavAiVerificationKind;
  label: string;
  required: boolean;
};

export type CavAiFixPipelineDraft = {
  stage: "draft";
  targetArea: CavAiPatchTargetArea;
  filePath: string;
  proposedCode: string;
  evidenceSummary: string[];
  verificationPlan: CavAiVerificationStep[];
  requiresUserApproval: true;
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function resolveTargetArea(filePath: string): CavAiPatchTargetArea {
  const path = s(filePath).toLowerCase();
  if (!path) return "code";
  if (path.includes("config") || path.endsWith(".json") || path.endsWith(".toml") || path.endsWith(".yml")) {
    return "config";
  }
  if (path.includes("template") || path.includes("layout") || path.endsWith(".tsx") || path.endsWith(".jsx")) {
    return "template";
  }
  if (path.endsWith(".md") || path.endsWith(".txt") || path.includes("copy")) return "content";
  return "code";
}

export function buildVerificationPlan(filePath: string): CavAiVerificationStep[] {
  const path = s(filePath).toLowerCase();
  const isTypedSource = path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".mts");
  const isCodeFile = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|scss|md)$/.test(path);

  const base: CavAiVerificationStep[] = [
    {
      id: "verify_intent_match",
      kind: "intent_match",
      label: "Verify proposed changes match the evidence and requested action intent.",
      required: true,
    },
    {
      id: "verify_diagnostics_delta",
      kind: "diagnostics_delta",
      label: "Re-run diagnostics and confirm the targeted issue signal improves.",
      required: true,
    },
  ];

  if (isTypedSource) {
    base.unshift({
      id: "verify_typecheck",
      kind: "typecheck",
      label: "Run typecheck for impacted workspace scope.",
      required: true,
    });
  }

  if (isCodeFile) {
    base.unshift({
      id: "verify_lint",
      kind: "lint",
      label: "Run lint for impacted files/routes.",
      required: true,
    });
  }

  base.push({
    id: "verify_unit_tests",
    kind: "unit_tests",
    label: "Run relevant unit/integration tests where available.",
    required: false,
  });

  return base;
}

export function buildFixPipelineDraft(args: {
  filePath: string;
  proposedCode: string;
  evidenceSummary: string[];
}): CavAiFixPipelineDraft {
  return {
    stage: "draft",
    targetArea: resolveTargetArea(args.filePath),
    filePath: s(args.filePath),
    proposedCode: String(args.proposedCode || ""),
    evidenceSummary: (args.evidenceSummary || []).map((item) => s(item)).filter(Boolean).slice(0, 24),
    verificationPlan: buildVerificationPlan(args.filePath),
    requiresUserApproval: true,
  };
}
