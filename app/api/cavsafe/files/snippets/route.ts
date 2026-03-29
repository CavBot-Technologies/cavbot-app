import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { getOrCreateFilePreviewSnippets } from "@/lib/cavsafe/storage.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SnippetRequestBody = {
  fileIds?: unknown;
};

export async function POST(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);
    const body = (await readSanitizedJson(req, null)) as SnippetRequestBody | null;
    const fileIds = Array.isArray(body?.fileIds) ? body?.fileIds : [];

    const snippets = await getOrCreateFilePreviewSnippets({
      accountId: sess.accountId,
      fileIds: fileIds.map((id) => String(id || "").trim()).filter(Boolean),
    });

    return jsonNoStore({ ok: true, snippets }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to load file snippets.");
  }
}
