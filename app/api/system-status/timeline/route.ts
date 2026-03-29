import "server-only";
import { NextResponse } from "next/server";
import { getSystemStatusTimeline } from "@/lib/system-status/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const daysParam = Number(url.searchParams.get("days"));
  const days = Number.isFinite(daysParam) ? daysParam : 30;

  try {
    const payload = await getSystemStatusTimeline(days);
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("System status timeline API failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "SYSTEM_STATUS_TIMELINE_FAILED",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
