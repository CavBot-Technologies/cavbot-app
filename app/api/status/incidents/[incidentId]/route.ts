import "server-only";
import { NextResponse } from "next/server";
import { getIncidentDetail } from "@/lib/status/service";
import { ensureStatusSnapshotFresh } from "@/lib/status/checker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { incidentId: string } }
) {
  await ensureStatusSnapshotFresh();

  const incidentId = params?.incidentId;
  if (!incidentId) {
    return NextResponse.json(
      { error: "INCIDENT_ID_REQUIRED" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const payload = await getIncidentDetail(incidentId);
    if (!payload) {
      return NextResponse.json(
        { error: "INCIDENT_NOT_FOUND" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Status incident detail API failed:", error);
    return NextResponse.json(
      { error: "STATUS_INCIDENT_DETAIL_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
