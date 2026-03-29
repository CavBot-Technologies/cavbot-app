import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { notifyCavSafeUploadFailure } from "@/lib/cavsafe/notifications.server";
import { createMultipartSession } from "@/lib/cavsafe/storage.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateUploadBody = {
  folderId?: unknown;
  folderPath?: unknown;
  name?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  expectedBytes?: unknown;
  partSizeBytes?: unknown;
};

export async function POST(req: Request) {
  let accountId = "";
  let userId = "";
  let fileName = "";
  try {
    const sess = await requireCavsafeOwnerSession(req);
    accountId = String(sess.accountId || "");
    userId = String(sess.sub || "");

    const body = (await readSanitizedJson(req, null)) as CreateUploadBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    fileName = String(body.fileName || body.name || "").trim();
    if (!fileName) return jsonNoStore({ ok: false, error: "NAME_REQUIRED", message: "name is required." }, 400);

    const upload = await createMultipartSession({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId: body.folderId == null ? null : String(body.folderId || "").trim() || null,
      folderPath: body.folderPath == null ? null : String(body.folderPath || "").trim() || null,
      fileName,
      mimeType: body.mimeType == null ? null : String(body.mimeType || "").trim() || null,
      expectedBytes: body.expectedBytes == null ? null : Number(body.expectedBytes),
      partSizeBytes: body.partSizeBytes == null ? null : Number(body.partSizeBytes),
    });

    return jsonNoStore({ ok: true, upload }, 200);
  } catch (err) {
    if (accountId && userId) {
      try {
        await notifyCavSafeUploadFailure({
          accountId,
          userId,
          fileName: fileName || undefined,
          context: "Create multipart upload session",
          errorMessage: (err as Error)?.message || "Upload session creation failed.",
          href: "/cavsafe",
        });
      } catch {
        // Non-blocking notification write.
      }
    }
    return cavsafeErrorResponse(err, "Failed to create multipart upload session.");
  }
}
