import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { upsertTextFile as upsertCavcloudTextFile } from "@/lib/cavcloud/storage.server";
import { assertCavPadSyncTargetEnabled } from "@/lib/cavpad/server";
import { CavSafeError, upsertTextFile } from "@/lib/cavsafe/storage.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type UpsertSyncBody = {
  folderPath?: unknown;
  name?: unknown;
  mimeType?: unknown;
  content?: unknown;
  source?: unknown;
};

function normalizePathNoTrailingSlash(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "/";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withSlash.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function isCavPadFolderPath(folderPath: string): boolean {
  const normalized = normalizePathNoTrailingSlash(folderPath);
  return normalized === "/Synced/CavPad" || normalized.startsWith("/Synced/CavPad/");
}

export async function POST(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);

    const body = (await readSanitizedJson(req, null)) as UpsertSyncBody | null;
    if (!body) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const folderPath = String(body.folderPath || "/").trim() || "/";
    const name = String(body.name || "").trim();
    const mimeType = body.mimeType == null ? null : String(body.mimeType || "").trim() || null;
    const content = String(body.content || "");
    const source = body.source == null ? null : String(body.source || "").trim() || null;
    const sourceLc = String(source || "").toLowerCase();
    const isCavpadSource = sourceLc.includes("cavpad");
    const normalizedFolderPath = normalizePathNoTrailingSlash(folderPath);
    const isCavpadSyncWrite = isCavpadSource || isCavPadFolderPath(normalizedFolderPath);
    if (isCavpadSyncWrite) {
      await assertCavPadSyncTargetEnabled({
        accountId: sess.accountId,
        userId: sess.sub,
        target: "cavsafe",
      });
    }
    const shouldMirrorToCavcloud = !isCavpadSyncWrite
      && (
      sourceLc.includes("cavcode")
      || normalizedFolderPath === "/Synced"
      || normalizedFolderPath.startsWith("/Synced/")
      );

    const file = await upsertTextFile({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderPath,
      name,
      mimeType,
      content,
      source,
    });

    if (shouldMirrorToCavcloud) {
      try {
        await upsertCavcloudTextFile({
          accountId: sess.accountId,
          operatorUserId: sess.sub,
          folderPath,
          name,
          mimeType,
          content,
          source,
        });
      } catch (mirrorErr) {
        throw new CavSafeError(
          "SYNC_MIRROR_FAILED",
          502,
          `Synced file write reached CavSafe but failed to mirror to CavCloud (${(mirrorErr as Error)?.message || "unknown error"}).`,
        );
      }
    }

    return jsonNoStore({ ok: true, file }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to sync file.");
  }
}
