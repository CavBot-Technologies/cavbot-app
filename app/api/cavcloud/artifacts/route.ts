import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireSession, requireUser } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore<T>(body: T, init?: { status?: number }) {
  noStore();
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);

    const userId = String(sess.sub);
    const items = await prisma.publicArtifact.findMany({
      where: { userId, sourcePath: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        sourcePath: true,
        displayTitle: true,
        type: true,
        visibility: true,
        publishedAt: true,
        storageKey: true,
        mimeType: true,
        sizeBytes: true,
      },
      take: 500,
    });

    return jsonNoStore(
      {
        ok: true,
        items: items.map((a) => ({
          id: a.id,
          sourcePath: a.sourcePath,
          displayTitle: a.displayTitle,
          type: a.type,
          visibility: a.visibility,
          publishedAtISO: a.publishedAt ? new Date(a.publishedAt).toISOString() : null,
          // The CavCloud UI may need this for diagnostics; never expose on public profile pages.
          storageKey: a.storageKey,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
        })),
      },
      { status: 200 }
    );
  } catch (e: unknown) {
    const err = e as { code?: unknown; status?: unknown };
    const code = String(err?.code || "");
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status === 401 || status === 403) return jsonNoStore({ ok: false, message: "Unauthorized" }, { status });
    return jsonNoStore({ ok: false, message: code || "Failed to load artifacts." }, { status: 500 });
  }
}
