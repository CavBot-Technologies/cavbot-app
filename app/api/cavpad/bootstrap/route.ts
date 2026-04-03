import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { getCavPadBootstrap } from "@/lib/cavpad/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const url = new URL(req.url);
    const includeContent = url.searchParams.get("includeContent") !== "0";

    const payload = await getCavPadBootstrap({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      includeContent,
    });

    return jsonNoStore({ ok: true, ...payload }, 200);
  } catch (err) {
    if (
      isSchemaMismatchError(err, {
        tables: [
          "CavPadDirectory",
          "CavPadDirectoryAccess",
          "CavPadNote",
          "CavPadNoteAccess",
          "CavPadNoteVersion",
          "CavPadSettings",
          "CavCloudFile",
        ],
        columns: ["syncToCavcloud", "syncToCavsafe", "textContent", "trashedAt"],
      })
    ) {
      return jsonNoStore(
        {
          ok: true,
          degraded: true,
          notes: [],
          trash: [],
          directories: [],
          settings: {
            syncToCavcloud: false,
            syncToCavsafe: false,
            allowSharing: true,
            defaultSharePermission: "VIEW",
            defaultShareExpiryDays: 0,
            noteExpiryDays: 0,
            trashRetentionDays: 30,
          },
        },
        200
      );
    }
    return cavcloudErrorResponse(err, "Failed to load CavPad bootstrap.");
  }
}
