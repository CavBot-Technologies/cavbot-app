import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudStorageThresholds } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { restoreTrashEntry } from "@/lib/cavcloud/storage.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RestoreBody = {
  trashId?: unknown;
  id?: unknown;
  kind?: unknown;
};

export async function POST(req: Request) {
  let accountId = "";
  let userId = "";
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);
    accountId = String(sess.accountId || "").trim();
    userId = String(sess.sub || "").trim();

    const body = (await readSanitizedJson(req, null)) as RestoreBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const trashId = String(body.trashId || body.id || "").trim();
    if (!trashId) return jsonNoStore({ ok: false, error: "TRASH_ID_REQUIRED", message: "trashId is required." }, 400);

    const trashEntry = await prisma.cavCloudTrash.findFirst({
      where: {
        id: trashId,
        accountId: sess.accountId,
      },
      select: {
        fileId: true,
        folderId: true,
      },
    });
    if (!trashEntry) {
      return jsonNoStore({ ok: false, error: "NOT_FOUND", message: "Trash item not found." }, 404);
    }

    if (trashEntry.fileId) {
      await assertCavCloudActionAllowed({
        accountId: sess.accountId,
        userId: sess.sub,
        action: "RESTORE_FROM_TRASH",
        resourceType: "FILE",
        resourceId: trashEntry.fileId,
        neededPermission: "EDIT",
        errorCode: "UNAUTHORIZED",
      });
    } else if (trashEntry.folderId) {
      await assertCavCloudActionAllowed({
        accountId: sess.accountId,
        userId: sess.sub,
        action: "RESTORE_FROM_TRASH",
        resourceType: "FOLDER",
        resourceId: trashEntry.folderId,
        neededPermission: "EDIT",
        errorCode: "UNAUTHORIZED",
      });
    } else {
      return jsonNoStore({ ok: false, error: "NOT_FOUND", message: "Trash item not found." }, 404);
    }

    const restored = await restoreTrashEntry({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      trashId,
    });

    if (accountId && userId) {
      try {
        await notifyCavCloudStorageThresholds({ accountId, userId });
      } catch {
        // Non-blocking notification write.
      }
    }

    return jsonNoStore({ ok: true, restored }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to restore trash item.");
  }
}
