import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
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
    return cavcloudErrorResponse(err, "Failed to load CavPad bootstrap.");
  }
}
