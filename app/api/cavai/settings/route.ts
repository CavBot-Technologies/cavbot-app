import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import type { PlanId } from "@/lib/plans";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import {
  DEFAULT_CAVEN_SETTINGS,
  getCavenSettings,
  parseCavenSettingsPatch,
  updateCavenSettings,
} from "@/lib/cavai/cavenSettings.server";
import {
  buildFallbackAgentRegistryUiSnapshot,
  getAgentRegistryUiSnapshot,
} from "@/lib/cavai/agentRegistry.server";
import {
  parseAdminAgentTelemetryPayload,
  syncAdminTrackedAgents,
} from "@/lib/admin/agentIntelligence.server";
import {
  listOwnedPublishedOperatorSourceAgentIds,
  listPublishedOperatorAgents,
} from "@/lib/cavai/operatorAgents.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadAgentRegistryResponse(args: {
  accountId: string;
  userId: string;
  planId?: PlanId;
  installedAgentIds: string[];
}) {
  let degraded = false;
  let agentRegistry = buildFallbackAgentRegistryUiSnapshot({
    planId: args.planId,
    installedAgentIds: args.installedAgentIds,
  });
  let publishedAgents: unknown[] = [];
  let ownedPublishedSourceAgentIds: string[] = [];

  const [agentRegistryResult, publishedAgentsResult, ownedPublishedSourceAgentIdsResult] = await Promise.allSettled([
    getAgentRegistryUiSnapshot({
      accountId: args.accountId,
      userId: args.userId,
      planId: args.planId,
      legacyInstalledAgentIds: args.installedAgentIds,
    }),
    listPublishedOperatorAgents({
      excludeUserId: args.userId,
      limit: 120,
    }),
    listOwnedPublishedOperatorSourceAgentIds({
      userId: args.userId,
      limit: 240,
    }),
  ]);

  if (agentRegistryResult.status === "fulfilled") {
    agentRegistry = agentRegistryResult.value;
  } else {
    degraded = true;
    console.error("[cavai/settings] getAgentRegistryUiSnapshot failed, using catalog fallback", agentRegistryResult.reason);
  }

  if (publishedAgentsResult.status === "fulfilled") {
    publishedAgents = publishedAgentsResult.value;
  } else {
    degraded = true;
    console.error("[cavai/settings] listPublishedOperatorAgents failed, using empty fallback", publishedAgentsResult.reason);
  }

  if (ownedPublishedSourceAgentIdsResult.status === "fulfilled") {
    ownedPublishedSourceAgentIds = ownedPublishedSourceAgentIdsResult.value;
  } else {
    degraded = true;
    console.error(
      "[cavai/settings] listOwnedPublishedOperatorSourceAgentIds failed, using empty fallback",
      ownedPublishedSourceAgentIdsResult.reason,
    );
  }

  return {
    degraded,
    agentRegistry,
    publishedAgents,
    ownedPublishedSourceAgentIds,
  };
}

export async function GET(req: Request) {
  try {
    const ctx = await requireAiRequestContext({
      req,
      surface: "cavcode",
    });
    let settings = { ...DEFAULT_CAVEN_SETTINGS };
    let degraded = false;
    try {
      settings = await getCavenSettings({
        accountId: String(ctx.accountId || ""),
        userId: String(ctx.userId || ""),
        planId: ctx.planId,
      });
    } catch (err) {
      degraded = true;
      console.error("[cavai/settings] getCavenSettings failed, using defaults", err);
    }

    const related = await loadAgentRegistryResponse({
      accountId: String(ctx.accountId || ""),
      userId: String(ctx.userId || ""),
      planId: ctx.planId,
      installedAgentIds: settings.installedAgentIds,
    });
    degraded = degraded || related.degraded;

    const baseResponse = {
      ok: true,
      settings,
      planId: ctx.planId,
      agentRegistry: related.agentRegistry,
      publishedAgents: related.publishedAgents,
      ownedPublishedSourceAgentIds: related.ownedPublishedSourceAgentIds,
    };
    return jsonNoStore(degraded ? { ...baseResponse, degraded: true } : baseResponse, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load Caven settings.");
  }
}

async function saveSettings(req: Request) {
  if (!hasRequestIntegrityHeader(req)) {
    return jsonNoStore(
      { ok: false, error: "BAD_CSRF", message: "Missing request integrity header." },
      403
    );
  }

  const ctx = await requireAiRequestContext({
    req,
    surface: "cavcode",
  });

  const body = await readSanitizedJson(req, null);
  const parsed = parseCavenSettingsPatch(body);
  if (!parsed.ok) {
    return jsonNoStore({ ok: false, error: "BAD_SETTINGS_PAYLOAD", message: parsed.error }, 400);
  }
  let degraded = false;
  const bodyRecord = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  const agentTelemetry = parseAdminAgentTelemetryPayload(bodyRecord.agentTelemetry);

  const settings = await updateCavenSettings({
    accountId: String(ctx.accountId || ""),
    userId: String(ctx.userId || ""),
    patch: parsed.patch,
    planId: ctx.planId,
  });
  if (parsed.patch.customAgents !== undefined) {
    try {
      await syncAdminTrackedAgents({
        accountId: String(ctx.accountId || ""),
        userId: String(ctx.userId || ""),
        agents: settings.customAgents,
        telemetry: agentTelemetry,
      });
    } catch (err) {
      degraded = true;
      console.error("[cavai/settings] syncAdminTrackedAgents failed after save, using best-effort fallback", err);
    }
  }

  const related = await loadAgentRegistryResponse({
    accountId: String(ctx.accountId || ""),
    userId: String(ctx.userId || ""),
    planId: ctx.planId,
    installedAgentIds: settings.installedAgentIds,
  });
  degraded = degraded || related.degraded;

  const baseResponse = {
    ok: true,
    settings,
    planId: ctx.planId,
    agentRegistry: related.agentRegistry,
    publishedAgents: related.publishedAgents,
    ownedPublishedSourceAgentIds: related.ownedPublishedSourceAgentIds,
  };
  return jsonNoStore(degraded ? { ...baseResponse, degraded: true } : baseResponse, 200);
}

export async function PATCH(req: Request) {
  try {
    return await saveSettings(req);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to update Caven settings.");
  }
}

export async function PUT(req: Request) {
  try {
    return await saveSettings(req);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to update Caven settings.");
  }
}
