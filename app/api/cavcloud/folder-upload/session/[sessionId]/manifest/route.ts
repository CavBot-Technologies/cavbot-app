import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { ingestFolderUploadManifest } from "@/lib/cavcloud/storage.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ManifestBody = {
  entries?: Array<{
    relPath?: unknown;
    bytes?: unknown;
    mimeTypeGuess?: unknown;
    lastModified?: unknown;
  }>;
};

export async function POST(req: Request, ctx: { params: { sessionId?: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const sessionId = String(ctx?.params?.sessionId || "").trim();
    if (!sessionId) {
      return jsonNoStore({ ok: false, error: "UPLOAD_SESSION_ID_REQUIRED", message: "sessionId is required." }, 400);
    }

    const body = (await readSanitizedJson(req, null)) as ManifestBody | null;
    if (!body || !Array.isArray(body.entries)) {
      return jsonNoStore({ ok: false, error: "MANIFEST_REQUIRED", message: "entries[] is required." }, 400);
    }

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "UPLOAD_FILE",
      errorCode: "UNAUTHORIZED",
    });

    const result = await ingestFolderUploadManifest({
      accountId: sess.accountId,
      sessionId,
      entries: body.entries.map((entry) => ({
        relPath: entry?.relPath,
        bytes: entry?.bytes,
        mimeTypeGuess: entry?.mimeTypeGuess,
        lastModified: entry?.lastModified,
      })),
    });

    return jsonNoStore({
      ok: true,
      createdFiles: result.createdFiles,
      discoveredFilesCount: result.discoveredFilesCount,
      createdFilesCount: result.createdFilesCount,
      finalizedFilesCount: result.finalizedFilesCount,
      failedFilesCount: result.failedFilesCount,
      status: result.status,
    }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to ingest folder upload manifest.");
  }
}
