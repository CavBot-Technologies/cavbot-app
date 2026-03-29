import { headers } from "next/headers";
import { Suspense } from "react";

import { getAppOrigin, getSession } from "@/lib/apiAuth";
import CavCloudClientShell from "../CavCloudClientShell";

async function isOwnerRequest(): Promise<boolean> {
  try {
    const h = headers();
    const cookie = String(h.get("cookie") || "").trim();
    if (!cookie) return false;

    const fallback = new URL(getAppOrigin());
    const host = String(h.get("x-forwarded-host") || h.get("host") || fallback.host).trim();
    const proto = String(h.get("x-forwarded-proto") || fallback.protocol.replace(/:$/, "")).trim() || "http";

    const req = new Request(`${proto}://${host}/cavcloud/dashboard`, {
      headers: {
        cookie,
        host,
      },
    });

    const sess = await getSession(req);
    return !!(sess && sess.systemRole === "user" && sess.memberRole === "OWNER");
  } catch {
    return false;
  }
}

export default async function CavCloudDashboardPage() {
  const isOwner = await isOwnerRequest();
  return (
    <Suspense fallback={null}>
      <CavCloudClientShell isOwner={isOwner} />
    </Suspense>
  );
}
