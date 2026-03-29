import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { listCavSafeItems, listPendingInvitesForUser } from "@/lib/cavsafe/privateShare.server";
import { prisma } from "@/lib/prisma";
import { requireUserSession } from "@/lib/security/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

export async function GET(req: Request) {
  try {
    const sess = await requireUserSession(req);
    const url = new URL(req.url);
    const includePendingInvites = s(url.searchParams.get("pendingInvites")) === "1";

    const [items, pendingInvites] = await Promise.all([
      listCavSafeItems({
        accountId: sess.accountId,
        userId: sess.sub,
      }),
      includePendingInvites
        ? (async () => {
            const me = await prisma.user.findUnique({
              where: { id: sess.sub },
              select: { email: true },
            });
            return listPendingInvitesForUser({
              accountId: sess.accountId,
              userId: sess.sub,
              userEmail: s(me?.email),
            });
          })()
        : Promise.resolve([]),
    ]);

    return jsonNoStore(
      {
        ok: true,
        ...items,
        pendingInvites,
      },
      200,
    );
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to load CavSafe items.");
  }
}
