import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { createGoogleDriveImportSession } from "@/lib/integrations/googleDriveImport.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ImportSessionBody = {
  targetFolderId?: unknown;
  items?: Array<{ id?: unknown; type?: unknown }>;
  mode?: unknown;
};

export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireUser(session);

    const body = (await readSanitizedJson(req, null)) as ImportSessionBody | null;
    if (!body) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const targetFolderId = String(body.targetFolderId || "").trim();
    if (!targetFolderId) {
      return jsonNoStore({ ok: false, error: "TARGET_FOLDER_REQUIRED", message: "targetFolderId is required." }, 400);
    }

    const items = Array.isArray(body.items)
      ? body.items
        .map((item) => ({
          id: String(item?.id || "").trim(),
          type: String(item?.type || "").toLowerCase() === "folder" ? "folder" as const : "file" as const,
        }))
        .filter((item) => !!item.id)
      : [];

    if (!items.length) {
      return jsonNoStore({ ok: false, error: "ITEMS_REQUIRED", message: "items[] is required." }, 400);
    }

    const mode = String(body.mode || "copy").toLowerCase() === "copy" ? "copy" as const : null;
    if (!mode) {
      return jsonNoStore({ ok: false, error: "MODE_INVALID", message: "mode must be copy." }, 400);
    }

    await assertCavCloudActionAllowed({
      accountId: session.accountId,
      userId: session.sub,
      action: "UPLOAD_FILE",
      resourceType: "FOLDER",
      resourceId: targetFolderId,
      neededPermission: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    const created = await createGoogleDriveImportSession({
      accountId: session.accountId,
      userId: session.sub,
      targetFolderId,
      items,
      mode,
    });

    return jsonNoStore({
      ok: true,
      sessionId: created.sessionId,
    }, 200);
  } catch (error) {
    return cavcloudErrorResponse(error, "Failed to create Google Drive import session.");
  }
}
