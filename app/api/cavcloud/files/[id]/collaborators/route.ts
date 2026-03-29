import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { listFileCollaborators, upsertFileCollaborator } from "@/lib/cavcloud/collab.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CollaboratorBody = {
  userId?: unknown;
  permission?: unknown;
  expiresAt?: unknown;
};

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "file id is required." }, 400);

    const collaborators = await listFileCollaborators({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      fileId,
    });

    return jsonNoStore({ ok: true, collaborators }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to list file collaborators.");
  }
}

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "file id is required." }, 400);

    const body = (await readSanitizedJson(req, null)) as CollaboratorBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const collaborator = await upsertFileCollaborator({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      fileId,
      targetUserId: String(body.userId || "").trim(),
      permission: body.permission,
      expiresAt: body.expiresAt,
    });

    return jsonNoStore({ ok: true, collaborator }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to update file collaborator.");
  }
}
