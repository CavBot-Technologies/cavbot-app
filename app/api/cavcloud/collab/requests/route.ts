import { requireAccountContext, requireSession, requireUser, getSession } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  createCollabAccessRequest,
  listCollabAccessRequests,
} from "@/lib/cavcloud/collab.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateRequestBody = {
  resourceType?: unknown;
  resourceId?: unknown;
  requestedPermission?: unknown;
  message?: unknown;
};

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const url = new URL(req.url);
    const status = url.searchParams.get("status");

    const requests = await listCollabAccessRequests({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      status,
    });

    return jsonNoStore({ ok: true, requests }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to list collaboration requests.");
  }
}

export async function POST(req: Request) {
  try {
    const sess = await getSession(req);
    if (!sess || sess.systemRole !== "user" || !String(sess.sub || "").trim()) {
      return jsonNoStore({ ok: false, error: "UNAUTHORIZED", message: "Unauthorized" }, 401);
    }

    const body = (await readSanitizedJson(req, null)) as CreateRequestBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const requestRecord = await createCollabAccessRequest({
      requesterUserId: sess.sub,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      requestedPermission: body.requestedPermission,
      message: body.message,
    });

    return jsonNoStore({ ok: true, request: requestRecord }, 200);
  } catch (err) {
    if (String((err as { code?: unknown })?.code || "").toUpperCase() === "NOT_FOUND") {
      // Fail closed without confirming whether a resource exists outside caller scope.
      return jsonNoStore({
        ok: true,
        request: {
          id: null,
          status: "PENDING",
          createdAtISO: new Date().toISOString(),
          deduped: false,
        },
      }, 200);
    }
    return cavcloudErrorResponse(err, "Failed to create collaboration request.");
  }
}
