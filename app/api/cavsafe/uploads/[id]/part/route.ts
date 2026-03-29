import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { notifyCavSafeUploadFailure } from "@/lib/cavsafe/notifications.server";
import { uploadMultipartSessionPart } from "@/lib/cavsafe/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  let accountId = "";
  let userId = "";
  let uploadIdForError = "";
  try {
    const sess = await requireCavsafeOwnerSession(req);
    accountId = String(sess.accountId || "");
    userId = String(sess.sub || "");

    const uploadId = String(ctx?.params?.id || "").trim();
    uploadIdForError = uploadId;
    if (!uploadId) return jsonNoStore({ ok: false, error: "UPLOAD_ID_REQUIRED", message: "Upload id is required." }, 400);

    const url = new URL(req.url);
    const partNumberRaw = String(url.searchParams.get("partNumber") || req.headers.get("x-cavcloud-part-number") || "").trim();
    const partNumber = Number(partNumberRaw);
    if (!Number.isFinite(partNumber) || !Number.isInteger(partNumber) || partNumber <= 0) {
      return jsonNoStore({ ok: false, error: "PART_NUMBER_REQUIRED", message: "partNumber query param is required." }, 400);
    }

    const bodyBuffer = Buffer.from(await req.arrayBuffer());

    const part = await uploadMultipartSessionPart({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      uploadId,
      partNumber,
      body: bodyBuffer,
    });

    return jsonNoStore({ ok: true, part }, 200);
  } catch (err) {
    if (accountId && userId) {
      try {
        await notifyCavSafeUploadFailure({
          accountId,
          userId,
          fileName: uploadIdForError || undefined,
          context: "Upload multipart part",
          errorMessage: (err as Error)?.message || "Multipart part upload failed.",
          href: "/cavsafe",
        });
      } catch {
        // Non-blocking notification write.
      }
    }
    return cavsafeErrorResponse(err, "Failed to upload multipart part.");
  }
}
