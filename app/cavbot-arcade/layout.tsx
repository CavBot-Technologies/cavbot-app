import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getAppOrigin, getSession } from "@/lib/apiAuth";
import { getCavCloudCollabPolicy } from "@/lib/cavcloud/collabPolicy.server";
import { appendGuardReturnParam, resolveGuardReturnFromReferer } from "@/src/lib/cavguard/cavGuard.return";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function resolveArcadeAccess(): Promise<"ALLOW" | "AUTH_REQUIRED" | "BLOCKED"> {
  try {
    const h = headers();
    const cookie = String(h.get("cookie") || "").trim();
    if (!cookie) return "AUTH_REQUIRED";

    const fallback = new URL(getAppOrigin());
    const host = String(h.get("x-forwarded-host") || h.get("host") || fallback.host).trim();
    const proto = String(h.get("x-forwarded-proto") || fallback.protocol.replace(/:$/, "")).trim() || "http";
    const req = new Request(`${proto}://${host}/cavbot-arcade`, {
      headers: {
        cookie,
        host,
      },
    });

    const sess = await getSession(req);
    if (!sess || sess.systemRole !== "user" || !sess.accountId) return "AUTH_REQUIRED";
    if (sess.memberRole === "OWNER") return "ALLOW";

    const policy = await getCavCloudCollabPolicy(sess.accountId).catch(() => null);
    if (policy?.enableContributorLinks) return "ALLOW";
    return "BLOCKED";
  } catch {
    return "AUTH_REQUIRED";
  }
}

export default async function CavbotArcadeLayout({
  children,
}: {
  children: ReactNode;
}) {
  const h = headers();
  const host = String(h.get("x-forwarded-host") || h.get("host") || "").trim();
  const guardReturn = resolveGuardReturnFromReferer({
    referer: h.get("referer"),
    host,
    blockedPrefixes: ["/cavbot-arcade"],
  });

  const access = await resolveArcadeAccess();
  if (access === "AUTH_REQUIRED") {
    redirect(appendGuardReturnParam("/?guardAction=AUTH_REQUIRED", guardReturn));
  }
  if (access === "BLOCKED") {
    redirect(appendGuardReturnParam("/?arcade=blocked", guardReturn));
  }
  return children;
}
