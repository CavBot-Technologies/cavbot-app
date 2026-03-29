import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { jsonNoStore } from "@/lib/cavcloud/http.server";
import { revokeProjectCollaborator } from "@/lib/cavcloud/collab.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

export async function DELETE(req: Request, ctx: { params: { id?: string; userId?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const projectId = parseProjectId(ctx?.params?.id);
    const targetUserId = String(ctx?.params?.userId || "").trim();
    if (!projectId) {
      return jsonNoStore({ ok: false, error: "PROJECT_ID_REQUIRED", message: "project id is required." }, 400);
    }
    if (!targetUserId) {
      return jsonNoStore({ ok: false, error: "USER_ID_REQUIRED", message: "user id is required." }, 400);
    }

    await revokeProjectCollaborator({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      projectId,
      targetUserId,
    });

    return jsonNoStore({ ok: true }, 200);
  } catch (err) {
    return collabError(err, "Failed to revoke project collaborator.");
  }
}
