import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { notifyCavSafeStorageThresholds, notifyCavSafeUploadFailure } from "@/lib/cavsafe/notifications.server";
import { getCavSafeSettings } from "@/lib/cavsafe/settings.server";
import { completeMultipartSession } from "@/lib/cavsafe/storage.server";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CompleteUploadBody = {
  sha256?: unknown;
};

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  let accountId = "";
  let userId = "";
  let uploadIdForError = "";
  try {
    const sess = await requireCavsafeOwnerSession(req);
    accountId = String(sess.accountId || "");
    userId = String(sess.sub || "");

    const uploadId = String(ctx?.params?.id || "").trim();
    uploadIdForError = uploadId;
    if (!uploadId) return jsonNoStore({ ok: false, error: "UPLOAD_ID_REQUIRED", message: "Upload id is required." }, 400);

    const body = (await readSanitizedJson(req, null)) as CompleteUploadBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const sha256 = String(body.sha256 || "").trim().toLowerCase();
    if (!sha256) return jsonNoStore({ ok: false, error: "SHA256_REQUIRED", message: "sha256 is required to complete multipart upload." }, 400);

    const file = await completeMultipartSession({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      uploadId,
      sha256,
    });

    const cavsafeSettings = await getCavSafeSettings({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      premiumPlus: sess.cavsafePremiumPlus,
    });
    const shouldDefaultLock = sess.cavsafePremiumPlus && cavsafeSettings.defaultIntegrityLockOnUpload;

    let filePayload = file;
    if (shouldDefaultLock) {
      const lockAt = new Date();
      try {
        const lockResult = await prisma.cavSafeFile.updateMany({
          where: {
            id: String(file.id || ""),
            accountId: String(sess.accountId || ""),
            deletedAt: null,
            immutableAt: null,
          },
          data: {
            immutableAt: lockAt,
          },
        });
        if (lockResult.count > 0) {
          filePayload = {
            ...file,
            immutableAtISO: lockAt.toISOString(),
          };
        }
      } catch {
        // Best-effort default lock application.
      }
    }

    try {
      await notifyCavSafeStorageThresholds({
        accountId: String(sess.accountId || ""),
        userId: String(sess.sub || ""),
      });
    } catch {
      // Non-blocking notification write.
    }

    return jsonNoStore({ ok: true, file: filePayload }, 200);
  } catch (err) {
    if (accountId && userId) {
      try {
        await notifyCavSafeUploadFailure({
          accountId,
          userId,
          fileName: uploadIdForError || undefined,
          context: "Complete multipart upload",
          errorMessage: (err as Error)?.message || "Multipart completion failed.",
          href: "/cavsafe",
        });
      } catch {
        // Non-blocking notification write.
      }
    }
    return cavsafeErrorResponse(err, "Failed to complete multipart upload.");
  }
}
