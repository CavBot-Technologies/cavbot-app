import { z } from "zod";

import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { createCavSafeInvite } from "@/lib/cavsafe/privateShare.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { requireUserSession } from "@/lib/security/authorize";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const InviteSchema = z.object({
  itemId: z.string().trim().min(1),
  invitee: z.object({
    userId: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    username: z.string().trim().min(1).optional(),
  }).refine((value) => {
    const count = Number(Boolean(value.userId)) + Number(Boolean(value.email)) + Number(Boolean(value.username));
    return count === 1;
  }, "Provide exactly one invitee identity."),
  role: z.enum(["owner", "editor", "viewer"]),
});

function inviteeRateKey(invitee: { userId?: string; email?: string; username?: string }): string {
  if (invitee.userId) return `uid:${invitee.userId}`;
  if (invitee.email) return `email:${invitee.email.toLowerCase()}`;
  return `user:${String(invitee.username || "").toLowerCase()}`;
}

export async function POST(req: Request) {
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return jsonNoStore({ ok: false, error: "BAD_CSRF", message: "Missing request integrity token." }, 403);
    }

    const sess = await requireUserSession(req);
    const bodyRaw = await readSanitizedJson(req, null);
    const parsed = InviteSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid invite payload." }, 400);
    }

    const userItemRate = consumeInMemoryRateLimit({
      key: `cavsafe-invite:user-item:${sess.sub}:${parsed.data.itemId}`,
      limit: 10,
      windowMs: 60_000,
    });
    if (!userItemRate.allowed) {
      return jsonNoStore(
        { ok: false, error: "RATE_LIMITED", message: "Too many invites for this item. Please retry shortly." },
        429,
      );
    }

    const inviteeRate = consumeInMemoryRateLimit({
      key: `cavsafe-invite:invitee:${sess.sub}:${inviteeRateKey(parsed.data.invitee)}`,
      limit: 4,
      windowMs: 60_000,
    });
    if (!inviteeRate.allowed) {
      return jsonNoStore(
        { ok: false, error: "RATE_LIMITED", message: "Invite cooldown active for this recipient." },
        429,
      );
    }

    const result = await createCavSafeInvite({
      request: req,
      accountId: sess.accountId,
      inviterUserId: sess.sub,
      itemId: parsed.data.itemId,
      role: parsed.data.role,
      invitee: parsed.data.invitee,
      expiresInDays: 7,
    });

    return jsonNoStore(
      {
        ok: true,
        reused: result.reused,
        invite: result.invite,
        item: {
          itemId: result.item.itemId,
          kind: result.item.kind,
          name: result.item.name,
          path: result.item.path,
        },
      },
      result.reused ? 200 : 201,
    );
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to send CavSafe invite.");
  }
}
