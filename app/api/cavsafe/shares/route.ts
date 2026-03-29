import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { listCavSafeItems } from "@/lib/cavsafe/privateShare.server";
import { requireUserSession } from "@/lib/security/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function legacyShareUrlForItem(args: {
  itemId: string;
  kind: "file" | "folder";
  name: string;
  path: string;
  mimeType: string | null;
}): string {
  if (args.kind === "folder") {
    const folderPath = s(args.path) || "/";
    return `/cavsafe?folderPath=${encodeURIComponent(folderPath)}`;
  }

  const q = new URLSearchParams();
  q.set("source", "file");
  q.set("name", s(args.name) || "File");
  q.set("path", s(args.path) || `/${s(args.name) || "file"}`);
  if (s(args.mimeType)) q.set("mime", s(args.mimeType));
  return `/cavsafe/view/${encodeURIComponent(args.itemId)}?${q.toString()}`;
}

export async function GET(req: Request) {
  try {
    const sess = await requireUserSession(req);
    const items = await listCavSafeItems({
      accountId: sess.accountId,
      userId: sess.sub,
    });

    const fallbackExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const rows = items.sharedWithMeItems.map((item) => {
      const mode = item.role === "viewer" ? "READ_ONLY" : "CAN_EDIT";
      return {
        id: item.itemId,
        mode,
        createdAtISO: item.createdAtISO,
        expiresAtISO: fallbackExpiry,
        revokedAtISO: null,
        shareUrl: legacyShareUrlForItem({
          itemId: item.itemId,
          kind: item.kind,
          name: item.name,
          path: item.path,
          mimeType: item.mimeType,
        }),
        sharedUserCount: 1,
        collaborationEnabled: item.role !== "viewer",
        artifact: {
          id: item.itemId,
          displayTitle: item.name || "Shared item",
          sourcePath: item.path || null,
          mimeType: item.mimeType || null,
          type: item.kind === "folder" ? "FOLDER" : "FILE",
        },
      };
    });

    return jsonNoStore({ ok: true, items: rows }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to load shared items.");
  }
}

export async function POST() {
  return jsonNoStore(
    {
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      message: "Use /api/cavsafe/share/invite for private CavSafe collaboration invites.",
    },
    405
  );
}
