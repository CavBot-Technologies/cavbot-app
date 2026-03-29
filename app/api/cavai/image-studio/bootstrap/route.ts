import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavenSettings } from "@/lib/cavai/cavenSettings.server";
import {
  ensureImageStudioPresetSeedData,
  listImagePresetsForPlan,
  readImageHistory,
  syncAgentInstallState,
  toImageStudioPlanTier,
} from "@/lib/cavai/imageStudio.server";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const ctx = await requireAiRequestContext({
      req,
      surface: "console",
    });
    const planTier = toImageStudioPlanTier(ctx.planId);
    await ensureImageStudioPresetSeedData();

    const [presets, recent, saved, history] = await Promise.all([
      listImagePresetsForPlan({ planTier, includeLocked: planTier !== "free" }),
      readImageHistory({ accountId: ctx.accountId, userId: ctx.userId, view: "recent", limit: 24 }),
      readImageHistory({ accountId: ctx.accountId, userId: ctx.userId, view: "saved", limit: 24 }),
      readImageHistory({ accountId: ctx.accountId, userId: ctx.userId, view: "history", limit: 24 }),
    ]);

    try {
      const settings = await getCavenSettings({
        accountId: ctx.accountId,
        userId: ctx.userId,
        planId: ctx.planId,
      });
      await syncAgentInstallState({
        accountId: ctx.accountId,
        userId: ctx.userId,
        planTier,
        installedAgentIds: settings.installedAgentIds || [],
      });
    } catch {
      // Non-blocking: bootstrap should still load if agent mirror sync fails.
    }

    return jsonNoStore(
      {
        ok: true,
        planId: ctx.planId,
        planTier,
        capabilities: {
          imageStudio: ctx.planId === "premium" || ctx.planId === "premium_plus",
          imageEdit: ctx.planId === "premium_plus",
          cavSafe: ctx.planId === "premium" || ctx.planId === "premium_plus",
          maxVariants: ctx.planId === "premium_plus" ? 4 : 2,
        },
        presets,
        recent,
        saved,
        history,
      },
      200
    );
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load Image Studio bootstrap.");
  }
}
