import { NextResponse } from "next/server";
import { assertWriteOrigin, clearSessionCookieHeader } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";
export const runtime = "edge";
export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);

    const res = NextResponse.json(
      { ok: true },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );

    res.headers.set("Set-Cookie", clearSessionCookieHeader());
    return res;
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = msg === "BAD_ORIGIN" ? 403 : 500;
    return NextResponse.json(
      { ok: false, error: msg === "BAD_ORIGIN" ? "bad_origin" : "logout_failed" },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }
}
