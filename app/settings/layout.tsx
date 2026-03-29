import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerFromRequestContext } from "@/lib/settings/ownerAuth.server";
import { appendGuardReturnParam, resolveGuardReturnFromReferer } from "@/src/lib/cavguard/cavGuard.return";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireSettingsOwnerFromRequestContext("/settings");
    return children;
  } catch (error) {
    if (error instanceof ApiAuthError && (error.status === 401 || error.status === 403)) {
      const h = headers();
      const host = String(h.get("x-forwarded-host") || h.get("host") || "").trim();
      const guardReturn = resolveGuardReturnFromReferer({
        referer: h.get("referer"),
        host,
        blockedPrefixes: ["/settings"],
      });
      redirect(appendGuardReturnParam("/?settings=owner_only", guardReturn));
    }
    throw error;
  }
}
