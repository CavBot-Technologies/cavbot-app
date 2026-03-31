// app/api/public/profile-exists/route.ts
import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { prisma } from "@/lib/prisma";
import { isBasicUsername, isReservedUsername, normalizeUsername, RESERVED_ROUTE_SLUGS } from "@/lib/username";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const OWNER_USERNAME = normalizeUsername(process.env.CAVBOT_OWNER_USERNAME || "");

function jsonNoStore<T>(body: T, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function isUnsafeSlug(raw: string) {
  const v = String(raw || "").trim();
  if (!v) return true;
  if (v.includes(".") || v.includes("/") || v.includes("\\")) return true;
  return false;
}

export async function GET(req: Request) {
  noStore();
  try {
    const { searchParams } = new URL(req.url);
    const raw = String(searchParams.get("username") || "").trim();
    if (isUnsafeSlug(raw)) {
      return jsonNoStore({ ok: true, exists: false }, { status: 200 });
    }

    const username = normalizeUsername(raw);
    if (!username) return jsonNoStore({ ok: true, exists: false }, { status: 200 });
    if (!isBasicUsername(username)) return jsonNoStore({ ok: true, exists: false }, { status: 200 });
    // Never allow route slugs to be claimed by the public profile rewrite.
    if ((RESERVED_ROUTE_SLUGS as readonly string[]).includes(username)) return jsonNoStore({ ok: true, exists: false }, { status: 200 });
    // Allow the configured owner username even if reserved by brand rules.
    if (isReservedUsername(username) && (!OWNER_USERNAME || username !== OWNER_USERNAME)) {
      return jsonNoStore({ ok: true, exists: false }, { status: 200 });
    }

    try {
      const user = await prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });

      // Rewrite /{username} when the username exists. Visibility is handled inside the public profile page
      // (public vs locked) and must never rely on 404 for privacy.
      return jsonNoStore({ ok: true, exists: Boolean(user?.id) }, { status: 200 });
    } catch {
      const basic = await prisma.user
        .findUnique({
          where: { username },
          select: { id: true },
        })
        .catch(() => null);

	      if (!basic?.id) return jsonNoStore({ ok: true, exists: false }, { status: 200 });
	      return jsonNoStore({ ok: true, exists: true }, { status: 200 });
	    }
	  } catch (e) {
    console.error("GET /api/public/profile-exists failed:", e);
    // Fail-closed (do not rewrite) to avoid breaking workspace routing.
    return jsonNoStore({ ok: true, exists: false }, { status: 200 });
  }
}
