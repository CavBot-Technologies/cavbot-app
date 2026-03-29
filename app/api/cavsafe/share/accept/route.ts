import { z } from "zod";

import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { acceptCavSafeInvite } from "@/lib/cavsafe/privateShare.server";
import { prisma } from "@/lib/prisma";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { requireUserSession } from "@/lib/security/authorize";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const AcceptSchema = z.object({
  inviteId: z.string().trim().min(1),
});

function s(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(req: Request) {
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return jsonNoStore({ ok: false, error: "BAD_CSRF", message: "Missing request integrity token." }, 403);
    }

    const sess = await requireUserSession(req);
    const bodyRaw = await readSanitizedJson(req, null);
    const parsed = AcceptSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid accept payload." }, 400);
    }

    const rate = consumeInMemoryRateLimit({
      key: `cavsafe-invite-accept:${sess.sub}`,
      limit: 20,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return jsonNoStore(
        { ok: false, error: "RATE_LIMITED", message: "Too many invite accept attempts. Please retry shortly." },
        429,
      );
    }

    const me = await prisma.user.findUnique({
      where: { id: sess.sub },
      select: { email: true },
    });

    const result = await acceptCavSafeInvite({
      request: req,
      accountId: sess.accountId,
      userId: sess.sub,
      userEmail: s(me?.email),
      inviteId: parsed.data.inviteId,
    });

    return jsonNoStore({
      ok: true,
      alreadyHandled: result.alreadyHandled,
      invite: result.invite,
      role: result.role ? String(result.role).toLowerCase() : null,
      item: {
        itemId: result.item.itemId,
        kind: result.item.kind,
        name: result.item.name,
        path: result.item.path,
      },
      refresh: true,
    }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to accept CavSafe invite.");
  }
}
