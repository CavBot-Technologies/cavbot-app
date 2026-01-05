// app/api/metrics/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { requireAccountContext, requireSession } from "@/lib/apiAuth";
export const runtime = "edge";
export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    // Placeholder until real backend metrics exist
    const data = {
      guardianScore: 100,
      recovered404Rate: 0.92,
      sessionCalmRate: 0.74,
      routesDiscoverableRate: 0.82,
    };

    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load metrics" }, { status: 500 });
  }
}