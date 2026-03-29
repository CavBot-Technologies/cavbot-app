import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getEffectivePermission } from "@/lib/cavcloud/permissions.server";
import { getCavCloudSettings } from "@/lib/cavcloud/settings.server";
import { getOrCreateFilePreviewSnippets } from "@/lib/cavcloud/storage.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SnippetRequestBody = {
  fileIds?: unknown;
};

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const body = (await readSanitizedJson(req, null)) as SnippetRequestBody | null;
    const requestedFileIds = Array.isArray(body?.fileIds)
      ? body.fileIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    const settings = await getCavCloudSettings({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
    });

    const allowedFileIds: string[] = [];
    for (const fileId of requestedFileIds) {
      const permission = await getEffectivePermission({
        accountId: sess.accountId,
        userId: sess.sub,
        resourceType: "FILE",
        resourceId: fileId,
      });
      if (permission === "VIEW" || permission === "EDIT") {
        allowedFileIds.push(fileId);
      }
    }

    const snippets = await getOrCreateFilePreviewSnippets({
      accountId: sess.accountId,
      fileIds: allowedFileIds,
      allowGenerate: settings.generateTextSnippets !== false,
    });

    const output: Record<string, string | null> = {};
    for (const fileId of requestedFileIds) {
      output[fileId] = Object.prototype.hasOwnProperty.call(snippets, fileId) ? snippets[fileId] ?? null : null;
    }

    return jsonNoStore({ ok: true, snippets: output }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load file snippets.");
  }
}
