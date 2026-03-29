import "server-only";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  isApiAuthError,
} from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { mintCavAiSessionShareToken } from "@/lib/cavai/sessionShareTokens.server";
import {
  getAiSessionForAccount,
  getAiSessionMetaForAccount,
} from "@/src/lib/ai/ai.memory";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import { resolveAiExecutionPolicy } from "@/src/lib/ai/ai.policy";
import { AiServiceError } from "@/src/lib/ai/ai.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(payload: unknown, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toGuardSurface(surface: string): "console" | "cavcloud" | "cavsafe" | "cavpad" | "cavcode" {
  const raw = s(surface).toLowerCase();
  if (raw === "cavcloud" || raw === "cavsafe" || raw === "cavpad" || raw === "cavcode") return raw;
  return "console";
}

function guardActionForSurface(surface: "console" | "cavcloud" | "cavsafe" | "cavpad" | "cavcode"): string {
  if (surface === "cavcode") return "explain_error";
  if (surface === "cavcloud") return "recommend_organization";
  if (surface === "cavsafe") return "explain_access_state";
  if (surface === "cavpad") return "technical_summary";
  return "summarize_posture";
}

function appOrigin(req: NextRequest): string {
  const env = s(process.env.NEXT_PUBLIC_APP_URL || process.env.CAVBOT_APP_ORIGIN);
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      // fall through
    }
  }
  return new URL(req.url).origin;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function buildInternalSessionUrl(args: {
  req: NextRequest;
  session: {
    id: string;
    surface: string;
    contextLabel: string | null;
    workspaceId: string | null;
    projectId: number | null;
    origin: string | null;
  };
}) {
  const qp = new URLSearchParams();
  qp.set("surface", s(args.session.surface) || "workspace");
  if (s(args.session.contextLabel)) qp.set("context", s(args.session.contextLabel));
  if (s(args.session.workspaceId)) qp.set("workspaceId", s(args.session.workspaceId));
  if (Number.isFinite(Number(args.session.projectId)) && Number(args.session.projectId) > 0) {
    qp.set("projectId", String(Math.trunc(Number(args.session.projectId))));
  }
  if (s(args.session.origin)) qp.set("origin", s(args.session.origin));
  qp.set("sessionId", s(args.session.id));
  return `${appOrigin(args.req)}/cavai?${qp.toString()}`;
}

export async function POST(
  req: NextRequest,
  ctx: {
    params: Promise<{
      sessionId?: string;
    }>;
  }
) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  try {
    if (!hasRequestIntegrityHeader(req)) {
      return json(
        {
          ok: false,
          requestId,
          error: "BAD_CSRF",
          message: "Missing request integrity header.",
        },
        403
      );
    }

    const params = await ctx.params;
    const sessionId = s(params.sessionId);
    if (!sessionId) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "sessionId is required.",
        },
        400
      );
    }

    const bodyRaw = await readSanitizedJson(req, null);
    const body = bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
      ? (bodyRaw as Record<string, unknown>)
      : {};
    const mode = s(body.mode).toLowerCase() === "external" ? "external" : "internal";
    const targetIdentity = s(body.targetIdentity).replace(/^@+/, "");

    const aiCtx = await requireAiRequestContext({
      req,
      surface: "console",
    });
    const session = await getAiSessionForAccount({
      accountId: aiCtx.accountId,
      sessionId,
    });
    const sessionMeta = await getAiSessionMetaForAccount({
      accountId: aiCtx.accountId,
      sessionId,
    });

    const guardSurface = toGuardSurface(session.surface);
    await resolveAiExecutionPolicy({
      accountId: aiCtx.accountId,
      userId: aiCtx.userId,
      memberRole: aiCtx.memberRole,
      planId: aiCtx.planId,
      surface: guardSurface,
      action: guardActionForSurface(guardSurface),
      requestedModel: null,
      requestedReasoningLevel: "low",
      promptText: "session_share_access",
      context: {
        shareMode: mode,
      },
      imageAttachmentCount: 0,
      sessionId: null,
      isExecution: false,
    });

    const internalUrl = buildInternalSessionUrl({
      req,
      session: {
        id: session.id,
        surface: session.surface,
        contextLabel: session.contextLabel,
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        origin: session.origin,
      },
    });

    let deliveredTo: { id: string; label: string } | null = null;
    if (targetIdentity && mode === "internal") {
      const identityLower = targetIdentity.toLowerCase();
      const member = await prisma.membership.findFirst({
        where: {
          accountId: aiCtx.accountId,
          user: {
            OR: [
              { username: identityLower },
              { email: identityLower },
            ],
          },
        },
        select: {
          userId: true,
          user: {
            select: {
              username: true,
              email: true,
            },
          },
        },
      });
      if (member && s(member.userId) && s(member.userId) !== s(aiCtx.userId)) {
        const label = s(member.user.username) || s(member.user.email) || member.userId;
        await prisma.notification.create({
          data: {
            userId: member.userId,
            accountId: aiCtx.accountId,
            title: "CavAi conversation shared with you",
            body: `${s(sessionMeta.title) || "Untitled chat"} was shared with you in CavAi.`,
            href: internalUrl,
            kind: "CAVAI_SESSION_SHARE",
            tone: "GOOD",
            metaJson: {
              sessionId: session.id,
              sharedByUserId: aiCtx.userId,
              surface: session.surface,
            } as unknown as object,
          },
        });
        deliveredTo = {
          id: member.userId,
          label,
        };
      }
    }

    if (mode === "external") {
      const token = mintCavAiSessionShareToken({
        accountId: aiCtx.accountId,
        sessionId: session.id,
        ttlSeconds: 60 * 60 * 24 * 7,
      });
      const externalUrl = `${appOrigin(req)}/share/cavai/${encodeURIComponent(token)}`;
      await prisma.cavAiShareArtifact.create({
        data: {
          accountId: aiCtx.accountId,
          userId: aiCtx.userId,
          sessionId: session.id,
          mode: "external",
          targetIdentity: targetIdentity || null,
          internalUrl,
          externalUrl,
          externalTokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + (60 * 60 * 24 * 7 * 1000)),
        },
      });
      return json(
        {
          ok: true,
          requestId,
          mode,
          sessionId,
          internalUrl,
          externalUrl,
        },
        200
      );
    }

    await prisma.cavAiShareArtifact.create({
      data: {
        accountId: aiCtx.accountId,
        userId: aiCtx.userId,
        sessionId: session.id,
        mode: "internal",
        targetIdentity: targetIdentity || null,
        internalUrl,
      },
    });

    return json(
      {
        ok: true,
        requestId,
        mode,
        sessionId,
        internalUrl,
        deliveredTo,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, requestId, error: error.code }, error.status);
    if (error instanceof AiServiceError) {
      const details = error.details;
      const guardDecision =
        details && typeof details === "object" && !Array.isArray(details)
          ? (details as { guardDecision?: unknown }).guardDecision
          : null;
      return json(
        {
          ok: false,
          requestId,
          error: error.code,
          message: error.message,
          ...(guardDecision && typeof guardDecision === "object" ? { guardDecision } : {}),
          ...(process.env.NODE_ENV !== "production" ? { details: error.details } : {}),
        },
        error.status
      );
    }
    const message = error instanceof Error ? error.message : "Server error";
    return json(
      {
        ok: false,
        requestId,
        error: "SERVER_ERROR",
        ...(process.env.NODE_ENV !== "production" ? { message } : {}),
      },
      500
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}
