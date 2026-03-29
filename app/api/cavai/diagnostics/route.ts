import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { buildDeterministicCore, buildInputHash, applyOverlay } from "@/packages/cavai-core/src";
import { parseNormalizedScanInputV1, validateInsightPackV1 } from "@/packages/cavai-contracts/src";
import { auditLogWrite } from "@/lib/audit";
import {
  computeOverlay,
  createRunAndFindings,
  findIdempotentPack,
  normalizeFindingsForInput,
  persistInsightPack,
} from "@/lib/cavai/intelligence.server";
import { augmentFaviconFindings } from "@/lib/cavai/favicon.server";
import { augmentStructuredDataFindings } from "@/lib/cavai/structured-data.server";
import { augmentAccessibilityPlusFindings } from "@/lib/cavai/accessibility-plus.server";
import { augmentReliability404Findings } from "@/lib/cavai/reliability-404.server";
import { augmentUxLayoutGuardFindings } from "@/lib/cavai/ux-layout-guards.server";
import { augmentTrustPageFindings } from "@/lib/cavai/trust-pages.server";
import { augmentKeywordFindings } from "@/lib/cavai/keywords.server";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  requireAccountContext,
  requireSession,
  isApiAuthError,
} from "@/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENGINE_VERSION = "cavai-core@1.1.0";
const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(payload: unknown, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

async function writeDiagnosticsAudit(args: {
  req: NextRequest;
  accountId: string;
  userId: string;
  runId: string;
  origin: string;
  inputHash: string;
  idempotent: boolean;
}) {
  try {
    await auditLogWrite({
      accountId: args.accountId,
      operatorUserId: args.userId,
      action: "SYSTEM_JOB_RAN",
      actionLabel: args.idempotent ? "CavAi diagnostics returned cached pack" : "CavAi diagnostics generated pack",
      category: "system",
      severity: "info",
      targetType: "cavai_diagnostics_run",
      targetId: args.runId,
      targetLabel: args.origin,
      request: args.req,
      metaJson: {
        runId: args.runId,
        origin: args.origin,
        inputHash: args.inputHash,
        idempotent: args.idempotent,
      },
    });
  } catch {
    // Never fail diagnostics on audit-write failures.
  }
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const isStatusProbe = req.headers.get("x-cavbot-status-probe") === "1";

  try {
    const rawBody = await readSanitizedJson(req, null);
    if (isStatusProbe) {
      return json({
        ok: true,
        requestId,
        probe: "cavai_diagnostics",
        accepted: true,
      });
    }

    const session = await requireSession(req);
    requireAccountContext(session);

    const parsed = parseNormalizedScanInputV1(rawBody);
    if (!parsed.ok) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: parsed.error,
        },
        400
      );
    }

    const normalizedFindings = normalizeFindingsForInput(parsed.value.findings, parsed.value.origin);
    const withFavicon = await augmentFaviconFindings({
      input: {
        ...parsed.value,
        findings: normalizedFindings,
      },
    });
    const withStructuredData = await augmentStructuredDataFindings({
      input: {
        ...parsed.value,
        findings: withFavicon,
      },
    });
    const withAccessibility = await augmentAccessibilityPlusFindings({
      input: {
        ...parsed.value,
        findings: withStructuredData,
      },
    });
    const withReliability = await augmentReliability404Findings({
      input: {
        ...parsed.value,
        findings: withAccessibility,
      },
    });
    const withUxLayout = await augmentUxLayoutGuardFindings({
      input: {
        ...parsed.value,
        findings: withReliability,
      },
    });
    const withTrust = await augmentTrustPageFindings({
      input: {
        ...parsed.value,
        findings: withUxLayout,
      },
    });
    const withKeywords = await augmentKeywordFindings({
      input: {
        ...parsed.value,
        findings: withTrust,
      },
    });

    const input = {
      ...parsed.value,
      findings: withKeywords,
    };
    const inputHash = buildInputHash(input);
    const force = new URL(req.url).searchParams.get("force") === "1";

    if (!force) {
      const existing = await findIdempotentPack({
        accountId: session.accountId,
        origin: input.origin,
        inputHash,
      });
      if (existing) {
        await writeDiagnosticsAudit({
          req,
          accountId: session.accountId,
          userId: session.sub,
          runId: existing.runId,
          origin: input.origin,
          inputHash,
          idempotent: true,
        });
        return json({
          ok: true,
          requestId,
          idempotent: true,
          pack: existing,
        });
      }
    }

    const run = await createRunAndFindings({
      accountId: session.accountId,
      userId: session.sub,
      input,
      inputHash,
      engineVersion: ENGINE_VERSION,
    });

    const corePack = buildDeterministicCore(input, {
      engineVersion: ENGINE_VERSION,
      requestId,
      runId: run.runId,
      accountId: session.accountId,
      generatedAt: run.createdAtIso,
      inputHash,
    });

    const overlay = await computeOverlay({
      accountId: session.accountId,
      origin: input.origin,
    });
    const pack = applyOverlay(corePack, overlay);

    const validated = validateInsightPackV1(pack);
    if (!validated.ok) {
      if (process.env.NODE_ENV !== "production") {
        return json(
          {
            ok: false,
            requestId,
            error: "PACK_VALIDATION_FAILED",
            details: validated.errors,
          },
          422
        );
      }
      return json(
        {
          ok: false,
          requestId,
          error: "PACK_VALIDATION_FAILED",
        },
        500
      );
    }

    await persistInsightPack({
      accountId: session.accountId,
      runId: run.runId,
      pack,
    });

    await writeDiagnosticsAudit({
      req,
      accountId: session.accountId,
      userId: session.sub,
      runId: run.runId,
      origin: input.origin,
      inputHash,
      idempotent: false,
    });

    return json(
      {
        ok: true,
        requestId,
        idempotent: false,
        pack,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Server error";
    return json(
      {
        ok: false,
        requestId,
        error: "SERVER_ERROR",
        ...(process.env.NODE_ENV !== "production" ? { message } : {}),
      },
      500
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}
