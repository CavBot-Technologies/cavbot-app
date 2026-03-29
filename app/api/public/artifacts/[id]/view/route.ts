import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { incrementPublicArtifactViewCount } from "@/lib/publicProfile/publicArtifactViews.server";
import { resolvePublicArtifactScope, resolveScopedPath } from "@/lib/publicProfile/publicArtifacts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore<T>(body: T, status = 200) {
  noStore();
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function notFoundJson() {
  return jsonNoStore({ ok: false, code: "NOT_FOUND" }, 404);
}

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    const artifactId = String(ctx?.params?.id || "").trim();
    const url = new URL(req.url);
    const username = String(url.searchParams.get("username") || "").trim();
    const requestedPath = url.searchParams.get("path");

    if (!artifactId || !username) {
      return jsonNoStore({ ok: false, code: "BAD_REQUEST", message: "id and username are required." }, 400);
    }

    const scope = await resolvePublicArtifactScope({ artifactId, username });
    if (!scope) return notFoundJson();

    const itemPath = (() => {
      if (scope.type === "FOLDER" && scope.rootFolder) {
        const scoped = resolveScopedPath(scope.rootFolder.path, requestedPath);
        return scoped || null;
      }
      return scope.sourcePath || "/";
    })();
    if (!itemPath) return notFoundJson();

    const next = await incrementPublicArtifactViewCount({
      artifactId: scope.id,
      itemPath,
    });

    return jsonNoStore({
      ok: true,
      artifactId: scope.id,
      itemPath: next.itemPath,
      viewCount: next.viewCount,
    });
  } catch {
    return jsonNoStore({ ok: false, code: "INTERNAL_ERROR" }, 500);
  }
}
