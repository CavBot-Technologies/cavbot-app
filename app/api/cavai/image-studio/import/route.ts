import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavcloudObjectStream } from "@/lib/cavcloud/r2.server";
import { getFileById as getCavCloudFileById } from "@/lib/cavcloud/storage.server";
import {
  getImageAssetById,
  registerImportedAsset,
  resolveDataUrlForAsset,
  toImageAssetClientRecord,
} from "@/lib/cavai/imageStudio.server";
import { getCavsafeObjectStream } from "@/lib/cavsafe/r2.server";
import { getFileById as getCavSafeFileById } from "@/lib/cavsafe/storage.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ImportBody = {
  source?: unknown;
  fileId?: unknown;
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function parseSource(value: unknown): "cavcloud" | "cavsafe" | null {
  const normalized = s(value).toLowerCase();
  if (normalized === "cavcloud") return "cavcloud";
  if (normalized === "cavsafe") return "cavsafe";
  return null;
}

async function webStreamToBuffer(stream: ReadableStream<Uint8Array> | null): Promise<Buffer | null> {
  if (!stream) return null;
  const response = new Response(stream);
  const arrayBuffer = await response.arrayBuffer();
  const out = Buffer.from(arrayBuffer);
  return out.length ? out : null;
}

const MAX_IMPORT_IMAGE_BYTES = 12_000_000;

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
    const body = (await readSanitizedJson(req, null)) as ImportBody | null;
    const source = parseSource(body?.source);
    const fileId = s(body?.fileId);
    if (!source) {
      return jsonNoStore({ ok: false, error: "INVALID_SOURCE", message: "Import source must be cavcloud or cavsafe." }, 400);
    }
    if (!fileId) {
      return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "fileId is required." }, 400);
    }
    if (source === "cavsafe" && ctx.planId !== "premium" && ctx.planId !== "premium_plus") {
      return jsonNoStore(
        {
          ok: false,
          error: "PLAN_UPGRADE_REQUIRED",
          message: "CavSafe import requires Premium or Premium+.",
        },
        403
      );
    }

    let fileName = "";
    let mimeType = "";
    let sourcePath = "";
    let stream: ReadableStream<Uint8Array> | null = null;

    if (source === "cavcloud") {
      const file = await getCavCloudFileById({
        accountId: ctx.accountId,
        fileId,
      });
      fileName = s(file.name);
      mimeType = s(file.mimeType).toLowerCase() || "application/octet-stream";
      sourcePath = s(file.path);
      const object = await getCavcloudObjectStream({ objectKey: file.r2Key });
      stream = object?.body || null;
    } else {
      const file = await getCavSafeFileById({
        accountId: ctx.accountId,
        fileId,
        enforceReadTimelock: true,
      });
      fileName = s(file.name);
      mimeType = s(file.mimeType).toLowerCase() || "application/octet-stream";
      sourcePath = s(file.path);
      const object = await getCavsafeObjectStream({ objectKey: file.r2Key });
      stream = object?.body || null;
    }

    if (!mimeType.startsWith("image/")) {
      return jsonNoStore(
        {
          ok: false,
          error: "INVALID_MIME_TYPE",
          message: "Only image files can be imported into Image Studio.",
        },
        400
      );
    }

    const buffer = await webStreamToBuffer(stream);
    if (!buffer?.length) {
      return jsonNoStore(
        {
          ok: false,
          error: "SOURCE_READ_FAILED",
          message: "Unable to read source image bytes.",
        },
        404
      );
    }
    if (buffer.length > MAX_IMPORT_IMAGE_BYTES) {
      return jsonNoStore(
        {
          ok: false,
          error: "IMAGE_TOO_LARGE",
          message: `Imported image exceeds ${MAX_IMPORT_IMAGE_BYTES} bytes.`,
        },
        413
      );
    }

    const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
    const assetId = await registerImportedAsset({
      accountId: ctx.accountId,
      userId: ctx.userId,
      source,
      sourceId: fileId,
      sourcePath,
      fileName: fileName || `${source}-image-${Date.now()}.png`,
      mimeType,
      dataUrl,
      bytes: buffer.length,
    });

    const [asset, preview] = await Promise.all([
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
        source,
        assetId,
        asset: asset ? toImageAssetClientRecord(asset) : null,
        preview,
      },
      201
    );
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to import image.");
  }
}
