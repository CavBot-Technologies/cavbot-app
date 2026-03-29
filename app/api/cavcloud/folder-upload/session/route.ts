import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { createFolderUploadSession } from "@/lib/cavcloud/storage.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateFolderUploadSessionBody = {
  parentFolderId?: unknown;
  parentFolderPath?: unknown;
  rootName?: unknown;
  nameCollisionRule?: unknown;
};

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const body = (await readSanitizedJson(req, null)) as CreateFolderUploadSessionBody | null;
    if (!body) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const rootName = String(body.rootName || "").trim();
    if (!rootName) {
      return jsonNoStore({ ok: false, error: "ROOT_NAME_REQUIRED", message: "rootName is required." }, 400);
    }
    const nameCollisionRuleRaw = String(body.nameCollisionRule || "").trim();
    const nameCollisionRule =
      nameCollisionRuleRaw === "failAsk"
        ? "failAsk"
        : nameCollisionRuleRaw === "autoRename" || !nameCollisionRuleRaw
          ? "autoRename"
          : null;
    if (!nameCollisionRule) {
      return jsonNoStore(
        { ok: false, error: "NAME_COLLISION_RULE_INVALID", message: "nameCollisionRule must be autoRename or failAsk." },
        400,
      );
    }

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "UPLOAD_FILE",
      errorCode: "UNAUTHORIZED",
    });

    const session = await createFolderUploadSession({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      parentFolderId: body.parentFolderId == null ? null : String(body.parentFolderId || "").trim() || null,
      parentFolderPath: body.parentFolderPath == null ? null : String(body.parentFolderPath || "").trim() || null,
      rootName,
      nameCollisionRule,
    });

    return jsonNoStore({
      ok: true,
      sessionId: session.sessionId,
      rootFolderId: session.rootFolderId,
      requestedRootName: session.requestedRootName,
      resolvedRootName: session.resolvedRootName,
      status: session.status,
    }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to create folder upload session.");
  }
}
