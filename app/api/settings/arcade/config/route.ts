import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerResilientSession } from "@/lib/settings/ownerAuth.server";
import { getArcadeGames, findArcadeGame } from "@/lib/arcade/catalog";
import {
  ARCADE_KIND_404,
  buildArcadeThumbnailUrl,
  mergeArcadeOptions,
  normalizeArcadeConfigResponse,
  ArcadeConfigPayload,
  ArcadeConfigResponse,
} from "@/lib/arcade/settings";
import { type Tier } from "@/lib/billing/featureGates";
import {
  getAllowedArcadeGames,
  getArcadeLockMapForTier,
  isArcadeGameAllowed,
} from "@/lib/billing/arcadeGates";
import { auditLogWrite } from "@/lib/audit";
import { readSanitizedJson } from "@/lib/security/userInput";
import { findSiteForAccount } from "@/lib/settings/apiKeysRuntime.server";
import {
  readSettingsAccountTier,
  readSiteArcadeConfig,
  saveSiteArcadeConfig,
} from "@/lib/settings/arcadeRuntime.server";

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

async function resolveAccountTier(accountId?: string): Promise<Tier> {
  return readSettingsAccountTier(accountId);
}

function buildGamesList(): ArcadeConfigResponse["games"] {
  return getArcadeGames(ARCADE_KIND_404).map((game) => ({
    slug: game.slug,
    displayName: game.displayName,
    version: game.version,
    thumbnailUrl: buildArcadeThumbnailUrl(game.slug, game.version),
  }));
}

function validateRedirectUrl(value: string) {
  if (!value) return "";
  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Redirect must use http or https.");
    }
    return parsed.toString();
  } catch {
    throw new Error("Redirect URL is invalid.");
  }
}

function validateEmail(value: string) {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    throw new Error("Support email is invalid.");
  }
  return trimmed;
}

function ensureDifficulty(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const allowed = ["easy", "standard", "hard"] as const;
  if (!candidate) return undefined;
  if (!allowed.includes(candidate as typeof allowed[number])) {
    throw new Error("Invalid difficulty selection.");
  }
  return candidate as (typeof allowed)[number];
}

