import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { listCollabInbox } from "@/lib/cavcloud/userShares.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const filterRaw = String(new URL(req.url).searchParams.get("filter") || "").trim();
    const filter = filterRaw === "readonly" || filterRaw === "edit" || filterRaw === "expiringSoon"
      ? filterRaw
      : "all";

    const collab = await listCollabInbox({
      accountId: String(sess.accountId || ""),
      operatorUserId: String(sess.sub || ""),
      filter,
    });

    return jsonNoStore(
      {
        ok: true,
        filter,
        ...collab,
      },
      200,
    );
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load collaboration inbox.");
  }
}
