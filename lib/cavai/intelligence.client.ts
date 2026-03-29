"use client";

import type {
  CavAiFixPlanV1,
  CavAiInsightPackV1,
  CavAiPriorityV1,
  NormalizedScanInputV1,
} from "@/packages/cavai-contracts/src";
import {
  buildCavCodeHref as buildCavCodeHrefPath,
  normalizePriorityOpenTargets,
  resolveOpenTargetDeterministic,
  type CavAiOpenTargetResolution,
  type CavAiPriorityOpenTarget,
  type CavAiTargetResolveContext,
} from "@/lib/cavai/openTargets";

export type CavAiDiagnosticsResult =
  | { ok: true; requestId: string; idempotent: boolean; pack: CavAiInsightPackV1 }
  | { ok: false; requestId: string; error: string; message?: string };

export type CavAiFixResult =
  | { ok: true; requestId: string; fixPlan: CavAiFixPlanV1 }
  | { ok: false; requestId: string; error: string; message?: string };

export type CavPadTemplate = {
  title: string;
  evidenceLinks: string[];
  checklist: string[];
  verification: string[];
  confidenceSummary: string;
  riskSummary: string;
};

export type CavAiIntelligenceClient = {
  diagnostics: (input: NormalizedScanInputV1, opts?: { force?: boolean }) => Promise<CavAiDiagnosticsResult>;
  fixPlan: (payload: { runId: string; priorityCode: string }) => Promise<CavAiFixResult>;
  priorityToCavPadNote: (pack: CavAiInsightPackV1, priorityCode: string) => CavPadTemplate | null;
  openTargetsForPriority: (priority: CavAiPriorityV1) => CavAiPriorityOpenTarget[];
  resolveOpenTarget: (payload: {
    targets: unknown;
    context?: CavAiTargetResolveContext;
  }) => Promise<CavAiOpenTargetResolution>;
  buildCavCodeHref: (filePath: string, currentSearch?: string) => string;
};

function resolveRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now().toString(36)}`;
  }
}

function mapPriorityToCavPadTemplate(pack: CavAiInsightPackV1, priority: CavAiPriorityV1): CavPadTemplate {
  const samplePages = priority.nextActions
    .flatMap((action) => action.openTargets)
    .filter((target) => target.type === "url")
    .map((target) => target.target)
    .filter(Boolean)
    .slice(0, 10)
    .map((target) => `page:${target}`);

  const evidenceLinks = priority.evidenceFindingIds
    .map((id) => `finding:${id}`)
    .concat(samplePages)
    .slice(0, 30);
  const checklist = priority.nextActions
    .map((action) => action.title)
    .filter(Boolean)
    .slice(0, 6);
  const verification = [
    "Run route-level checks for impacted pages and templates.",
    "Run lint/tests for impacted workspace targets.",
    "Rescan diagnostics and verify evidence IDs clear.",
  ];

  return {
    title: `CavBot priority note: ${priority.title}`,
    evidenceLinks,
    checklist: checklist.length ? checklist : ["Review evidence and apply mapped fix."],
    verification,
    confidenceSummary: `${priority.confidence.toUpperCase()} — ${priority.confidenceReason}`,
    riskSummary: `${pack.risk.level.toUpperCase()} — ${pack.risk.reason}`,
  };
}

export function createCavAiIntelligenceClient(): CavAiIntelligenceClient {
  return {
    async diagnostics(input, opts) {
      const requestId = resolveRequestId();
      const url = opts?.force ? "/api/cavai/diagnostics?force=1" : "/api/cavai/diagnostics";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(input),
      });
      const json = (await res.json().catch(() => ({}))) as CavAiDiagnosticsResult;
      if (!res.ok || !json || json.ok !== true) {
        return {
          ok: false,
          requestId,
          error: (json as { error?: string })?.error || "DIAGNOSTICS_FAILED",
          message: (json as { message?: string })?.message,
        };
      }
      return json;
    },

    async fixPlan(payload) {
      const requestId = resolveRequestId();
      const res = await fetch("/api/cavai/fixes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as CavAiFixResult;
      if (!res.ok || !json || json.ok !== true) {
        return {
          ok: false,
          requestId,
          error: (json as { error?: string })?.error || "FIX_PLAN_FAILED",
          message: (json as { message?: string })?.message,
        };
      }
      return json;
    },

    priorityToCavPadNote(pack, priorityCode) {
      const normalizedCode = String(priorityCode || "").trim().toLowerCase();
      if (!normalizedCode) return null;
      const priority = pack.priorities.find((item) => item.code === normalizedCode);
      if (!priority) return null;
      return mapPriorityToCavPadTemplate(pack, priority);
    },

    openTargetsForPriority(priority) {
      const rawTargets = priority.nextActions.flatMap((action) => action.openTargets);
      return normalizePriorityOpenTargets(rawTargets).slice(0, 24);
    },

    async resolveOpenTarget(payload) {
      return resolveOpenTargetDeterministic({
        targets: payload.targets,
        context: payload.context,
      });
    },

    buildCavCodeHref(filePath, currentSearch) {
      return buildCavCodeHrefPath(filePath, currentSearch);
    },
  };
}

declare global {
  interface Window {
    __cavbotIntelligenceClient__?: CavAiIntelligenceClient;
  }
}

export function getCavAiIntelligenceClient() {
  if (typeof window === "undefined") return createCavAiIntelligenceClient();
  if (!window.__cavbotIntelligenceClient__) {
    window.__cavbotIntelligenceClient__ = createCavAiIntelligenceClient();
  }
  return window.__cavbotIntelligenceClient__;
}
