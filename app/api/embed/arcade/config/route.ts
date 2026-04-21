import "server-only";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { NoticeTone, EmbedInstallKind, EmbedInstallStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { verifyEmbedRequest } from "@/lib/security/embedVerifier";
import { recordEmbedMetric } from "@/lib/security/embedMetrics.server";
import { auditLogWrite } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { resolveTierFromAccount } from "@/lib/billing/featureGates";
import { getAllowedArcadeGames } from "@/lib/billing/arcadeGates";
import { PLANS, type PlanId } from "@/lib/plans";
import { pickArcadeGame, findArcadeGame, getArcadeGames } from "@/lib/arcade/catalog";
import { mintArcadeAssetToken } from "@/lib/arcade/tokens";
import { mergeArcadeOptions, ARCADE_KIND_404, SiteArcadeOptions } from "@/lib/arcade/settings";
import { getAppOrigin } from "@/lib/apiAuth";
import { RateLimitEnv } from "@/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

const IP_HEADERS = ["cf-connecting-ip", "true-client-ip", "x-forwarded-for", "x-real-ip"];
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const REACTIVATION_WINDOW_MS = 30 * DEDUPE_WINDOW_MS;

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    ...NO_STORE_HEADERS,
    Vary: "Origin",
    "Access-Control-Allow-Origin": origin || "",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-cavbot-project-key,x-cavbot-site",
  };
  if (!origin) {
    delete headers["Access-Control-Allow-Origin"];
  }
  return headers;
}

function handleOptions(req: NextRequest) {
  const origin = req.headers.get("origin");
  return NextResponse.json(
    { ok: true },
    {
      status: 204,
      headers: corsHeaders(origin),
    }
  );
}

function hashValue(value?: string | null) {
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex");
}

function pickRequestIp(req: NextRequest) {
  for (const header of IP_HEADERS) {
    const raw = req.headers.get(header);
    if (!raw) continue;
    if (header === "x-forwarded-for") {
      const first = raw.split(",")[0];
      if (first) return first.trim();
    }
    return raw.split(",")[0].trim();
  }
  return "";
}

function pickUserAgent(req: NextRequest) {
  return (req.headers.get("user-agent") || "").trim();
}

function normalizeKind(value: string | null) {
  const normalized = String(value || "404").trim().toLowerCase();
  return normalized || "404";
}

function getEmbedApiBase() {
  const candidate =
    (process.env.NEXT_PUBLIC_EMBED_API_URL ||
      process.env.CAVBOT_EMBED_API_URL ||
      process.env.CAVBOT_APP_ORIGIN ||
      process.env.NEXT_PUBLIC_APP_ORIGIN ||
      process.env.APP_URL ||
      getAppOrigin())
      .trim();
  return candidate.replace(/\/+$/, "");
}

function getLocalArcadeHost() {
  const candidate =
    (process.env.NEXT_PUBLIC_ARCADE_DEV_URL ||
      process.env.CAVBOT_ARCADE_DEV_URL ||
      process.env.NEXT_PUBLIC_APP_ORIGIN ||
      process.env.CAVBOT_APP_ORIGIN ||
      process.env.APP_URL ||
      getAppOrigin())
      .trim();
  return candidate.replace(/\/+$/, "");
}

function planAllowsArcade(tier: PlanId) {
  const plan = PLANS[tier];
  const unlocked = plan?.limits.arcadeUnlocked;
  const allowed = unlocked === "all" || (typeof unlocked === "number" && unlocked > 0);
  const gate = {
    upsellTier: allowed ? null : "premium_plus",
    reasonTitle: allowed ? "" : "Arcade locked",
    reasonBody: allowed
      ? ""
      : "Upgrade to Premium+ to unlock CavBot Arcade across your websites.",
  };
  return { allowed, gate };
}

function buildRuntimeConfig(
  gameSlug: string,
  manifestRuntime: Record<string, unknown> | undefined,
  origin: string,
  options: SiteArcadeOptions,
  canonicalOrigin: string
) {
  const manifestSound = typeof manifestRuntime?.["sound"] === "boolean" ? manifestRuntime["sound"] as boolean : true;
  const manifestTheme = typeof manifestRuntime?.["theme"] === "string" ? String(manifestRuntime["theme"]) : "dark";
  return {
    sound: options.sound ?? manifestSound,
    theme: options.theme ?? manifestTheme,
    difficulty: options.difficulty,
    redirectUrl: options.redirectUrl || canonicalOrigin,
    supportEmail: options.supportEmail || "support@cavbot.io",
    ctaUrl: origin,
    gameSlug,
    manifestRuntime,
  };
}

