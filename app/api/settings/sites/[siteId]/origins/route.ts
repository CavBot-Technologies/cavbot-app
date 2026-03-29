import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { readWorkspace } from "@/lib/workspaceStore.server";
import { canonicalizeAllowlistOrigin, AllowedOriginRow } from "@/originMatch";
import { auditLogWrite } from "@/lib/audit";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

type OriginsParams = { siteId?: string };

async function getParams(ctx: unknown): Promise<OriginsParams> {
  return Promise.resolve((ctx as { params?: OriginsParams })?.params ?? {});
}

export async function PATCH(req: NextRequest, ctx: unknown) {
  try {
    const session = await requireSettingsOwnerSession(req);

    const { siteId } = await getParams(ctx);
    if (!siteId) return json({ ok: false, error: "SITE_ID_REQUIRED" }, 400);

    const workspace = await readWorkspace({ accountId: session.accountId });
    const projectId = workspace.projectId;

    const site = await prisma.site.findFirst({
      where: { id: siteId, projectId, isActive: true },
    });
    if (!site) return json({ ok: false, error: "SITE_NOT_FOUND" }, 404);

    const existingOrigins = await prisma.siteAllowedOrigin.findMany({
      where: { siteId: site.id },
      select: { origin: true },
    });
    const previousOrigins = existingOrigins.map((row) => row.origin);

    const payload = (await readSanitizedJson(req, null)) as Record<string, unknown> | null;
    const rawOrigins = Array.isArray(payload?.allowedOrigins) ? payload.allowedOrigins : [];

    const canonicalMap = new Map<string, AllowedOriginRow>();
    for (const raw of rawOrigins) {
      try {
        const canonical = canonicalizeAllowlistOrigin(String(raw || ""));
        canonicalMap.set(canonical.origin, canonical);
      } catch (err) {
        return json({ ok: false, error: "BAD_ORIGIN", message: (err as Error)?.message || "Invalid origin." }, 400);
      }
    }

    const siteOriginEntry: AllowedOriginRow = { origin: site.origin, matchType: "EXACT" };
    canonicalMap.set(site.origin, siteOriginEntry);

    const entries = Array.from(canonicalMap.values());
    const normalizedOrigins = entries.map((entry) => entry.origin);
    const previousSet = new Set(previousOrigins);
    const newSet = new Set(normalizedOrigins);
    const originsAdded = normalizedOrigins.filter((origin) => !previousSet.has(origin));
    const originsRemoved = previousOrigins.filter((origin) => !newSet.has(origin));

    await prisma.$transaction(async (tx) => {
      await tx.siteAllowedOrigin.deleteMany({ where: { siteId: site.id } });
      if (entries.length) {
        await tx.siteAllowedOrigin.createMany({
          data: entries.map((entry) => ({
            siteId: site.id,
            origin: entry.origin,
            matchType: entry.matchType,
          })),
        });
      }
    });

    if (session.accountId) {
      await auditLogWrite({
        request: req,
        action: "ALLOWLIST_UPDATED",
        accountId: session.accountId,
        operatorUserId: session.sub,
        targetType: "site",
        targetId: site.id,
        targetLabel: site.origin,
        metaJson: {
          beforeCount: previousOrigins.length,
          afterCount: normalizedOrigins.length,
          originsAdded,
          originsRemoved,
          siteOrigin: site.origin,
        },
      });
    }

    return json({ ok: true, allowedOrigins: normalizedOrigins }, 200);
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ ok: false, error: e.code }, e.status);
    const message = e instanceof Error ? e.message : String(e ?? "");
    return json({ ok: false, error: "ALLOWLIST_UPDATE_FAILED", message }, 500);
  }
}