function ensureTheme(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const allowed = ["dark", "light", "auto"] as const;
  if (!candidate) return undefined;
  if (!allowed.includes(candidate as typeof allowed[number])) {
    throw new Error("Invalid theme selection.");
  }
  return candidate as (typeof allowed)[number];
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSettingsOwnerResilientSession(req);

    const siteId = (req.nextUrl.searchParams.get("siteId") || "").trim();
    if (!siteId) {
      return json({ ok: false, error: "SITE_ID_REQUIRED" }, 400);
    }

    const site = await findSiteForAccount({
      siteId,
      accountId: session.accountId,
    });
    if (!site) {
      return json({ ok: false, error: "SITE_NOT_FOUND" }, 404);
    }

    const config = await readSiteArcadeConfig(site.id);
    const games = buildGamesList();
    const tier = await resolveAccountTier(session.accountId);
    const allowedGames = getAllowedArcadeGames(tier);
    const lockMap = getArcadeLockMapForTier(tier);
    const allowedSet = new Set(allowedGames);
    const fallbackSlug = allowedGames[0] ?? games[0]?.slug ?? "catch-cavbot";

    let sanitizedConfig: ArcadeConfigPayload | null = config
      ? normalizeArcadeConfigResponse(
          site.id,
          config.enabled,
          config.gameSlug,
          config.gameVersion,
          config.optionsRecord,
          config.updatedAt,
        )
      : null;

    if (
      sanitizedConfig?.enabled &&
      sanitizedConfig.gameSlug &&
      !allowedSet.has(sanitizedConfig.gameSlug)
    ) {
      const fallbackGame = games.find((entry) => entry.slug === fallbackSlug);
      sanitizedConfig = {
        ...sanitizedConfig,
        gameSlug: fallbackGame?.slug ?? fallbackSlug,
        gameVersion: fallbackGame?.version ?? sanitizedConfig.gameVersion,
      };
    }

    const response: ArcadeConfigResponse = {
      ok: true,
      config: sanitizedConfig,
      games,
      allowedGames,
      lockMap,
    };

    return json(response, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      return json({ ok: false, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to load Arcade config.";
    return json({ ok: false, error: "ARCADE_CONFIG_FAILED", message }, 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireSettingsOwnerResilientSession(req);

    const body = (await readSanitizedJson(req, null)) as Record<string, unknown> | null;
    const siteIdFromBody = typeof body?.siteId === "string" ? body.siteId.trim() : "";
    const siteId = siteIdFromBody;
    if (!siteId) {
      return json({ ok: false, error: "SITE_ID_REQUIRED" }, 400);
    }

    const site = await findSiteForAccount({
      siteId,
      accountId: session.accountId,
    });
    if (!site) {
      return json({ ok: false, error: "SITE_NOT_FOUND" }, 404);
    }

    const tier = await resolveAccountTier(session.accountId);
    const allowedGames = getAllowedArcadeGames(tier);
    const lockMap = getArcadeLockMapForTier(tier);

    const existingConfig = await readSiteArcadeConfig(site.id);

    const enabled = body?.enabled !== undefined ? Boolean(body.enabled) : existingConfig?.enabled ?? false;

    const requestedSlug =
      typeof body?.gameSlug === "string" && body.gameSlug.trim()
        ? body.gameSlug.trim()
        : existingConfig?.gameSlug ?? "";
    const requestedVersion =
      typeof body?.gameVersion === "string" && body.gameVersion.trim()
        ? body.gameVersion.trim()
        : existingConfig?.gameVersion ?? "";

    if (enabled && (!requestedSlug || !requestedVersion)) {
      return json({ ok: false, error: "GAME_REQUIRED", message: "Select a game to enable Arcade." }, 400);
    }

    if (enabled && !isArcadeGameAllowed(tier, requestedSlug)) {
      return json({ ok: false, error: "ARCADE_TIER_LOCKED", code: "ARCADE_TIER_LOCKED" }, 403);
    }

    if (enabled) {
      const availableGame = findArcadeGame(ARCADE_KIND_404, requestedSlug, requestedVersion);
      if (!availableGame) {
        return json({ ok: false, error: "GAME_NOT_FOUND", message: "Selected Arcade experience is unavailable." }, 400);
      }
    }

    const optionsRaw = (body?.options as Record<string, unknown>) ?? {};
    const validatedOptions = mergeArcadeOptions({
      sound: typeof optionsRaw.sound === "boolean" ? optionsRaw.sound : undefined,
      difficulty: ensureDifficulty(optionsRaw.difficulty) ?? undefined,
      theme: ensureTheme(optionsRaw.theme) ?? undefined,
      redirectUrl:
        typeof optionsRaw.redirectUrl === "string" ? validateRedirectUrl(optionsRaw.redirectUrl) : undefined,
      supportEmail:
        typeof optionsRaw.supportEmail === "string" ? validateEmail(optionsRaw.supportEmail) : undefined,
    });

    const nextConfig = await saveSiteArcadeConfig({
      siteId: site.id,
      enabled,
      gameSlug: requestedSlug || null,
      gameVersion: requestedVersion || existingConfig?.gameVersion || "v1",
      optionsRecord: validatedOptions,
    });
    if (!nextConfig) {
      return json({ ok: false, error: "ARCADE_CONFIG_SAVE_FAILED", message: "Unable to save Arcade config." }, 500);
    }

    if (session.accountId) {
      await auditLogWrite({
        request: req,
        accountId: session.accountId,
        operatorUserId: session.sub,
        action: "INTEGRATION_CONNECTED",
        targetType: "site",
        targetId: site.id,
        targetLabel: site.origin,
        metaJson: {
          arcadeEnabled: nextConfig.enabled,
          gameSlug: nextConfig.gameSlug,
        },
      });
    }

    const responseConfig = normalizeArcadeConfigResponse(
      site.id,
      nextConfig.enabled,
      nextConfig.gameSlug,
      nextConfig.gameVersion,
      nextConfig.optionsRecord,
      nextConfig.updatedAt
    );

    const games = buildGamesList();

    const response: ArcadeConfigResponse = {
      ok: true,
      config: responseConfig,
      games,
      allowedGames,
      lockMap,
    };

    return json(response, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      return json({ ok: false, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Unable to save Arcade config.";
    return json({ ok: false, error: "ARCADE_CONFIG_SAVE_FAILED", message }, 500);
  }
}
