import { headers } from "next/headers";

import { getAppOrigin, getSession } from "@/lib/apiAuth";
import CavCloudClientShellNoSSR from "./CavCloudClientShellNoSSR";

type CavCloudAccessContext = {
  isOwner: boolean;
  cacheScopeKey: string;
};

function sanitizeCacheScope(raw: unknown): string {
  const value = String(raw || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  return value ? value.slice(0, 96) : "anon";
}

async function getCavCloudAccessContext(): Promise<CavCloudAccessContext> {
  try {
    const h = headers();
    const cookie = String(h.get("cookie") || "").trim();
    if (!cookie) return { isOwner: false, cacheScopeKey: "anon" };

    const fallback = new URL(getAppOrigin());
    const host = String(h.get("x-forwarded-host") || h.get("host") || fallback.host).trim();
    const proto = String(h.get("x-forwarded-proto") || fallback.protocol.replace(/:$/, "")).trim() || "http";

    const req = new Request(`${proto}://${host}/cavcloud`, {
      headers: {
        cookie,
        host,
      },
    });

    const sess = await getSession(req);
    const isOwner = !!(sess && sess.systemRole === "user" && sess.memberRole === "OWNER");
    const cacheScopeKey = sanitizeCacheScope(sess?.accountId || sess?.sub || "anon");
    return { isOwner, cacheScopeKey };
  } catch {
    return { isOwner: false, cacheScopeKey: "anon" };
  }
}

export default async function CavCloudPageRoute() {
  const access = await getCavCloudAccessContext();
  return <CavCloudClientShellNoSSR isOwner={access.isOwner} cacheScopeKey={access.cacheScopeKey} />;
}
