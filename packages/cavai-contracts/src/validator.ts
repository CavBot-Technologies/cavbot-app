import type {
  CavAiInsightPackV1,
  CavAiNextActionV1,
  CavAiValidatorError,
} from "./types";
import { CAVAI_INSIGHT_PACK_VERSION_V1 } from "./types";

function pushError(
  errors: CavAiValidatorError[],
  error: CavAiValidatorError
) {
  errors.push(error);
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function collectEvidenceRefs(
  findingIds: Set<string>,
  ids: string[] | undefined,
  path: string,
  errors: CavAiValidatorError[],
  emptyCode: CavAiValidatorError["code"]
) {
  const evidenceIds = Array.isArray(ids) ? ids.filter(isNonEmptyString) : [];
  if (!evidenceIds.length) {
    pushError(errors, {
      code: emptyCode,
      message: "evidenceFindingIds must be non-empty",
      path,
    });
    return;
  }
  for (const id of evidenceIds) {
    if (!findingIds.has(id)) {
      pushError(errors, {
        code: "EVIDENCE_ID_UNKNOWN",
        message: `Referenced evidence finding id does not exist: ${id}`,
        path,
      });
    }
  }
}

function validateActionCodes(
  actions: CavAiNextActionV1[] | undefined,
  findingIds: Set<string>,
  findingCodes: Set<string>,
  path: string,
  errors: CavAiValidatorError[]
) {
  if (!Array.isArray(actions)) return;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action) continue;
    if (!isNonEmptyString(action.code) || !findingCodes.has(action.code)) {
      pushError(errors, {
        code: "ACTION_CODE_UNKNOWN",
        message: `Action code must exist in findings[]: ${String(action?.code || "")}`,
        path: `${path}[${i}]`,
      });
    }
    collectEvidenceRefs(
      findingIds,
      action.evidenceFindingIds,
      `${path}[${i}].evidenceFindingIds`,
      errors,
      "PRIORITY_EVIDENCE_EMPTY"
    );
  }
}

export type InsightPackValidationResult =
  | { ok: true }
  | { ok: false; errors: CavAiValidatorError[] };

export function validateInsightPackV1(pack: CavAiInsightPackV1): InsightPackValidationResult {
  const errors: CavAiValidatorError[] = [];

  if (!pack || typeof pack !== "object") {
    return {
      ok: false,
      errors: [
        {
          code: "PACK_VERSION_INVALID",
          message: "Pack must be an object.",
          path: "$",
        },
      ],
    };
  }

  if (pack.packVersion !== CAVAI_INSIGHT_PACK_VERSION_V1) {
    pushError(errors, {
      code: "PACK_VERSION_INVALID",
      message: `packVersion must be ${CAVAI_INSIGHT_PACK_VERSION_V1}`,
      path: "packVersion",
    });
  }
  if (!isNonEmptyString(pack.engineVersion)) {
    pushError(errors, {
      code: "ENGINE_VERSION_MISSING",
      message: "engineVersion is required.",
      path: "engineVersion",
    });
  }
  if (!isNonEmptyString(pack.requestId)) {
    pushError(errors, {
      code: "REQUEST_ID_MISSING",
      message: "requestId is required.",
      path: "requestId",
    });
  }
  if (!isNonEmptyString(pack.runId)) {
    pushError(errors, {
      code: "RUN_ID_MISSING",
      message: "runId is required.",
      path: "runId",
    });
  }

  const findingIds = new Set<string>();
  const findingCodes = new Set<string>();
  for (let i = 0; i < (pack.core?.findings || []).length; i++) {
    const finding = pack.core.findings[i];
    if (!finding || !isNonEmptyString(finding.id)) continue;
    if (findingIds.has(finding.id)) {
      pushError(errors, {
        code: "FINDING_ID_DUPLICATE",
        message: `Duplicate finding id: ${finding.id}`,
        path: `core.findings[${i}].id`,
      });
    }
    findingIds.add(finding.id);
    if (isNonEmptyString(finding.code)) findingCodes.add(finding.code);
  }

  for (let i = 0; i < (pack.priorities || []).length; i++) {
    const priority = pack.priorities[i];
    if (!priority) continue;
    if (!isNonEmptyString(priority.code) || !findingCodes.has(priority.code)) {
      pushError(errors, {
        code: "PRIORITY_CODE_UNKNOWN",
        message: `Priority code must exist in findings[]: ${String(priority?.code || "")}`,
        path: `priorities[${i}].code`,
      });
    }
    collectEvidenceRefs(
      findingIds,
      priority.evidenceFindingIds,
      `priorities[${i}].evidenceFindingIds`,
      errors,
      "PRIORITY_EVIDENCE_EMPTY"
    );
    validateActionCodes(
      priority.nextActions,
      findingIds,
      findingCodes,
      `priorities[${i}].nextActions`,
      errors
    );
  }

  for (let i = 0; i < (pack.explanations || []).length; i++) {
    const block = pack.explanations[i];
    if (!block) continue;
    collectEvidenceRefs(
      findingIds,
      block.evidenceFindingIds,
      `explanations[${i}].evidenceFindingIds`,
      errors,
      "EXPLANATION_EVIDENCE_EMPTY"
    );
  }

  for (let i = 0; i < (pack.nextActions || []).length; i++) {
    const action = pack.nextActions[i];
    if (!action) continue;
    if (!isNonEmptyString(action.code) || !findingCodes.has(action.code)) {
      pushError(errors, {
        code: "ACTION_CODE_UNKNOWN",
        message: `Action code must exist in findings[]: ${String(action?.code || "")}`,
        path: `nextActions[${i}].code`,
      });
    }
    collectEvidenceRefs(
      findingIds,
      action.evidenceFindingIds,
      `nextActions[${i}].evidenceFindingIds`,
      errors,
      "PRIORITY_EVIDENCE_EMPTY"
    );
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}
