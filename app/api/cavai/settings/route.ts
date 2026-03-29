import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import {
  DEFAULT_CAVEN_SETTINGS,
  getCavenSettings,
  parseCavenSettingsPatch,
  updateCavenSettings,
} from "@/lib/cavai/cavenSettings.server";
import { getAgentRegistryUiSnapshot } from "@/lib/cavai/agentRegistry.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const ctx = await requireAiRequestContext({
      req,
      surface: "cavcode",
    });
    try {
      const settings = await getCavenSettings({
        accountId: String(ctx.accountId || ""),
        userId: String(ctx.userId || ""),
        planId: ctx.planId,
      });
      const agentRegistry = await getAgentRegistryUiSnapshot({
        accountId: String(ctx.accountId || ""),
        userId: String(ctx.userId || ""),
        planId: ctx.planId,
        legacyInstalledAgentIds: settings.installedAgentIds,
      });
      const baseResponse = { ok: true, settings, planId: ctx.planId };
      return jsonNoStore({ ...baseResponse, agentRegistry }, 200);
    } catch (err) {
      console.error("[cavai/settings] getCavenSettings failed, using defaults", err);
      return jsonNoStore({ ok: true, settings: { ...DEFAULT_CAVEN_SETTINGS }, planId: ctx.planId, degraded: true }, 200);
    }
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

  const settings = await updateCavenSettings({
    accountId: String(ctx.accountId || ""),
    userId: String(ctx.userId || ""),
    patch: parsed.patch,
    planId: ctx.planId,
  });

  const agentRegistry = await getAgentRegistryUiSnapshot({
    accountId: String(ctx.accountId || ""),
    userId: String(ctx.userId || ""),
    planId: ctx.planId,
    legacyInstalledAgentIds: settings.installedAgentIds,
  });

  const baseResponse = { ok: true, settings, planId: ctx.planId };
  return jsonNoStore({ ...baseResponse, agentRegistry }, 200);
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
