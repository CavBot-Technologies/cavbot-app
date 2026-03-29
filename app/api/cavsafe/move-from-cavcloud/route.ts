import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { moveFromCavCloudToCavSafe } from "@/lib/cavsafe/move-from-cavcloud.server";
import { writeCavSafeOperationLog } from "@/lib/cavsafe/operationLog.server";
import { isApiAuthError } from "@/lib/apiAuth";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type MoveBody = {
  kind?: unknown;
  id?: unknown;
};

export async function POST(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);
    const body = (await readSanitizedJson(req, null)) as MoveBody | null;
    if (!body) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const kind = String(body.kind || "").trim().toLowerCase();
    const id = String(body.id || "").trim();
    if ((kind !== "file" && kind !== "folder") || !id) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "kind and id are required." }, 400);
    }

    const result = await moveFromCavCloudToCavSafe({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      kind: kind as "file" | "folder",
      id,
    });
    await writeCavSafeOperationLog({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      kind: "MOVE_IN",
      subjectType: kind as "file" | "folder",
      subjectId: id,
      label: `Move into CavSafe (${kind})`,
      meta: {
        movedFiles: result.movedFiles,
        movedFolders: result.movedFolders,
      },
    });

    return jsonNoStore({ ok: true, result }, 200);
  } catch (err) {
    if (isApiAuthError(err) && err.status === 403 && String(err.code || "").toUpperCase() === "PLAN_REQUIRED") {
      const guardPayload = buildGuardDecisionPayload({
        actionId: "MOVE_TO_CAVSAFE_PLAN_REQUIRED",
      });
      return jsonNoStore(
        {
          ok: false,
          error: err.code,
          message: "Moving items into CavSafe requires Premium+.",
          ...(guardPayload || {}),
        },
        403,
      );
    }
    return cavsafeErrorResponse(err, "Failed to move item to CavSafe.");
  }
}
