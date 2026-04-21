import "server-only";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { NoticeTone } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import {
  WidgetType,
  WidgetStyle,
  WidgetPosition,
  STYLE_OPTIONS,
} from "@/lib/settings/snippetGenerators";
import { verifyEmbedRequest } from "@/lib/security/embedVerifier";
import { recordEmbedMetric } from "@/lib/security/embedMetrics.server";
import { gateCopy, resolveTierFromAccount, widgetFeatureFromWidget } from "@/lib/billing/featureGates";
import { RateLimitEnv } from "@/rateLimit";
import { auditLogWrite } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { mintEmbedToken } from "@/lib/security/embedToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

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

function normalizeWidget(widget: string | null | undefined): WidgetType {
  const value = String(widget || "badge").toLowerCase();
  const valid: WidgetType[] = ["badge", "head", "body"];
  return valid.includes(value as WidgetType) ? (value as WidgetType) : "badge";
}

function normalizeStyle(widget: WidgetType, style: string | null | undefined): WidgetStyle {
  const normalized = String(style || "").toLowerCase();
  const options = STYLE_OPTIONS[widget];
  return options.includes(normalized as WidgetStyle) ? (normalized as WidgetStyle) : options[0];
}

function normalizePosition(value: string | null | undefined): WidgetPosition {
  const normalized = String(value || "").toLowerCase();
  const positions: WidgetPosition[] = [
    "bottom-right",
    "bottom-left",
    "top-right",
    "top-left",
    "center",
    "center-left",
    "center-right",
    "inline",
  ];
  return positions.includes(normalized as WidgetPosition)
    ? (normalized as WidgetPosition)
    : "bottom-right";
}

function normalizeTheme(value: string | null | undefined) {
  const normalized = String(value || "").toLowerCase();
  return normalized === "dark" || normalized === "light" ? normalized : "auto";
}

