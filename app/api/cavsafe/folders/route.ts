import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { createFolder } from "@/lib/cavsafe/storage.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateFolderBody = {
  name?: unknown;
  parentId?: unknown;
  parentPath?: unknown;
};

export async function POST(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);

    const body = (await readSanitizedJson(req, null)) as CreateFolderBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const folder = await createFolder({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      name: String(body.name || "").trim(),
      parentId: body.parentId == null ? null : String(body.parentId || "").trim() || null,
      parentPath: body.parentPath == null ? null : String(body.parentPath || "").trim() || null,
    });

    return jsonNoStore({ ok: true, folder }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to create folder.");
  }
}
