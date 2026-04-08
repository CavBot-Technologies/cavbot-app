import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, isCavCloudServiceUnavailableError, jsonNoStore, withCavCloudDeadline } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { createFolder } from "@/lib/cavcloud/storage.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const FOLDER_PERMISSION_TIMEOUT_MS = 4_000;
const FOLDER_CREATE_TIMEOUT_MS = 8_000;

type CreateFolderBody = {
  name?: unknown;
  parentId?: unknown;
  parentPath?: unknown;
};

function isCavCloudFolderWriteSchemaMismatch(err: unknown) {
  return isSchemaMismatchError(err, {
    tables: ["CavCloudFolder", "CavCloudFile", "CavCloudActivity"],
    columns: [
      "accountId",
      "parentId",
      "name",
      "path",
      "deletedAt",
      "folderId",
      "relPath",
      "action",
      "targetType",
      "targetId",
      "targetPath",
      "metaJson",
    ],
  });
}

function statusFromUnknown(err: unknown) {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number" && Number.isFinite(status) && status >= 100 && status <= 599) return status;
  return 500;
}

function isRetriableFolderWriteFailure(err: unknown) {
  if (isCavCloudFolderWriteSchemaMismatch(err) || isCavCloudServiceUnavailableError(err)) return true;
  return statusFromUnknown(err) >= 500;
}

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const body = (await readSanitizedJson(req, null)) as CreateFolderBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    await withCavCloudDeadline(
      assertCavCloudActionAllowed({
        accountId: sess.accountId,
        userId: sess.sub,
        action: "CREATE_FOLDER",
        errorCode: "UNAUTHORIZED",
      }),
      { timeoutMs: FOLDER_PERMISSION_TIMEOUT_MS, message: "Timed out authorizing CavCloud folder creation." },
    );

    const folder = await withCavCloudDeadline(
      createFolder({
        accountId: sess.accountId,
        operatorUserId: sess.sub,
        name: String(body.name || "").trim(),
        parentId: body.parentId == null ? null : String(body.parentId || "").trim() || null,
        parentPath: body.parentPath == null ? null : String(body.parentPath || "").trim() || null,
      }),
      { timeoutMs: FOLDER_CREATE_TIMEOUT_MS, message: "Timed out creating CavCloud folder." },
    );

    return jsonNoStore({ ok: true, folder }, 200);
  } catch (err) {
    if (isRetriableFolderWriteFailure(err)) {
      return jsonNoStore(
        { ok: false, error: "SERVICE_UNAVAILABLE", message: "CavCloud is temporarily unavailable." },
        503,
      );
    }
    return cavcloudErrorResponse(err, "Failed to create folder.");
  }
}
