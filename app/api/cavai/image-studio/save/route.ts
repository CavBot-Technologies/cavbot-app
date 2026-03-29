import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import {
  resolveDataUrlForAsset,
  saveImageAssetToTarget,
  toImageStudioPlanTier,
} from "@/lib/cavai/imageStudio.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SaveBody = {
  assetId?: unknown;
  target?: unknown;
  fileName?: unknown;
  folderPath?: unknown;
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function parseTarget(value: unknown): "cavcloud" | "cavsafe" | "device" | null {
  const normalized = s(value).toLowerCase();
  if (normalized === "cavcloud") return "cavcloud";
  if (normalized === "cavsafe") return "cavsafe";
  if (normalized === "device") return "device";
  return null;
}

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
    const body = (await readSanitizedJson(req, null)) as SaveBody | null;
    const assetId = s(body?.assetId);
    const target = parseTarget(body?.target);
    if (!assetId) {
      return jsonNoStore({ ok: false, error: "ASSET_ID_REQUIRED", message: "assetId is required." }, 400);
    }
    if (!target) {
      return jsonNoStore({ ok: false, error: "INVALID_TARGET", message: "target must be cavcloud, cavsafe, or device." }, 400);
    }

    if (target === "device") {
      const resolved = await resolveDataUrlForAsset({
        accountId: ctx.accountId,
        userId: ctx.userId,
        assetId,
      });
      if (!resolved) {
        return jsonNoStore({ ok: false, error: "ASSET_NOT_FOUND", message: "Image asset not found." }, 404);
      }
      return jsonNoStore(
        {
          ok: true,
          target: "device",
          assetId,
          download: {
            dataUrl: resolved.dataUrl,
            mimeType: resolved.mimeType,
            fileName: resolved.fileName,
          },
        },
        200
      );
    }

    const saved = await saveImageAssetToTarget({
      accountId: ctx.accountId,
      userId: ctx.userId,
      planTier: toImageStudioPlanTier(ctx.planId),
      assetId,
      target,
      fileName: s(body?.fileName) || null,
      folderPath: s(body?.folderPath) || null,
    });

    return jsonNoStore(
      {
        ok: true,
        target: saved.target,
        assetId: saved.assetId,
        file: {
          fileId: saved.fileId,
          filePath: saved.filePath,
          fileName: saved.fileName,
          mimeType: saved.mimeType,
        },
      },
      200
    );
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to save image.");
  }
}
