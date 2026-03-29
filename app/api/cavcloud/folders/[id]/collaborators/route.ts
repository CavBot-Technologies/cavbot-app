import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { listFolderCollaborators, upsertFolderCollaborator } from "@/lib/cavcloud/collab.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CollaboratorBody = {
  userId?: unknown;
  role?: unknown;
  expiresAt?: unknown;
};

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const folderId = String(ctx?.params?.id || "").trim();
    if (!folderId) {
      return jsonNoStore({ ok: false, error: "FOLDER_ID_REQUIRED", message: "folder id is required." }, 400);
    }

    const collaborators = await listFolderCollaborators({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId,
    });

    return jsonNoStore({ ok: true, collaborators }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to list folder collaborators.");
  }
}

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const folderId = String(ctx?.params?.id || "").trim();
    if (!folderId) {
      return jsonNoStore({ ok: false, error: "FOLDER_ID_REQUIRED", message: "folder id is required." }, 400);
    }

    const body = (await readSanitizedJson(req, null)) as CollaboratorBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const collaborator = await upsertFolderCollaborator({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId,
      targetUserId: String(body.userId || "").trim(),
      role: body.role,
      expiresAt: body.expiresAt,
    });

    return jsonNoStore({ ok: true, collaborator }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to update folder collaborator.");
  }
}
