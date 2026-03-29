import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { saveCavCloudFileContent } from "@/lib/cavcloud/fileEdits.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ContentBody = {
  content?: unknown;
  baseSha256?: unknown;
  mimeType?: unknown;
};

function parseIfMatchSha(raw: string | null): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const cleaned = value
    .replace(/^W\//i, "")
    .replace(/^\"+/, "")
    .replace(/\"+$/, "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleaned)) return null;
  return cleaned;
}

export async function PUT(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "file id is required." }, 400);

    const contentType = String(req.headers.get("content-type") || "").toLowerCase();
    const ifMatchSha = parseIfMatchSha(req.headers.get("if-match"));

    let mimeType = "application/octet-stream";
    let baseSha256: string | null = ifMatchSha || null;
    let body: Uint8Array;

    if (contentType.includes("application/json")) {
      const payload = (await readSanitizedJson(req, null)) as ContentBody | null;
      if (!payload) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
      const content = payload.content;
      if (typeof content === "string") {
        body = new TextEncoder().encode(content);
        mimeType = String(payload.mimeType || "text/plain; charset=utf-8").trim() || "text/plain; charset=utf-8";
      } else {
        return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "content must be a string." }, 400);
      }
      if (!baseSha256) {
        const fromBody = parseIfMatchSha(String(payload.baseSha256 || "") || null);
        if (fromBody) baseSha256 = fromBody;
      }
    } else {
      body = new Uint8Array(await req.arrayBuffer());
      mimeType = String(req.headers.get("content-type") || "application/octet-stream").split(";")[0]?.trim() || "application/octet-stream";
    }

    const file = await saveCavCloudFileContent({
      accountId: sess.accountId,
      userId: sess.sub,
      fileId,
      mimeType,
      body,
      baseSha256,
    });

    return jsonNoStore({ ok: true, file }, 200);
  } catch (err) {
    if ((err as { code?: unknown })?.code === "FILE_EDIT_CONFLICT") {
      const conflict = err as { latestSha256?: unknown; latestVersionNumber?: unknown; message?: unknown };
      return jsonNoStore({
        ok: false,
        error: "FILE_EDIT_CONFLICT",
        message: String(conflict.message || "File changed since your last read."),
        latest: {
          sha256: String(conflict.latestSha256 || "") || null,
          versionNumber: Number(conflict.latestVersionNumber || 0) || null,
        },
      }, 409);
    }
    return cavcloudErrorResponse(err, "Failed to save file content.");
  }
}
