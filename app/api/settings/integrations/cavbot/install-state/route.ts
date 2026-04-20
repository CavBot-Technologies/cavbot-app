import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerResilientSession } from "@/lib/settings/ownerAuth.server";
import { findSiteForAccount } from "@/lib/settings/apiKeysRuntime.server";
import { listSiteInstallState } from "@/lib/settings/installStateRuntime.server";

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

type InstallStateResponse = {
  ok: true;
  site: { id: string; origin: string };
  installs: Array<{
    kind: string;
    widgetType: string | null;
    style: string | null;
    origin: string;
    firstSeenAt: string;
    lastSeenAt: string;
    status: string;
    seenCount: number;
  }>;
  connectedSummary: {
    badgeInline: boolean;
    badgeRing: boolean;
    headOrbit: boolean;
    bodyFull: boolean;
    arcade: boolean;
  };
};

export async function GET(req: NextRequest) {
  try {
    const session = await requireSettingsOwnerResilientSession(req);

    const siteId = (req.nextUrl.searchParams.get("siteId") || "").trim();
    if (!siteId) {
      return json({ ok: false, error: "SITE_REQUIRED" }, 400);
    }

    const site = await findSiteForAccount({
      siteId,
      accountId: session.accountId,
    });
    if (!site) {
      return json({ ok: false, error: "SITE_NOT_FOUND" }, 404);
    }

    const installs = await listSiteInstallState({
      accountId: session.accountId,
      siteId: site.id,
    });

    const installsPayload = installs.map((install) => ({
      kind: install.kind,
      widgetType: install.widgetType,
      style: install.style,
      origin: install.origin,
      firstSeenAt: install.firstSeenAt.toISOString(),
      lastSeenAt: install.lastSeenAt.toISOString(),
      status: install.status,
      seenCount: install.seenCount,
    }));

    const hasInstall = (widgetType: string, style: string) =>
      installs.some(
        (item) =>
          item.kind === "WIDGET" &&
          item.widgetType === widgetType &&
          item.style === style &&
          item.status === "ACTIVE",
      );

    const arcadeDetected = installs.some(
      (item) => item.kind === "ARCADE" && item.status === "ACTIVE",
    );

    const payload: InstallStateResponse = {
      ok: true,
      site: { id: site.id, origin: site.origin },
      installs: installsPayload,
      connectedSummary: {
        badgeInline: hasInstall("badge", "inline"),
        badgeRing: hasInstall("badge", "ring"),
        headOrbit: hasInstall("head", "orbit"),
        bodyFull: hasInstall("body", "full"),
        arcade: arcadeDetected,
      },
    };

    return json(payload, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "INSTALL_STATE_FAILED" }, 500);
  }
}
