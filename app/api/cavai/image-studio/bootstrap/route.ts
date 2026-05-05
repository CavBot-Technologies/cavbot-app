import { jsonNoStore, withCavCloudDeadline } from "@/lib/cavcloud/http.server";
import {
  listImagePresetsForPlan,
  readImageHistory,
  toImageStudioPlanTier,
} from "@/lib/cavai/imageStudio.server";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import {
  buildPassiveAiAuthRequiredPayload,
  isPassiveAiAuthRequiredError,
  readPassiveAiAuthErrorCode,
} from "@/src/lib/ai/ai.route-response";

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
    const ctx = await withCavCloudDeadline(
      requireAiRequestContext({
        req,
        surface: "console",
      }),
      {
        timeoutMs: 1_800,
        message: "Image Studio auth lookup timed out.",
      },
    );
    const planTier = toImageStudioPlanTier(ctx.planId);

    try {
      const [presets, recent, saved, history] = await Promise.all([
        withCavCloudDeadline(listImagePresetsForPlan({ planTier, includeLocked: planTier !== "free" }), {
          timeoutMs: 1_000,
          message: "Image presets read timed out.",
        }),
        withCavCloudDeadline(readImageHistory({ accountId: ctx.accountId, userId: ctx.userId, view: "recent", limit: 24 }), {
          timeoutMs: 1_500,
          message: "Recent image history timed out.",
        }),
        withCavCloudDeadline(readImageHistory({ accountId: ctx.accountId, userId: ctx.userId, view: "saved", limit: 24 }), {
          timeoutMs: 1_500,
          message: "Saved image history timed out.",
        }),
        withCavCloudDeadline(readImageHistory({ accountId: ctx.accountId, userId: ctx.userId, view: "history", limit: 24 }), {
          timeoutMs: 1_500,
          message: "Image history timed out.",
        }),
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
    if (isPassiveAiAuthRequiredError(err)) {
      return jsonNoStore(buildPassiveAiAuthRequiredPayload(readPassiveAiAuthErrorCode(err)), 200);
    }
    const planTier = "free";
    return jsonNoStore(
      {
        ok: true,
        degraded: true,
        planId: "free",
        planTier,
        capabilities: imageStudioCapabilities("free"),
        presets: [],
        recent: [],
        saved: [],
        history: [],
      },
      200,
    );
  }
}
