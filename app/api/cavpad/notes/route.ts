import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { createCavPadNote, getCavPadBootstrap } from "@/lib/cavpad/server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateNoteBody = {
  noteId?: unknown;
  title?: unknown;
  textContent?: unknown;
  pinnedAtISO?: unknown;
  scope?: unknown;
  siteId?: unknown;
  directoryId?: unknown;
};

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const payload = await getCavPadBootstrap({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      includeContent: false,
    });

    return jsonNoStore({ ok: true, notes: payload.notes, trash: payload.trash }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to list CavPad notes.");
  }
}

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const body = (await readSanitizedJson(req, null)) as CreateNoteBody | null;
    if (!body || typeof body !== "object") {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const note = await createCavPadNote({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      noteId: String(body.noteId || "").trim() || undefined,
      title: String(body.title || "").trim() || "Untitled",
      textContent: String(body.textContent || ""),
      pinnedAtISO: body.pinnedAtISO == null ? undefined : String(body.pinnedAtISO || "").trim() || null,
      scope: String(body.scope || "workspace").trim().toLowerCase() === "site" ? "site" : "workspace",
      siteId: String(body.siteId || "").trim() || null,
      directoryId: String(body.directoryId || "").trim() || null,
    });

    return jsonNoStore({ ok: true, note }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to create CavPad note.");
  }
}
