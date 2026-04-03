import { ApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { createCavPadDirectory, listCavPadDirectories } from "@/lib/cavpad/server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateDirectoryBody = {
  name?: unknown;
  parentId?: unknown;
  pinnedAtISO?: unknown;
};

function degradedDirectoriesResponse() {
  return jsonNoStore({ ok: true, degraded: true, directories: [] }, 200);
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    try {
      const directories = await listCavPadDirectories({
        accountId: String(sess.accountId || ""),
        userId: String(sess.sub || ""),
      });

      return jsonNoStore({ ok: true, directories }, 200);
    } catch (err) {
      if (err instanceof ApiAuthError) throw err;
      return degradedDirectoriesResponse();
    }
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load CavPad directories.");
  }
}

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const body = (await readSanitizedJson(req, null)) as CreateDirectoryBody | null;
    if (!body || typeof body !== "object") {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const name = String(body.name || "").trim();
    if (!name) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "name is required." }, 400);
    }

    const directory = await createCavPadDirectory({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      name,
      parentId: String(body.parentId || "").trim() || null,
      pinnedAtISO: body.pinnedAtISO == null ? undefined : String(body.pinnedAtISO || "").trim() || null,
    });

    return jsonNoStore({ ok: true, directory }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to create CavPad directory.");
  }
}
