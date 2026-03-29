import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { jsonNoStore } from "@/lib/cavcloud/http.server";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  listProjectCollaborators,
  upsertProjectCollaborator,
} from "@/lib/cavcloud/collab.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CollaboratorBody = {
  userId?: unknown;
  role?: unknown;
};

function parseProjectId(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function collabError(err: unknown, fallback: string) {
  const status = Number((err as { status?: unknown })?.status || 500);
  if (status === 401 || status === 403 || status === 404 || status === 429 || status === 400) {
    const code = String((err as { code?: unknown; message?: unknown })?.code || "ERROR");
    const message = String((err as { message?: unknown })?.message || code || fallback);
    return jsonNoStore({ ok: false, error: code, message }, status);
  }
  return jsonNoStore({ ok: false, error: "INTERNAL", message: fallback }, 500);
}

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const projectId = parseProjectId(ctx?.params?.id);
    if (!projectId) {
      return jsonNoStore({ ok: false, error: "PROJECT_ID_REQUIRED", message: "project id is required." }, 400);
    }

    const collaborators = await listProjectCollaborators({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      projectId,
    });

    return jsonNoStore({ ok: true, collaborators }, 200);
  } catch (err) {
    return collabError(err, "Failed to list project collaborators.");
  }
}

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const projectId = parseProjectId(ctx?.params?.id);
    if (!projectId) {
      return jsonNoStore({ ok: false, error: "PROJECT_ID_REQUIRED", message: "project id is required." }, 400);
    }

    const body = (await readSanitizedJson(req, null)) as CollaboratorBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const collaborator = await upsertProjectCollaborator({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      projectId,
      targetUserId: String(body.userId || "").trim(),
      role: body.role,
    });

    return jsonNoStore({ ok: true, collaborator }, 200);
  } catch (err) {
    return collabError(err, "Failed to update project collaborator.");
  }
}
