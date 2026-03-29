import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { createFileMetadata } from "@/lib/cavcloud/storage.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateFileMetadataBody = {
  folderId?: unknown;
  folderPath?: unknown;
  name?: unknown;
  mimeType?: unknown;
  bytes?: unknown;
  sha256?: unknown;
  r2Key?: unknown;
};

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const body = (await readSanitizedJson(req, null)) as CreateFileMetadataBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "UPLOAD_FILE",
      errorCode: "UNAUTHORIZED",
    });

    const file = await createFileMetadata({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId: body.folderId == null ? null : String(body.folderId || "").trim() || null,
      folderPath: body.folderPath == null ? null : String(body.folderPath || "").trim() || null,
      name: String(body.name || "").trim(),
      mimeType: body.mimeType == null ? null : String(body.mimeType || "").trim() || null,
      bytes: body.bytes == null ? null : Number(body.bytes),
      sha256: body.sha256 == null ? null : String(body.sha256 || "").trim() || null,
      r2Key: body.r2Key == null ? null : String(body.r2Key || "").trim() || null,
    });

    return jsonNoStore({
      ok: true,
      file,
      fileId: file.id,
      uploadUrl: `/api/cavcloud/files/upload?fileId=${encodeURIComponent(file.id)}`,
    }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to create file metadata.");
  }
}
