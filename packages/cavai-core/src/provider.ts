import type {
  CavAiCodeFixProposalV1,
  CavAiInsightPackV1,
  CavAiNarrationV1,
} from "@/packages/cavai-contracts/src";

export type CavAiProviderValidationErrorCode =
  | "RUN_ID_MISMATCH"
  | "PRIORITY_NOT_FOUND"
  | "EVIDENCE_ID_UNKNOWN"
  | "NARRATION_BLOCKS_EMPTY"
  | "NARRATION_EVIDENCE_EMPTY"
  | "PATCHES_EMPTY"
  | "PATCH_PATH_INVALID"
  | "PATCH_DIFF_EMPTY";

export type CavAiProviderValidationError = {
  code: CavAiProviderValidationErrorCode;
  message: string;
  path: string;
};

export type CavAiProviderValidationResult =
  | { ok: true }
  | { ok: false; errors: CavAiProviderValidationError[] };

export type CavAiNarrationProvider = {
  providerId: string;
  generateNarration: (input: {
    pack: CavAiInsightPackV1;
    priorityCode?: string;
  }) => Promise<CavAiNarrationV1>;
};

export type CavAiCodeFixProposalProvider = {
  providerId: string;
  generateCodeFixProposal: (input: {
    pack: CavAiInsightPackV1;
    priorityCode: string;
  }) => Promise<CavAiCodeFixProposalV1>;
};

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

function collectKnownFindingIds(pack: CavAiInsightPackV1): Set<string> {
  const ids = new Set<string>();
  for (const finding of pack.core.findings || []) {
    const id = trim(finding?.id);
    if (id) ids.add(id);
  }
  return ids;
}

function pushError(
  errors: CavAiProviderValidationError[],
  error: CavAiProviderValidationError
) {
  errors.push(error);
}

function validateEvidenceIds(
  knownIds: Set<string>,
  evidenceIds: string[] | undefined,
  path: string,
  errors: CavAiProviderValidationError[]
) {
  const ids = Array.isArray(evidenceIds) ? evidenceIds.map((id) => trim(id)).filter(Boolean) : [];
  for (const id of ids) {
    if (!knownIds.has(id)) {
      pushError(errors, {
        code: "EVIDENCE_ID_UNKNOWN",
        message: `Evidence ID does not exist in pack findings: ${id}`,
        path,
      });
    }
  }
}

export function validateNarrationAgainstInsightPack(
  pack: CavAiInsightPackV1,
  narration: CavAiNarrationV1
): CavAiProviderValidationResult {
  const errors: CavAiProviderValidationError[] = [];
  if (trim(narration.runId) !== trim(pack.runId)) {
    pushError(errors, {
      code: "RUN_ID_MISMATCH",
      message: "Narration runId does not match the target insight pack runId.",
      path: "runId",
    });
  }

  const blocks = Array.isArray(narration.blocks) ? narration.blocks : [];
  if (!blocks.length) {
    pushError(errors, {
      code: "NARRATION_BLOCKS_EMPTY",
      message: "Narration must include at least one evidence-linked block.",
      path: "blocks",
    });
  }

  const knownIds = collectKnownFindingIds(pack);
  for (let i = 0; i < blocks.length; i++) {
    const ids = Array.isArray(blocks[i]?.evidenceFindingIds)
      ? blocks[i]?.evidenceFindingIds.map((id) => trim(id)).filter(Boolean)
      : [];
    if (!ids.length) {
      pushError(errors, {
        code: "NARRATION_EVIDENCE_EMPTY",
        message: "Narration blocks must include at least one evidenceFindingId.",
        path: `blocks[${i}].evidenceFindingIds`,
      });
      continue;
    }
    validateEvidenceIds(knownIds, ids, `blocks[${i}].evidenceFindingIds`, errors);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

export function validateCodeFixProposalAgainstInsightPack(
  pack: CavAiInsightPackV1,
  proposal: CavAiCodeFixProposalV1
): CavAiProviderValidationResult {
  const errors: CavAiProviderValidationError[] = [];
  if (trim(proposal.runId) !== trim(pack.runId)) {
    pushError(errors, {
      code: "RUN_ID_MISMATCH",
      message: "Code-fix proposal runId does not match the target insight pack runId.",
      path: "runId",
    });
  }

  const code = trim(proposal.priorityCode).toLowerCase();
  if (!pack.priorities.some((priority) => trim(priority.code).toLowerCase() === code)) {
    pushError(errors, {
      code: "PRIORITY_NOT_FOUND",
      message: "Code-fix proposal priorityCode is not present in the target insight pack.",
      path: "priorityCode",
    });
  }

  const knownIds = collectKnownFindingIds(pack);
  validateEvidenceIds(knownIds, proposal.evidenceFindingIds, "evidenceFindingIds", errors);

  const patches = Array.isArray(proposal.patches) ? proposal.patches : [];
  if (!patches.length) {
    pushError(errors, {
      code: "PATCHES_EMPTY",
      message: "Code-fix proposal must contain at least one patch.",
      path: "patches",
    });
  }
  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    if (!trim(patch?.filePath)) {
      pushError(errors, {
        code: "PATCH_PATH_INVALID",
        message: "Patch filePath is required.",
        path: `patches[${i}].filePath`,
      });
    }
    if (!trim(patch?.unifiedDiff)) {
      pushError(errors, {
        code: "PATCH_DIFF_EMPTY",
        message: "Patch unifiedDiff is required.",
        path: `patches[${i}].unifiedDiff`,
      });
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}
