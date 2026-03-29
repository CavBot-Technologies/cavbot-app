import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AI_NO_STORE_HEADERS, aiErrorResponse, aiJson } from "@/app/api/ai/_shared";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import { AiServiceError } from "@/src/lib/ai/ai.types";
import { ALIBABA_QWEN_FLASH_MODEL_ID, resolveAiModelLabel } from "@/src/lib/ai/model-catalog";
import { assertAiProviderReady, getAiProvider, resolveProviderIdForModel } from "@/src/lib/ai/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_ASSIST_REQUEST_SCHEMA = z.object({
  action: z.literal("technical_recap").optional(),
  surface: z.literal("general").optional(),
  prompt: z.string().trim().min(1).max(12_000),
  sessionId: z.string().trim().max(120).optional(),
  contextLabel: z.string().trim().max(220).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

type PreviewTurn = {
  role: "user" | "assistant";
  text: string;
};

type PreviewSession = {
  updatedAtMs: number;
  turns: PreviewTurn[];
};

const previewSessions = new Map<string, PreviewSession>();
const PREVIEW_SESSION_TTL_MS = 1000 * 60 * 45;
const PREVIEW_SESSION_MAX_TURNS = 14;
const PREVIEW_RATE_LIMIT = 18;
const PREVIEW_RATE_WINDOW_MS = 60_000;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toPreviewSessionId(value: unknown): string {
  const normalized = s(value).toLowerCase();
  if (!normalized) return "";
  if (!/^[a-z0-9][a-z0-9_-]{5,119}$/.test(normalized)) return "";
  return normalized;
}

function createPreviewSessionId() {
  return `guest_preview_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function cleanupExpiredPreviewSessions() {
  const now = Date.now();
  for (const [sessionId, row] of previewSessions.entries()) {
    if (now - row.updatedAtMs > PREVIEW_SESSION_TTL_MS) {
      previewSessions.delete(sessionId);
    }
  }
}

function toClientRateKey(req: NextRequest): string {
  const forwardedFor = s(req.headers.get("x-forwarded-for")).split(",")[0]?.trim() || "";
  const realIp = s(req.headers.get("x-real-ip"));
  const ua = s(req.headers.get("user-agent")).slice(0, 120).toLowerCase();
  return ["cavai_preview", forwardedFor || realIp || "unknown", ua || "ua"].join(":");
}

function buildTranscript(turns: PreviewTurn[], contextTranscript: string, nextPrompt: string): string {
  const rows = turns
    .slice(-10)
    .map((row) => `${row.role === "user" ? "User" : "Assistant"}: ${s(row.text)}`)
    .filter(Boolean);
  const context = s(contextTranscript);
  if (context) rows.unshift(`Context transcript:\n${context}`);
  rows.push(`User: ${s(nextPrompt)}`);
  return rows.join("\n\n").slice(0, 7_500);
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  try {
    if (!hasRequestIntegrityHeader(req)) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "BAD_CSRF",
          message: "Missing request integrity header.",
        },
        403
      );
    }

    const rate = consumeInMemoryRateLimit({
      key: toClientRateKey(req),
      limit: PREVIEW_RATE_LIMIT,
      windowMs: PREVIEW_RATE_WINDOW_MS,
    });
    if (!rate.allowed) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "RATE_LIMITED",
          message: `Too many preview requests. Retry in ${rate.retryAfterSec}s.`,
        },
        429
      );
    }

    const bodyRaw = await readSanitizedJson(req, null);
    const parsed = PREVIEW_ASSIST_REQUEST_SCHEMA.safeParse(bodyRaw);
    if (!parsed.success) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid CavAi preview payload.",
          details: parsed.error.flatten(),
        },
        400
      );
    }

    cleanupExpiredPreviewSessions();

    const prompt = s(parsed.data.prompt);
    const context = parsed.data.context && typeof parsed.data.context === "object" && !Array.isArray(parsed.data.context)
      ? (parsed.data.context as Record<string, unknown>)
      : {};
    const contextTranscript = s(context.transcript).slice(0, 6_000);

    const requestedSessionId = toPreviewSessionId(parsed.data.sessionId);
    const sessionId = requestedSessionId || createPreviewSessionId();
    const existingTurns = previewSessions.get(sessionId)?.turns || [];
    const transcript = buildTranscript(existingTurns, contextTranscript, prompt);

    const providerId = resolveProviderIdForModel(ALIBABA_QWEN_FLASH_MODEL_ID, "alibaba_qwen");
    assertAiProviderReady(providerId);
    const provider = getAiProvider(providerId);

    const completion = await provider.generate({
      model: ALIBABA_QWEN_FLASH_MODEL_ID,
      messages: [
        {
          role: "system",
          content: [
            "You are CavAi preview mode for unauthenticated users.",
            "Use concise, practical answers.",
            "If the request needs locked features (uploads, advanced models, deep reasoning), explain the limitation briefly.",
            "Do not invent citations or product capabilities.",
          ].join("\n"),
        },
        {
          role: "user",
          content: transcript,
        },
      ],
      responseFormat: { type: "text" },
      temperature: 0.35,
      maxTokens: 1_200,
      reasoningEffort: "low",
      timeoutMs: 28_000,
      signal: req.signal,
      metadata: {
        surface: "cavai_preview",
        action: "technical_recap",
        mode: "guest",
      },
    });

    const answer = s(completion.content);
    if (!answer) {
      throw new AiServiceError(
        "EMPTY_PREVIEW_RESPONSE",
        "CavAi preview returned an empty response.",
        502
      );
    }

    const nextTurns = [
      ...existingTurns,
      { role: "user" as const, text: prompt },
      { role: "assistant" as const, text: answer },
    ].slice(-PREVIEW_SESSION_MAX_TURNS);
    previewSessions.set(sessionId, {
      updatedAtMs: Date.now(),
      turns: nextTurns,
    });

    return aiJson(
      {
        ok: true,
        requestId,
        providerId,
        model: completion.model || ALIBABA_QWEN_FLASH_MODEL_ID,
        sessionId,
        data: {
          summary: "Preview response generated.",
          risk: "low",
          answer,
          recommendations: [
            "Sign in to unlock full CavAi model controls, uploads, and advanced reasoning.",
          ],
          notes: [
            `Model: ${resolveAiModelLabel(ALIBABA_QWEN_FLASH_MODEL_ID)} (preview).`,
            "Guest preview keeps advanced controls locked.",
          ],
          followUpChecks: [
            "Use a follow-up prompt to refine output if needed.",
          ],
          evidenceRefs: [],
        },
      },
      200
    );
  } catch (error) {
    return aiErrorResponse(error, requestId);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...AI_NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}
