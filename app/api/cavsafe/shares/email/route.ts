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

const ShareByEmailSchema = z.object({
  itemId: z.string().trim().min(1).optional(),
  fileId: z.string().trim().min(1).optional(),
  folderId: z.string().trim().min(1).optional(),
  recipientEmail: z.string().trim().email().optional(),
  recipient: z.string().trim().min(1).optional(),
  role: z.enum(["owner", "editor", "viewer"]).optional(),
  expiresInDays: z.number().int().min(1).max(30).optional(),
}).refine((value) => Boolean(value.itemId || value.fileId || value.folderId), {
  message: "itemId or fileId or folderId is required.",
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
    const parsed = ShareByEmailSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid invite payload." }, 400);
    }

    const itemId = s(parsed.data.itemId || parsed.data.fileId || parsed.data.folderId);
    const recipient = s(parsed.data.recipient || parsed.data.recipientEmail).replace(/^@+/, "");
    if (!itemId || !recipient) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "itemId and recipient are required." }, 400);
    }

    const inviteRate = consumeInMemoryRateLimit({
      key: `cavsafe-share-email:${sess.sub}:${itemId}`,
      limit: 10,
      windowMs: 60_000,
    });
    if (!inviteRate.allowed) {
      return jsonNoStore(
        { ok: false, error: "RATE_LIMITED", message: "Too many invites for this item. Please retry shortly." },
        429,
      );
    }

    const invitee = recipient.includes("@")
      ? { email: recipient.toLowerCase() }
      : { username: recipient };

    const result = await createCavSafeInvite({
      request: req,
      accountId: sess.accountId,
      inviterUserId: sess.sub,
      itemId,
      role: parsed.data.role || "viewer",
      invitee,
      expiresInDays: parsed.data.expiresInDays || 7,
    });

    return jsonNoStore({
      ok: true,
      invite: result.invite,
      item: {
        itemId: result.item.itemId,
        kind: result.item.kind,
        name: result.item.name,
        path: result.item.path,
      },
    }, result.reused ? 200 : 201);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to send CavSafe invite.");
  }
}
