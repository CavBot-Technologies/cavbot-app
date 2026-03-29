import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { lookupShareableUsers } from "@/lib/cavcloud/userShares.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const query = String(new URL(req.url).searchParams.get("q") || "").trim();
    if (!query) return jsonNoStore({ ok: true, users: [] }, 200);

    const users = await lookupShareableUsers({
      accountId: String(sess.accountId || ""),
      operatorUserId: String(sess.sub || ""),
      query,
      limit: 8,
    });

    return jsonNoStore({ ok: true, users }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to lookup users.");
  }
}
