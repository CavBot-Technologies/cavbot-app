import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { notifyCavSafeStorageThresholds } from "@/lib/cavsafe/notifications.server";
import { restoreTrashEntry } from "@/lib/cavsafe/storage.server";
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
  try {
    const sess = await requireCavsafeOwnerSession(req);

    const body = (await readSanitizedJson(req, null)) as RestoreBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const trashId = String(body.trashId || body.id || "").trim();
    if (!trashId) return jsonNoStore({ ok: false, error: "TRASH_ID_REQUIRED", message: "trashId is required." }, 400);

    const restored = await restoreTrashEntry({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      trashId,
    });

    try {
      await notifyCavSafeStorageThresholds({
        accountId: String(sess.accountId || ""),
        userId: String(sess.sub || ""),
      });
    } catch {
      // Non-blocking notification write.
    }

    return jsonNoStore({ ok: true, restored }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to restore trash item.");
  }
}
