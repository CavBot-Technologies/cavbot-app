import { z } from "zod";

import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { changeCavSafeRole } from "@/lib/cavsafe/privateShare.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { requireUserSession } from "@/lib/security/authorize";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const RoleSchema = z.object({
  itemId: z.string().trim().min(1),
  targetUserId: z.string().trim().min(1),
  role: z.enum(["owner", "editor", "viewer"]),
});

export async function POST(req: Request) {
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return jsonNoStore({ ok: false, error: "BAD_CSRF", message: "Missing request integrity token." }, 403);
    }

    const sess = await requireUserSession(req);
    const bodyRaw = await readSanitizedJson(req, null);
    const parsed = RoleSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid role payload." }, 400);
    }

    const rate = consumeInMemoryRateLimit({
      key: `cavsafe-role:${sess.sub}:${parsed.data.itemId}`,
      limit: 30,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return jsonNoStore(
        { ok: false, error: "RATE_LIMITED", message: "Too many role update attempts. Please retry shortly." },
        429,
      );
    }

    const result = await changeCavSafeRole({
      request: req,
      accountId: sess.accountId,
      actorUserId: sess.sub,
      itemId: parsed.data.itemId,
      targetUserId: parsed.data.targetUserId,
      role: parsed.data.role,
    });

    return jsonNoStore({
      ok: true,
      role: result.role,
      item: {
        itemId: result.item.itemId,
        kind: result.item.kind,
      },
    }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to update CavSafe role.");
  }
}
