import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { AI_NO_STORE_HEADERS, aiErrorResponse, aiJson } from "@/app/api/ai/_shared";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedFormData } from "@/lib/security/userInput";
import { runAudioTranscription } from "@/src/lib/ai/ai.service";
import {
  ALIBABA_QWEN_ASR_MODEL_ID,
  ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
} from "@/src/lib/ai/model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 10_000_000;
const MAX_PROMPT_CHARS = 2_000;
const MAX_LANGUAGE_CHARS = 20;

const ALLOWED_AUDIO_EXTENSIONS = new Set([
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "wav",
  "webm",
  "ogg",
  "flac",
  "aac",
]);

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function hasAllowedAudioType(file: File): boolean {
  const mime = s(file.type).toLowerCase();
  if (mime.startsWith("audio/")) return true;
  const extension = s(file.name).toLowerCase().split(".").pop() || "";
  if (ALLOWED_AUDIO_EXTENSIONS.has(extension)) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const isStatusProbe = req.headers.get("x-cavbot-status-probe") === "1";

  try {
    if (isStatusProbe) {
      return aiJson({ ok: true, requestId, probe: "ai_transcribe", accepted: true }, 200);
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

    const form = await readSanitizedFormData(req, null);
    if (!form) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid multipart payload.",
        },
        400
      );
    }

    const fileField = form.get("file");
    const file = fileField instanceof File ? fileField : null;
    if (!file) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "AUDIO_FILE_REQUIRED",
          message: "Audio file is required.",
        },
        400
      );
    }

    if (!hasAllowedAudioType(file)) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "AUDIO_TYPE_UNSUPPORTED",
          message: "Unsupported audio format. Use mp3, wav, m4a, webm, ogg, flac, mp4, or aac.",
        },
        415
      );
    }

    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_AUDIO_BYTES) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "AUDIO_SIZE_INVALID",
          message: `Audio file size must be between 1 byte and ${MAX_AUDIO_BYTES} bytes.`,
        },
        400
      );
    }

    const model = s(form.get("model")) || undefined;
    const allowedModels = new Set([ALIBABA_QWEN_ASR_REALTIME_MODEL_ID, ALIBABA_QWEN_ASR_MODEL_ID]);
    if (model && !allowedModels.has(model)) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "MODEL_NOT_ALLOWED",
          message: `Allowed transcription models: "${ALIBABA_QWEN_ASR_REALTIME_MODEL_ID}" and "${ALIBABA_QWEN_ASR_MODEL_ID}".`,
        },
        400
      );
    }

    const prompt = s(form.get("prompt"));
    if (prompt.length > MAX_PROMPT_CHARS) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "PROMPT_TOO_LONG",
          message: `prompt must be <= ${MAX_PROMPT_CHARS} characters.`,
        },
        400
      );
    }

    const language = s(form.get("language"));
    if (language.length > MAX_LANGUAGE_CHARS) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "LANGUAGE_TOO_LONG",
          message: `language must be <= ${MAX_LANGUAGE_CHARS} characters.`,
        },
        400
      );
    }

    const workspaceId = s(form.get("workspaceId")) || undefined;
    const projectId = toPositiveInt(form.get("projectId"));
    const origin = s(form.get("origin")) || undefined;

    const result = await runAudioTranscription({
      req,
      requestId,
      input: {
        file,
        model,
        prompt: prompt || undefined,
        language: language || undefined,
        workspaceId,
        projectId: projectId || undefined,
        origin,
      },
    });

    if (!result.ok) return aiJson(result, result.status || 502);
    return aiJson(result, 200);
  } catch (error) {
    console.error("[api/ai/transcribe] request failed", {
      requestId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
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
