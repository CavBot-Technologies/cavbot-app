import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import {
  getImageAssetById,
  registerUploadedDeviceAsset,
  resolveDataUrlForAsset,
  toImageAssetClientRecord,
} from "@/lib/cavai/imageStudio.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type UploadBody = {
  fileName?: unknown;
  mimeType?: unknown;
  bytes?: unknown;
  dataUrl?: unknown;
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

const MAX_DEVICE_UPLOAD_BYTES = 12_000_000;

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

    const body = (await readSanitizedJson(req, null)) as UploadBody | null;
    const fileName = s(body?.fileName) || `image-${Date.now()}.png`;
    const mimeType = s(body?.mimeType).toLowerCase() || "image/png";
    const dataUrl = s(body?.dataUrl);
    const bytes = toInt(body?.bytes);

    if (!mimeType.startsWith("image/")) {
      return jsonNoStore({ ok: false, error: "INVALID_MIME_TYPE", message: "Only image uploads are supported." }, 400);
    }
    if (!dataUrl.startsWith("data:image/")) {
      return jsonNoStore({ ok: false, error: "INVALID_IMAGE_DATA", message: "Device upload requires an image data URL." }, 400);
    }
    if (bytes <= 0 || bytes > MAX_DEVICE_UPLOAD_BYTES) {
      return jsonNoStore(
        {
          ok: false,
          error: "IMAGE_TOO_LARGE",
          message: `Image upload must be between 1 byte and ${MAX_DEVICE_UPLOAD_BYTES} bytes.`,
        },
        413
      );
    }

    const assetId = await registerUploadedDeviceAsset({
      accountId: ctx.accountId,
      userId: ctx.userId,
      fileName,
      mimeType,
      bytes,
      dataUrl,
    });

    const [asset, resolvedData] = await Promise.all([
      getImageAssetById({
        accountId: ctx.accountId,
        userId: ctx.userId,
        assetId,
      }),
      resolveDataUrlForAsset({
        accountId: ctx.accountId,
        userId: ctx.userId,
        assetId,
      }),
    ]);

    return jsonNoStore(
      {
        ok: true,
        assetId,
        asset: asset ? toImageAssetClientRecord(asset) : null,
        preview: resolvedData,
      },
      201
    );
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to upload device image.");
  }
}
