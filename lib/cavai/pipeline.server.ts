import "server-only";

import { applyOverlay, buildDeterministicCore, buildInputHash } from "@/packages/cavai-core/src";
import {
  validateInsightPackV1,
  type CavAiInsightPackV1,
  type NormalizedScanInputV1,
} from "@/packages/cavai-contracts/src";
import {
  computeOverlay,
  createRunAndFindings,
  findIdempotentPack,
  normalizeFindingsForInput,
  persistInsightPack,
} from "@/lib/cavai/intelligence.server";
import { augmentAccessibilityPlusFindings } from "@/lib/cavai/accessibility-plus.server";
import { augmentFaviconFindings } from "@/lib/cavai/favicon.server";
import { augmentKeywordFindings } from "@/lib/cavai/keywords.server";
import { augmentReliability404Findings } from "@/lib/cavai/reliability-404.server";
import { augmentStructuredDataFindings } from "@/lib/cavai/structured-data.server";
import { augmentTrustPageFindings } from "@/lib/cavai/trust-pages.server";
import { augmentUxLayoutGuardFindings } from "@/lib/cavai/ux-layout-guards.server";

export const DEFAULT_CAVAI_ENGINE_VERSION = "cavai-core@1.1.0";

export class CavAiPackValidationError extends Error {
  constructor(public details: string[]) {
    super("PACK_VALIDATION_FAILED");
  }
}

type GeneratedPackMeta = {
  workspaceId?: string;
  projectId?: number;
};

export type GenerateInsightPackFromInputResult = {
  requestId: string;
  input: NormalizedScanInputV1;
  inputHash: string;
  runId: string;
  pack: CavAiInsightPackV1;
  idempotent: boolean;
  createdAtIso: string;
};

async function augmentDeterministicInput(input: NormalizedScanInputV1): Promise<NormalizedScanInputV1> {
  const normalizedFindings = normalizeFindingsForInput(input.findings, input.origin);
  const withFavicon = await augmentFaviconFindings({
    input: {
      ...input,
      findings: normalizedFindings,
    },
  });
  const withStructuredData = await augmentStructuredDataFindings({
    input: {
      ...input,
      findings: withFavicon,
    },
  });
  const withAccessibility = await augmentAccessibilityPlusFindings({
    input: {
      ...input,
      findings: withStructuredData,
    },
  });
  const withReliability = await augmentReliability404Findings({
    input: {
      ...input,
      findings: withAccessibility,
    },
  });
  const withUxLayout = await augmentUxLayoutGuardFindings({
    input: {
      ...input,
      findings: withReliability,
    },
  });
  const withTrust = await augmentTrustPageFindings({
    input: {
      ...input,
      findings: withUxLayout,
    },
  });
  const withKeywords = await augmentKeywordFindings({
    input: {
      ...input,
      findings: withTrust,
    },
  });

  return {
    ...input,
    findings: withKeywords,
  };
}

function mergePackMeta(
  pack: CavAiInsightPackV1,
  meta: GeneratedPackMeta | undefined,
): CavAiInsightPackV1 {
  if (!meta?.workspaceId && meta?.projectId == null) return pack;
  const baseMeta = pack.meta ?? {
    packVersion: pack.packVersion,
    engineVersion: pack.engineVersion,
    createdAt: pack.generatedAt,
    runId: pack.runId,
    requestId: pack.requestId,
    origin: pack.origin,
    accountId: pack.accountId,
  };
  return {
    ...pack,
    meta: {
      ...baseMeta,
      ...(meta.workspaceId ? { workspaceId: meta.workspaceId } : {}),
      ...(meta.projectId != null ? { projectId: meta.projectId } : {}),
    },
  };
}

export async function generateInsightPackFromInput(args: {
  accountId: string;
  userId: string;
  input: NormalizedScanInputV1;
  requestId?: string;
  force?: boolean;
  engineVersion?: string;
  meta?: GeneratedPackMeta;
}): Promise<GenerateInsightPackFromInputResult> {
  const requestId = String(args.requestId || "").trim() || crypto.randomUUID();
  const engineVersion = String(args.engineVersion || "").trim() || DEFAULT_CAVAI_ENGINE_VERSION;
  const input = await augmentDeterministicInput(args.input);
  const inputHash = buildInputHash(input);

  if (!args.force) {
    const existing = await findIdempotentPack({
      accountId: args.accountId,
      origin: input.origin,
      inputHash,
    });
    if (existing) {
      return {
        requestId,
        input,
        inputHash,
        runId: existing.runId,
        pack: existing,
        idempotent: true,
        createdAtIso: existing.generatedAt,
      };
    }
  }

  const run = await createRunAndFindings({
    accountId: args.accountId,
    userId: args.userId,
    input,
    inputHash,
    engineVersion,
  });

  const corePack = buildDeterministicCore(input, {
    engineVersion,
    requestId,
    runId: run.runId,
    accountId: args.accountId,
    generatedAt: run.createdAtIso,
    inputHash,
  });

  const overlay = await computeOverlay({
    accountId: args.accountId,
    origin: input.origin,
  });
  const pack = mergePackMeta(applyOverlay(corePack, overlay), args.meta);

  const validated = validateInsightPackV1(pack);
  if (!validated.ok) {
    throw new CavAiPackValidationError(
      validated.errors.map((error) =>
        typeof error === "string"
          ? error
          : [error.path, error.message].filter(Boolean).join(": ") || "PACK_VALIDATION_FAILED",
      ),
    );
  }

  await persistInsightPack({
    accountId: args.accountId,
    runId: run.runId,
    pack,
  });

  return {
    requestId,
    input,
    inputHash,
    runId: run.runId,
    pack,
    idempotent: false,
    createdAtIso: run.createdAtIso,
  };
}
