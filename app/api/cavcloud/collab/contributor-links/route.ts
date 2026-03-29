import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { createContributorLink } from "@/lib/cavcloud/collab.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateLinkBody = {
  resourceType?: unknown;
  resourceId?: unknown;
  expiresInDays?: unknown;
};

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const body = (await readSanitizedJson(req, null)) as CreateLinkBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const link = await createContributorLink({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      expiresInDays: body.expiresInDays,
    });

    const appOrigin = (() => {
      const envOrigin = String(process.env.CAVBOT_APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "").trim();
      if (envOrigin) {
        try {
          return new URL(envOrigin).origin;
        } catch {
          // continue
        }
      }
      try {
        return new URL(req.url).origin;
      } catch {
        return "";
      }
    })();

    const url = appOrigin
      ? `${appOrigin}/cavcloud?contributorToken=${encodeURIComponent(link.token)}`
      : `/cavcloud?contributorToken=${encodeURIComponent(link.token)}`;

    return jsonNoStore({
      ok: true,
      link: {
        id: link.id,
        token: link.token,
        expiresAtISO: link.expiresAtISO,
        url,
      },
    }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to create contributor link.");
  }
}
