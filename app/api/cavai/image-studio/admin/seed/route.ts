import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import {
  ensureImageStudioPresetSeedData,
  listImagePresetsForPlan,
  toImageStudioPlanTier,
} from "@/lib/cavai/imageStudio.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return jsonNoStore(
        {
          ok: false,
          error: "BAD_CSRF",
          message: "Missing request integrity header.",
        },
        403
      );
    }
    const ctx = await requireAiRequestContext({
      req,
      surface: "console",
    });
    if (ctx.memberRole !== "OWNER") {
      return jsonNoStore({ ok: false, error: "FORBIDDEN", message: "Only workspace owners can seed presets." }, 403);
    }

    await ensureImageStudioPresetSeedData();
    const presets = await listImagePresetsForPlan({
      planTier: toImageStudioPlanTier(ctx.planId),
      includeLocked: true,
    });

    return jsonNoStore(
      {
        ok: true,
        seeded: true,
        count: presets.length,
        presets,
      },
      200
    );
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to seed image presets.");
  }
}