function buildResponsePayload(
  config: {
    widget: WidgetType;
    style: WidgetStyle;
    position: WidgetPosition;
    theme: string;
  },
  installDetectedToken?: string | null
): {
  allowed: true;
  gated: false;
  config: {
    widget: WidgetType;
    style: WidgetStyle;
    position: WidgetPosition;
    theme: string;
    zIndex: number;
    motionAllowed: boolean;
  };
  featureFlags: { bodyAllowed: boolean };
  installDetectedToken: string | null;
} {
  const motionAllowed = config.widget === "head" || config.widget === "body";
  return {
    allowed: true,
    gated: false,
    config: {
      widget: config.widget,
      style: config.style,
      position: config.position,
      theme: config.theme,
      zIndex: 9999,
      motionAllowed,
    },
    featureFlags: {
      bodyAllowed: config.widget === "body",
    },
    installDetectedToken: installDetectedToken ?? null,
  };
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

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const REACTIVATION_WINDOW_MS = 30 * DEDUPE_WINDOW_MS;
const TOKEN_TTL_SECONDS = 600;

const ACTION_LABELS: Record<string, string> = {
  "badge:inline": "Connection detected — Badge (Inline)",
  "badge:ring": "Connection detected — Badge (Ring)",
  "head:orbit": "Connection detected — Head (Orbit)",
  "body:full": "Connection detected — Full body",
};

const SUMMARY_STYLE_LABELS: Record<WidgetStyle, string> = {
  inline: "Inline",
  ring: "Ring",
  orbit: "Orbit",
  full: "Full body",
};

const SUMMARY_WIDGET_LABELS: Record<WidgetType, string> = {
  badge: "Badge",
  head: "Head",
  body: "Body",
};

const IP_HEADERS = ["cf-connecting-ip", "true-client-ip", "x-forwarded-for", "x-real-ip"];

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

function buildActionLabel(widgetType: WidgetType, style: WidgetStyle) {
  const key = `${widgetType}:${style}`;
  if (ACTION_LABELS[key]) return ACTION_LABELS[key];
  const widgetLabel = SUMMARY_WIDGET_LABELS[widgetType] || widgetType;
  const styleLabel = SUMMARY_STYLE_LABELS[style] || style;
  return `Connection detected — ${widgetLabel} (${styleLabel})`;
}

function buildSummaryLabel(widgetType: WidgetType, style: WidgetStyle) {
  const widgetLabel = SUMMARY_WIDGET_LABELS[widgetType] || widgetType;
  const styleLabel = SUMMARY_STYLE_LABELS[style] || style;
  return `${widgetLabel} · ${styleLabel}`;
}

export async function GET(req: NextRequest, ctx: { env?: RateLimitEnv }) {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }

  const url = new URL(req.url);
  const widget = normalizeWidget(url.searchParams.get("widget"));
  const style = normalizeStyle(widget, url.searchParams.get("style"));
  const position = normalizePosition(url.searchParams.get("position"));
  const theme = normalizeTheme(url.searchParams.get("theme"));

  const verification = await verifyEmbedRequest({ req, env: ctx.env, recordMetrics: false });
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
    },
  });
  const tier = resolveTierFromAccount(accountRecord ?? null);
  const requestedFeature = widgetFeatureFromWidget(widget, style);
  const gateResult = gateCopy(tier, requestedFeature);

  await recordEmbedMetric({
    accountId: verification.accountId,
    projectId: verification.projectId,
    siteId,
    keyId: verification.keyId,
    allowed: gateResult.allowed,
  });

  if (!gateResult.allowed) {
    return NextResponse.json(
      {
        ok: true,
        allowed: false,
        gated: true,
        gate: {
          upsellTier: gateResult.upsellTier,
          reasonTitle: gateResult.reasonTitle,
          reasonBody: gateResult.reasonBody,
        },
      },
      {
        status: 200,
        headers: corsHeaders(responseOrigin),
      }
    );
  }
  const now = new Date();
  const nowMs = now.getTime();
  const ipHash = hashValue(pickRequestIp(req));
  const uaHash = hashValue(pickUserAgent(req));
  const dedupeKey = `${siteId}:${canonicalOrigin}:${widget}:${style}`;

  const existingInstall = await prisma.embedInstall.findFirst({
    where: {
      siteId,
      origin: canonicalOrigin,
      kind: "WIDGET",
      widgetType: widget,
      style,
    },
  });

  const firstDetected = !existingInstall;
  const reactivated =
    existingInstall?.lastSeenAt instanceof Date &&
    nowMs - existingInstall.lastSeenAt.getTime() >= REACTIVATION_WINDOW_MS;
  const recentlyNotified =
    existingInstall?.lastNotifiedAt instanceof Date &&
    nowMs - existingInstall.lastNotifiedAt.getTime() < DEDUPE_WINDOW_MS;
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

  let installId = existingInstall?.id;
  if (existingInstall) {
    const updated = await prisma.embedInstall.update({
      where: { id: existingInstall.id },
      data: {
        position,
        theme,
        lastSeenAt: now,
        lastSeenIpHash: ipHash,
        lastUserAgentHash: uaHash,
        seenCount: { increment: 1 },
        status: "ACTIVE",
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
        kind: "WIDGET",
        widgetType: widget,
        style,
        position,
        theme,
        firstSeenAt: now,
        lastSeenAt: now,
        lastSeenIpHash: ipHash,
        lastUserAgentHash: uaHash,
        status: "ACTIVE",
        seenCount: 1,
      },
    });
    installId = created.id;
  }

  if (shouldNotify) {
    if (!installId) {
      console.warn("[embed/widget/config] missing install identifier for notification");
    }
  }

  if (shouldNotify && installId) {
    const summary = buildSummaryLabel(widget, style);
    const actionLabel = buildActionLabel(widget, style);
    const meta: Record<string, unknown> = {
      origin: canonicalOrigin,
      siteId,
      widgetType: widget,
      style,
      position,
      theme,
      verificationMethod: "embed_config",
    };
    if (verification.keyLast4) {
      meta.keyLast4 = verification.keyLast4;
    }

    const notificationBody = `Target: ${summary} · ${canonicalOrigin}`;

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
            title: "Connection detected",
            body: notificationBody,
            meta: meta as Prisma.InputJsonValue,
            dedupeKey,
          },
        }),
        prisma.siteEvent.create({
          data: {
            siteId,
            type: "INTEGRATION_CONNECTED",
            message: `Connection detected: ${summary}`,
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
      console.error("[embed/widget/config] install notification failed", error);
    }
  }

  let configToken: string | null = null;
  try {
    configToken = mintEmbedToken({
      sub: verification.keyId,
      accountId: verification.accountId,
      projectId: verification.projectId,
      siteId,
      origin: canonicalOrigin,
      keyId: verification.keyId,
      keyVersion: verification.keyVersion,
      scopes: verification.scopes,
      kind: "widget",
      ttlSeconds: TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    console.error("[embed/widget/config] token mint failed", error);
  }

  const payload = buildResponsePayload({ widget, style, position, theme }, configToken);
  return NextResponse.json(
    payload,
    {
      status: 200,
        headers: corsHeaders(responseOrigin),
    }
  );
}
