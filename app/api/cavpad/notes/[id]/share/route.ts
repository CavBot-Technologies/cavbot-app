import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { listCavPadNoteShares, shareCavPadNoteByIdentity } from "@/lib/cavpad/server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ShareBody = {
  identity?: unknown;
  permission?: unknown;
  expiresInDays?: unknown;
};

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const noteId = String(ctx?.params?.id || "").trim();
    if (!noteId) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "note id is required." }, 400);
    }

    const accessList = await listCavPadNoteShares({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      noteId,
    });

    return jsonNoStore({ ok: true, accessList }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load CavPad note shares.");
  }
}

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const noteId = String(ctx?.params?.id || "").trim();
    if (!noteId) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "note id is required." }, 400);
    }

    const body = (await readSanitizedJson(req, null)) as ShareBody | null;
    if (!body || typeof body !== "object") {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const identity = String(body.identity || "").trim();
    if (!identity) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "identity is required." }, 400);
    }

    const permission = String(body.permission || "VIEW").trim().toUpperCase() === "EDIT" ? "EDIT" : "VIEW";

    const shared = await shareCavPadNoteByIdentity({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      noteId,
      identity,
      permission,
      expiresInDays: body.expiresInDays,
    });

    if (!shared.ok) {
      return jsonNoStore(shared, 404);
    }

    return jsonNoStore(shared, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to share CavPad note.");
  }
}
