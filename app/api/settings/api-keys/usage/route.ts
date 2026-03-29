import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { readWorkspace } from "@/lib/workspaceStore.server";
import { DEFAULT_RATE_LIMIT_LABEL, fetchUsageForWorkspace } from "@/lib/apiKeyUsage.server";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const baseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...baseInit,
    headers: { ...(baseInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSettingsOwnerSession(req);

    const workspace = await readWorkspace({ accountId: session.accountId });
    const projectId = workspace.projectId;
    const rawSiteId = req.nextUrl.searchParams.get("siteId")?.trim();
    const targetSiteId = rawSiteId && rawSiteId.length ? rawSiteId : workspace.activeSiteId || null;
    const siteRecord = targetSiteId ? workspace.sites.find((s) => s.id === targetSiteId) ?? null : null;

    if (rawSiteId && rawSiteId.length && !siteRecord) {
      return json({ ok: false, error: "SITE_NOT_FOUND" }, 404);
    }

    const usage =
      (await fetchUsageForWorkspace({
        projectId,
        accountId: session.accountId!,
        siteId: siteRecord?.id ?? null,
        siteOrigin: siteRecord?.origin ?? null,
      })) ??
      {
        verifiedToday: null,
        deniedToday: null,
        rateLimit: DEFAULT_RATE_LIMIT_LABEL,
        topDeniedOrigins: null,
      };

    return json({ ok: true, usage }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}
