import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AI_NO_STORE_HEADERS, aiErrorResponse, aiJson } from "@/app/api/ai/_shared";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import { runTextToSpeech } from "@/src/lib/ai/ai.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTS_REQUEST_SCHEMA = z.object({
  text: z.string().trim().min(1).max(8_000),
  model: z.string().trim().max(120).optional(),
  voice: z.string().trim().max(120).optional(),
  instructions: z.string().trim().max(2_000).optional(),
  format: z.enum(["mp3", "wav", "pcm"]).optional(),
  workspaceId: z.string().trim().max(120).optional(),
  projectId: z.number().int().positive().optional(),
  origin: z.string().trim().max(2_000).optional(),
});

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const isStatusProbe = req.headers.get("x-cavbot-status-probe") === "1";

  try {
    if (isStatusProbe) {
      return aiJson({ ok: true, requestId, probe: "ai_tts", accepted: true }, 200);
    }

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

    const bodyRaw = await readSanitizedJson(req, null);
    const parsed = TTS_REQUEST_SCHEMA.safeParse(bodyRaw);
    if (!parsed.success) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid text-to-speech payload.",
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const speech = await runTextToSpeech({
      req,
      requestId,
      input: parsed.data,
    });

    const audioBody = Buffer.from(speech.audioBuffer);
    return new NextResponse(audioBody, {
      status: 200,
      headers: {
        ...AI_NO_STORE_HEADERS,
        "Content-Type": speech.contentType || "audio/mpeg",
        "Content-Length": String(audioBody.byteLength),
        "x-ai-provider": speech.providerId,
        "x-ai-model": speech.model,
      },
    });
  } catch (error) {
    return aiErrorResponse(error, requestId);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...AI_NO_STORE_HEADERS,
      Allow: "POST, OPTIONS",
    },
  });
}
