import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { getRootFolder } from "@/lib/cavsafe/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isMissingCavSafeTablesError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  if (msg.includes("does not exist") && msg.includes("cavsafe")) return true;
  if (msg.includes("relation") && msg.includes("cavsafe")) return true;
  return false;
}

export async function GET(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);

    const root = await getRootFolder({
      accountId: sess.accountId,
    });

    return jsonNoStore({
      ok: true,
      rootFolderId: root.id,
      root,
      defaultFolder: root,
    }, 200);
  } catch (err) {
    if (isMissingCavSafeTablesError(err)) {
      const now = new Date().toISOString();
      const root = { id: "root", name: "root", path: "/", parentId: null, createdAtISO: now, updatedAtISO: now };
      return jsonNoStore({
        ok: true,
        rootFolderId: root.id,
        root,
        defaultFolder: root,
      }, 200);
    }
    return cavsafeErrorResponse(err, "Failed to load CavSafe root.");
  }
}
