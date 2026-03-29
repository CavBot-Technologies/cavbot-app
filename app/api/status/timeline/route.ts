import "server-only";
import { NextResponse } from "next/server";
import { getStatusTimeline } from "@/lib/status/service";
import { ensureStatusSnapshotFresh } from "@/lib/status/checker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureStatusSnapshotFresh();

  const url = new URL(request.url);
  const daysParam = Number(url.searchParams.get("days"));
  const days = Number.isFinite(daysParam) ? daysParam : 30;

  try {
    const payload = await getStatusTimeline(days);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Status timeline API failed:", error);
    return NextResponse.json(
      { ok: false, error: "STATUS_TIMELINE_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
