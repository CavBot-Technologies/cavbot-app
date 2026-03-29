import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import {
  getImageAssetById,
  resolveDataUrlForAsset,
  toImageAssetClientRecord,
} from "@/lib/cavai/imageStudio.server";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

export async function GET(req: Request, ctx: { params: { assetId?: string } }) {
  try {
    const auth = await requireAiRequestContext({
      req,
      surface: "console",
    });
    const assetId = s(ctx?.params?.assetId);
    if (!assetId) {
      return jsonNoStore({ ok: false, error: "ASSET_ID_REQUIRED", message: "assetId is required." }, 400);
    }
    const includeData = new URL(req.url).searchParams.get("data") !== "0";
    const asset = await getImageAssetById({
      accountId: auth.accountId,
      userId: auth.userId,
      assetId,
    });
    if (!asset) {
      return jsonNoStore({ ok: false, error: "ASSET_NOT_FOUND", message: "Image asset not found." }, 404);
    }
    const resolved = includeData
      ? await resolveDataUrlForAsset({
          accountId: auth.accountId,
          userId: auth.userId,
          assetId,
        })
      : null;
    return jsonNoStore(
      {
        ok: true,
        asset: toImageAssetClientRecord(asset),
        ...(resolved ? { data: resolved } : {}),
      },
      200
    );
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load image asset.");
  }
}
