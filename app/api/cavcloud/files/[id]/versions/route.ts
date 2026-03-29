import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { listCavCloudFileVersions } from "@/lib/cavcloud/fileEdits.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "file id is required." }, 400);

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 50;
    const pageRaw = Number(url.searchParams.get("page"));
    const page = Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1;
    const offset = (page - 1) * limit;

    const versions = await listCavCloudFileVersions({
      accountId: sess.accountId,
      userId: sess.sub,
      fileId,
      limit: limit + 1,
      offset,
    });

    const hasMore = versions.length > limit;
    const pageVersions = hasMore ? versions.slice(0, limit) : versions;

    let canRestore = false;
    try {
      await assertCavCloudActionAllowed({
        accountId: sess.accountId,
        userId: sess.sub,
        action: "EDIT_FILE_CONTENT",
        resourceType: "FILE",
        resourceId: fileId,
        neededPermission: "EDIT",
        errorCode: "FILE_EDIT_DENIED",
      });
      canRestore = true;
    } catch {
      canRestore = false;
    }

    return jsonNoStore({
      ok: true,
      versions: pageVersions,
      page,
      limit,
      hasMore,
      canRestore,
    }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load file versions.");
  }
}