export async function GET(req: NextRequest, ctx: { env?: RateLimitEnv }) {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }

  const url = new URL(req.url);
  const envKind = normalizeKind(url.searchParams.get("env") || url.searchParams.get("kind"));
  const verification = await verifyEmbedRequest({
    req,
    env: ctx.env,
    requiredScopes: ["arcade:read"],
  });

  if (!verification.ok) {
    return NextResponse.json(
      { ok: false, allowed: false, code: verification.code },
      {
        status: verification.status,
        headers: corsHeaders(verification.origin ?? req.headers.get("origin")),
      }
    );
  }

  const responseOrigin = verification.origin ?? req.headers.get("origin") ?? "";
  const canonicalOrigin = verification.siteOrigin || responseOrigin;
  const siteId = verification.siteId;
  const accountRecord = await prisma.account.findUnique({
    where: { id: verification.accountId },
    select: {
      tier: true,
      trialSeatActive: true,
      trialEndsAt: true,
      trialEverUsed: true,
    },
  });

  const tier = resolveTierFromAccount(accountRecord ?? null);
  const gateResult = planAllowsArcade(tier);
  await recordEmbedMetric({
    accountId: verification.accountId,
    projectId: verification.projectId,
    siteId,
    keyId: verification.keyId,
    allowed: gateResult.allowed,
  });

  const allowedGames = getAllowedArcadeGames(tier);
  const allowedSet = new Set(allowedGames);

  if (!gateResult.allowed) {
    return NextResponse.json(
      {
        ok: true,
        allowed: false,
        gated: true,
        gate: {
          upsellTier: gateResult.gate.upsellTier,
          reasonTitle: gateResult.gate.reasonTitle,
          reasonBody: gateResult.gate.reasonBody,
        },
      },
      {
        status: 200,
        headers: corsHeaders(responseOrigin),
      }
    );
  }

  const arcadeConfig = await prisma.siteArcadeConfig.findUnique({
    where: { siteId },
  });
  if (!arcadeConfig || !arcadeConfig.enabled) {
    return NextResponse.json(
      { ok: true, allowed: gateResult.allowed, enabled: false },
      { status: 200, headers: corsHeaders(responseOrigin) }
    );
  }

  const runtimeOptions = mergeArcadeOptions(
    arcadeConfig.optionsJson as Partial<SiteArcadeOptions> | undefined
  );

  const preferredGame =
    arcadeConfig.gameSlug && arcadeConfig.gameVersion
      ? findArcadeGame(ARCADE_KIND_404, arcadeConfig.gameSlug, arcadeConfig.gameVersion)
      : null;

  let game = preferredGame ?? pickArcadeGame(envKind, siteId);
  if (!game) {
    return NextResponse.json(
      { ok: false, allowed: false, code: "GAME_NOT_FOUND" },
      { status: 404, headers: corsHeaders(responseOrigin) }
    );
  }
  if (!allowedSet.has(game.slug)) {
    const fallbackSlug = allowedGames[0];
    if (!fallbackSlug) {
      return NextResponse.json(
        { ok: true, allowed: false, enabled: true, code: "ARCADE_TIER_LOCKED" },
        { status: 200, headers: corsHeaders(responseOrigin) }
      );
    }
    const fallbackGame = getArcadeGames(ARCADE_KIND_404).find((entry) => entry.slug === fallbackSlug);
    if (!fallbackGame) {
      return NextResponse.json(
        { ok: true, allowed: false, enabled: true, code: "ARCADE_TIER_LOCKED" },
        { status: 200, headers: corsHeaders(responseOrigin) }
      );
    }
    game = fallbackGame;
  }

  const now = new Date();
  const nowMs = now.getTime();
  const ipHash = hashValue(pickRequestIp(req));
  const uaHash = hashValue(pickUserAgent(req));
  const dedupeKey = `arcade:${siteId}:${canonicalOrigin}:${game.slug}`;

  const existingInstall = await prisma.embedInstall.findFirst({
    where: {
      siteId,
      origin: canonicalOrigin,
      kind: EmbedInstallKind.ARCADE,
      style: game.slug,
    },
  });

  const firstDetected = !existingInstall;
  const reactivated =
    existingInstall?.lastSeenAt instanceof Date && nowMs - existingInstall.lastSeenAt.getTime() >= REACTIVATION_WINDOW_MS;
  const recentlyNotified =
    existingInstall?.lastNotifiedAt instanceof Date && nowMs - existingInstall.lastNotifiedAt.getTime() < DEDUPE_WINDOW_MS;
  let shouldNotify = (firstDetected || reactivated) && !recentlyNotified;

  if (shouldNotify) {
    const recentNotice = await prisma.workspaceNotice.findFirst({
      where: {
        dedupeKey,
        createdAt: {
          gte: new Date(nowMs - DEDUPE_WINDOW_MS),
        },
      },
    });
    if (recentNotice) {
      shouldNotify = false;
    }
  }

  let installId: string | null = existingInstall?.id ?? null;
  if (existingInstall) {
    const updated = await prisma.embedInstall.update({
      where: { id: existingInstall.id },
      data: {
        style: game.slug,
        position: game.version,
        theme: envKind,
        lastSeenAt: now,
        lastSeenIpHash: ipHash,
        lastUserAgentHash: uaHash,
        seenCount: { increment: 1 },
        status: EmbedInstallStatus.ACTIVE,
      },
    });
    installId = updated.id;
  } else {
    const created = await prisma.embedInstall.create({
      data: {
        accountId: verification.accountId,
        projectId: verification.projectId,
        siteId,
        origin: canonicalOrigin,
        kind: EmbedInstallKind.ARCADE,
        widgetType: null,
        style: game.slug,
        position: game.version,
        theme: envKind,
        firstSeenAt: now,
        lastSeenAt: now,
        lastSeenIpHash: ipHash,
        lastUserAgentHash: uaHash,
        status: EmbedInstallStatus.ACTIVE,
        seenCount: 1,
      },
    });
    installId = created.id;
  }

  if (shouldNotify && installId) {
    const actionLabel = `Arcade connection detected — ${game.displayName}`;
    const meta: Record<string, unknown> = {
      origin: canonicalOrigin,
      siteId,
      gameSlug: game.slug,
      gameVersion: game.version,
      gameDisplayName: game.displayName,
      surfaceName: game.displayName,
      kind: envKind,
      verificationMethod: "embed_config",
    };
    if (verification.keyLast4) {
      meta.keyLast4 = verification.keyLast4;
    }

    const notificationBody = `Arcade loader connected · ${canonicalOrigin}`;

    try {
      await Promise.all([
        auditLogWrite({
          request: req,
          accountId: verification.accountId,
          action: "INTEGRATION_CONNECTED",
          category: "system",
          severity: "info",
          actionLabel,
          targetType: "site",
          targetId: siteId,
          targetLabel: verification.siteOrigin,
          metaJson: meta,
        }),
        prisma.workspaceNotice.create({
          data: {
            accountId: verification.accountId,
            projectId: verification.projectId,
            siteId,
            tone: NoticeTone.GOOD,
            title: "Arcade detected",
            body: notificationBody,
            meta: meta as Prisma.InputJsonValue,
            dedupeKey,
          },
        }),
        prisma.siteEvent.create({
          data: {
            siteId,
            type: "INTEGRATION_CONNECTED",
            message: `Arcade loader connected · ${game.displayName}`,
            tone: NoticeTone.GOOD,
            meta: meta as Prisma.InputJsonValue,
          },
        }),
        prisma.embedInstall.update({
          where: { id: installId },
          data: {
            lastNotifiedAt: now,
          },
        }),
      ]);
    } catch (error) {
      console.error("[embed/arcade/config] install notification failed", error);
    }
  }

  const embedApiBase = getEmbedApiBase();
  const devHost = getLocalArcadeHost();
  const allowLocalDevAssets = String(process.env.CAVBOT_ARCADE_DEV_LOCAL_ASSETS || "").trim() === "1";
  const isDevMode = process.env.NODE_ENV !== "production" && allowLocalDevAssets && Boolean(devHost);

  let indexUrl: string;
  let manifestUrl: string;
  const delivery: Record<string, unknown> = { method: isDevMode ? "dev" : "signed" };

  if (isDevMode) {
    const base = `${devHost}/cavbot-arcade${game.basePath}`;
    indexUrl = `${base}/index.html`;
    manifestUrl = `${base}/manifest.json`;
    delivery.host = devHost;
  } else {
    const ttlSeconds = 240;
    const token = mintArcadeAssetToken({ origin: canonicalOrigin, basePath: game.basePath, ttlSeconds });
    const signedRoot = `${embedApiBase}/api/embed/arcade/signed/${token}`;
    indexUrl = `${signedRoot}${game.basePath}/index.html`;
    manifestUrl = `${signedRoot}${game.basePath}/manifest.json`;
    delivery.host = embedApiBase;
    delivery.expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  }

  const payload = {
    ok: true,
    enabled: true,
    game: {
      slug: game.slug,
      version: game.version,
      displayName: game.displayName,
    },
    urls: {
      index: indexUrl,
      manifest: manifestUrl,
    },
    runtime: buildRuntimeConfig(
      game.slug,
      game.manifest.runtime,
      canonicalOrigin,
      runtimeOptions,
      canonicalOrigin
    ),
    delivery,
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: corsHeaders(responseOrigin),
  });
}
