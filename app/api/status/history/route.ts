import "server-only";
import { NextResponse } from "next/server";
import { getStatusHistoryMonth } from "@/lib/status/service";
import { getSystemStatusHistoryMonthMetrics } from "@/lib/system-status/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? undefined;
  const timeZone = url.searchParams.get("tz") ?? undefined;

  try {
    const monthWindow = await getSystemStatusHistoryMonthMetrics(month, timeZone);
    const history = await getStatusHistoryMonth(monthWindow.monthKey, timeZone);
    const payload = {
      ...history,
      monthKey: monthWindow.monthKey,
      prevMonthKey: monthWindow.prevMonthKey,
      nextMonthKey: monthWindow.nextMonthKey,
      metrics: monthWindow.metrics,
      timeZone,
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Status history API failed:", error);
    return NextResponse.json(
      { error: "STATUS_HISTORY_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
