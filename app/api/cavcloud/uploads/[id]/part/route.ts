import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudUploadFailure } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { uploadMultipartSessionPart } from "@/lib/cavcloud/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  let accountId = "";
  let userId = "";
  let uploadIdForError = "";
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);
    accountId = String(sess.accountId || "").trim();
    userId = String(sess.sub || "").trim();

    const uploadId = String(ctx?.params?.id || "").trim();
    uploadIdForError = uploadId;
    if (!uploadId) return jsonNoStore({ ok: false, error: "UPLOAD_ID_REQUIRED", message: "Upload id is required." }, 400);

    const url = new URL(req.url);
    const partNumberRaw = String(url.searchParams.get("partNumber") || req.headers.get("x-cavcloud-part-number") || "").trim();
    const partNumber = Number(partNumberRaw);
    if (!Number.isFinite(partNumber) || !Number.isInteger(partNumber) || partNumber <= 0) {
      return jsonNoStore({ ok: false, error: "PART_NUMBER_REQUIRED", message: "partNumber query param is required." }, 400);
    }

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "UPLOAD_FILE",
      errorCode: "UNAUTHORIZED",
    });

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
        await notifyCavCloudUploadFailure({
          accountId,
          userId,
          fileName: uploadIdForError || null,
          context: "Multipart upload part",
          errorMessage: (err as { message?: unknown })?.message ? String((err as { message?: unknown }).message) : null,
          href: "/cavcloud",
        });
      } catch {
        // Non-blocking.
      }
    }
    return cavcloudErrorResponse(err, "Failed to upload multipart part.");
  }
}
