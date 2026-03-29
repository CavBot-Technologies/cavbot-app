import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { notifyCavSafeMoveFailure, notifyCavSafeStorageThresholds } from "@/lib/cavsafe/notifications.server";
import { moveFromCavSafeToCavCloud } from "@/lib/cavsafe/move-to-cavcloud.server";
import { writeCavSafeOperationLog } from "@/lib/cavsafe/operationLog.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type MoveBody = {
  kind?: unknown;
  id?: unknown;
};

export async function POST(req: Request) {
  let accountId = "";
  let userId = "";
  try {
    const sess = await requireCavsafeOwnerSession(req);
    accountId = String(sess.accountId || "");
    userId = String(sess.sub || "");
    const body = (await readSanitizedJson(req, null)) as MoveBody | null;
    if (!body) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const kind = String(body.kind || "").trim().toLowerCase();
    const id = String(body.id || "").trim();
    if ((kind !== "file" && kind !== "folder") || !id) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "kind and id are required." }, 400);
    }

    const result = await moveFromCavSafeToCavCloud({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      kind: kind as "file" | "folder",
      id,
    });
    await writeCavSafeOperationLog({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      kind: "MOVE_OUT",
      subjectType: kind as "file" | "folder",
      subjectId: id,
      label: `Move out of CavSafe (${kind})`,
      meta: {
        movedFiles: result.movedFiles,
        movedFolders: result.movedFolders,
      },
    });

    try {
      await notifyCavSafeStorageThresholds({
        accountId: String(sess.accountId || ""),
        userId: String(sess.sub || ""),
      });
    } catch {
      // Non-blocking notification write.
    }

    return jsonNoStore({ ok: true, result }, 200);
  } catch (err) {
    if (accountId && userId) {
      try {
        await notifyCavSafeMoveFailure({
          accountId,
          userId,
          direction: "out",
          context: "Move out of CavSafe",
          errorMessage: (err as Error)?.message || "Move failed.",
          href: "/cavsafe",
        });
      } catch {
        // Non-blocking notification write.
      }
    }
    return cavsafeErrorResponse(err, "Failed to move item back to CavCloud.");
  }
}
