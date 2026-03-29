import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { restoreCavCloudFileVersion } from "@/lib/cavcloud/fileEdits.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RestoreBody = {
  baseSha256?: unknown;
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

export async function POST(req: Request, ctx: { params: { id?: string; versionId?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const fileId = String(ctx?.params?.id || "").trim();
    const versionId = String(ctx?.params?.versionId || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "file id is required." }, 400);
    if (!versionId) {
      return jsonNoStore({ ok: false, error: "VERSION_ID_REQUIRED", message: "version id is required." }, 400);
    }

    const payload = (await readSanitizedJson(req, null)) as RestoreBody | null;
    const ifMatchSha = parseIfMatchSha(req.headers.get("if-match"));
    const baseSha256 = ifMatchSha || parseIfMatchSha(payload?.baseSha256 == null ? null : String(payload.baseSha256));

    const file = await restoreCavCloudFileVersion({
      accountId: sess.accountId,
      userId: sess.sub,
      fileId,
      versionId,
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
    return cavcloudErrorResponse(err, "Failed to restore file version.");
  }
}
