import { requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { resolveContributorLink } from "@/lib/cavcloud/collab.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ResolveBody = {
  token?: unknown;
};

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);

    const body = (await readSanitizedJson(req, null)) as ResolveBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const resolved = await resolveContributorLink({
      operatorUserId: sess.sub,
      token: body.token,
    });

    return jsonNoStore({ ok: true, resolved }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to resolve contributor link.");
  }
}
