import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudStorageThresholds } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { zipFile } from "@/lib/cavcloud/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  let accountId = "";
  let userId = "";
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);
    accountId = String(sess.accountId || "").trim();
    userId = String(sess.sub || "").trim();

    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) {
      return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "File id is required." }, 400);
    }

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "RENAME_MOVE_FILE",
      resourceType: "FILE",
      resourceId: fileId,
      neededPermission: "VIEW",
      errorCode: "UNAUTHORIZED",
    });
    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "UPLOAD_FILE",
      errorCode: "UNAUTHORIZED",
    });

    const file = await zipFile({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      fileId,
    });

    if (accountId && userId) {
      try {
        await notifyCavCloudStorageThresholds({ accountId, userId });
      } catch {
        // Non-blocking notification write.
      }
    }

    return jsonNoStore({ ok: true, file }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to zip file.");
  }
}
