import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudStorageThresholds, notifyCavCloudUploadFailure } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { getCavCloudSettings } from "@/lib/cavcloud/settings.server";
import { completeMultipartSession } from "@/lib/cavcloud/storage.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CompleteUploadBody = {
  sha256?: unknown;
};

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
    const settings = await getCavCloudSettings({
      accountId,
      userId,
    });

    const uploadId = String(ctx?.params?.id || "").trim();
    uploadIdForError = uploadId;
    if (!uploadId) return jsonNoStore({ ok: false, error: "UPLOAD_ID_REQUIRED", message: "Upload id is required." }, 400);

    const body = (await readSanitizedJson(req, null)) as CompleteUploadBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const sha256 = String(body.sha256 || "").trim().toLowerCase();
    if (!sha256) return jsonNoStore({ ok: false, error: "SHA256_REQUIRED", message: "sha256 is required to complete multipart upload." }, 400);

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "UPLOAD_FILE",
      errorCode: "UNAUTHORIZED",
    });

    const file = await completeMultipartSession({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      uploadId,
      sha256,
      generateTextSnippets: settings.generateTextSnippets !== false,
    });

    try {
      await notifyCavCloudStorageThresholds({ accountId, userId });
    } catch {
      // Non-blocking notification write.
    }

    return jsonNoStore({ ok: true, file }, 200);
  } catch (err) {
    if (accountId && userId) {
      try {
        await notifyCavCloudUploadFailure({
          accountId,
          userId,
          fileName: uploadIdForError || null,
          context: "Multipart upload complete",
          errorMessage: (err as { message?: unknown })?.message ? String((err as { message?: unknown }).message) : null,
          href: "/cavcloud",
        });
      } catch {
        // Non-blocking.
      }
    }
    return cavcloudErrorResponse(err, "Failed to complete multipart upload.");
  }
}
