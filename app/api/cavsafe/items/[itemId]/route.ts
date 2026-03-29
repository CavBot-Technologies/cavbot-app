import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { listItemAccessAndPending } from "@/lib/cavsafe/privateShare.server";
import { requireUserSession } from "@/lib/security/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

export async function GET(req: Request, ctx: { params: { itemId?: string } }) {
  try {
    const sess = await requireUserSession(req);
    const itemId = s(ctx?.params?.itemId);
    if (!itemId) {
      return jsonNoStore({ ok: false, error: "ITEM_ID_REQUIRED", message: "itemId is required." }, 400);
    }

    const details = await listItemAccessAndPending({
      accountId: sess.accountId,
      userId: sess.sub,
      itemId,
    });

    return jsonNoStore(
      {
        ok: true,
        item: {
          itemId: details.item.itemId,
          kind: details.item.kind,
          name: details.item.name,
          path: details.item.path,
          mimeType: details.item.mimeType,
        },
        role: details.role,
        canManage: details.canManage,
        peopleWithAccess: details.peopleWithAccess,
        pending: details.pending,
      },
      200,
    );
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to load CavSafe item.");
  }
}
