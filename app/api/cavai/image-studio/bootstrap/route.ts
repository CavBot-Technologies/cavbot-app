import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import {
  listImagePresetsForPlan,
  readImageHistory,
  toImageStudioPlanTier,
} from "@/lib/cavai/imageStudio.server";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function imageStudioCapabilities(planId: string) {
  return {
    imageStudio: planId === "premium" || planId === "premium_plus",
    imageEdit: planId === "premium_plus",
    cavSafe: planId === "premium" || planId === "premium_plus",
    maxVariants: planId === "premium_plus" ? 4 : 2,
  };
}

export async function GET(req: Request) {
  try {
    const ctx = await requireAiRequestContext({
      req,
      surface: "console",
    });
    const planTier = toImageStudioPlanTier(ctx.planId);

    try {
      const [presets, recent, saved, history] = await Promise.all([
        listImagePresetsForPlan({ planTier, includeLocked: planTier !== "free" }),
        readImageHistory({ accountId: ctx.accountId, userId: ctx.userId, view: "recent", limit: 24 }),
        readImageHistory({ accountId: ctx.accountId, userId: ctx.userId, view: "saved", limit: 24 }),
        readImageHistory({ accountId: ctx.accountId, userId: ctx.userId, view: "history", limit: 24 }),
      ]);

      return jsonNoStore(
        {
          ok: true,
          planId: ctx.planId,
          planTier,
          capabilities: imageStudioCapabilities(ctx.planId),
          presets,
          recent,
          saved,
          history,
        },
        200
      );
    } catch {
      const presets = await listImagePresetsForPlan({
        planTier,
        includeLocked: planTier !== "free",
      }).catch(() => []);

      return jsonNoStore(
        {
          ok: true,
          degraded: true,
          planId: ctx.planId,
          planTier,
          capabilities: imageStudioCapabilities(ctx.planId),
          presets,
          recent: [],
          saved: [],
          history: [],
        },
        200
      );
    }
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load Image Studio bootstrap.");
  }
}
