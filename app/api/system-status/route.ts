import "server-only";

import { NextResponse } from "next/server";
import { SERVICE_DEFINITIONS, SERVICE_ORDER } from "@/lib/status/constants";
import { getSystemStatusSnapshot } from "@/lib/system-status/pipeline";
import type { SystemStatusPayload } from "@/lib/system-status/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(payload: unknown) {
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function buildUnknownPayload(reason: string): SystemStatusPayload {
  return {
    checkedAt: null,
    services: SERVICE_ORDER.map((key) => ({
      key,
      label: SERVICE_DEFINITIONS[key].displayName,
      status: "unknown",
      latencyMs: null,
      checkedAt: null,
      reason,
    })),
    summary: {
      allLive: false,
      liveCount: 0,
      atRiskCount: 0,
      downCount: 0,
      unknownCount: SERVICE_ORDER.length,
    },
  };
}

export async function GET() {
  try {
    const payload = await getSystemStatusSnapshot({ allowStale: true });
    return noStoreJson(payload);
  } catch (error) {
    console.error("System status API failed:", error);
    return noStoreJson(buildUnknownPayload("System health is temporarily unavailable."));
  }
}
