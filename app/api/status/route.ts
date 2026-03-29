import "server-only";
import { NextResponse } from "next/server";
import { getStatusPayload } from "@/lib/status/service";
import { ensureStatusSnapshotFresh } from "@/lib/status/checker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureStatusSnapshotFresh();

  try {
    const payload = await getStatusPayload();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Status API failed:", error);
    return NextResponse.json(
      { error: "STATUS_PAYLOAD_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
