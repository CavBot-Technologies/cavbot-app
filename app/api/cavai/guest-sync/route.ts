import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { isApiAuthError } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import { appendAiSessionTurn, createAiSession } from "@/src/lib/ai/ai.memory";
import type { AiCenterSurface } from "@/src/lib/ai/ai.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

const MAX_SYNC_SESSIONS = 60;
const MAX_SYNC_MESSAGES_PER_SESSION = 240;
const MAX_SYNC_MESSAGE_CHARS = 40_000;
const MAX_DB_REQUEST_ID_CHARS = 120;
const MAX_SYNC_TURNS_PER_BATCH = 48;

const SYNC_MESSAGE_SCHEMA = z.object({
  role: z.enum(["user", "assistant"]),
  action: z.string().trim().max(120).nullable().optional(),
  contentText: z.string().trim().max(MAX_SYNC_MESSAGE_CHARS),
  contentJson: z.record(z.string(), z.unknown()).nullable().optional(),
  provider: z.string().trim().max(32).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  status: z.string().trim().max(24).nullable().optional(),
  errorCode: z.string().trim().max(120).nullable().optional(),
  createdAt: z.string().trim().max(120).nullable().optional(),
});

const SYNC_SESSION_SCHEMA = z.object({
  localSessionId: z.string().trim().min(1).max(160),
  surface: z.enum(["general", "workspace", "console", "cavcloud", "cavsafe", "cavpad", "cavcode"]).default("general"),
  title: z.string().trim().max(220).optional(),
  contextLabel: z.string().trim().max(220).nullable().optional(),
  origin: z.string().trim().max(240).nullable().optional(),
  createdAt: z.string().trim().max(120).nullable().optional(),
  updatedAt: z.string().trim().max(120).nullable().optional(),
  preview: z.string().trim().max(800).nullable().optional(),
  messages: z.array(SYNC_MESSAGE_SCHEMA).min(1).max(MAX_SYNC_MESSAGES_PER_SESSION),
});

const SYNC_PAYLOAD_SHAPE_SCHEMA = z.object({
  sessions: z.array(z.unknown()).max(MAX_SYNC_SESSIONS),
});

type SyncMessageInput = z.infer<typeof SYNC_MESSAGE_SCHEMA>;
type SyncSessionInput = z.infer<typeof SYNC_SESSION_SCHEMA>;

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

function toSessionSurface(value: unknown): AiCenterSurface {
  const raw = s(value).toLowerCase();
  if (
    raw === "general"
    || raw === "workspace"
    || raw === "console"
    || raw === "cavcloud"
    || raw === "cavsafe"
    || raw === "cavpad"
    || raw === "cavcode"
  ) {
    return raw;
  }
  return "general";
}

function toSyncTurns(messages: SyncMessageInput[]): Array<{ user: SyncMessageInput; assistant: SyncMessageInput }> {
  const sorted = messages
    .map((message, index) => ({
      message,
      index,
      createdAtMs: Date.parse(s(message.createdAt)),
    }))
    .sort((left, right) => {
      const leftHasTs = Number.isFinite(left.createdAtMs);
      const rightHasTs = Number.isFinite(right.createdAtMs);
      if (leftHasTs && rightHasTs && left.createdAtMs !== right.createdAtMs) {
        return left.createdAtMs - right.createdAtMs;
      }
      if (leftHasTs && !rightHasTs) return -1;
      if (!leftHasTs && rightHasTs) return 1;
      return left.index - right.index;
    })
    .map((row) => row.message);

  const turns: Array<{ user: SyncMessageInput; assistant: SyncMessageInput }> = [];
  let pendingUser: SyncMessageInput | null = null;
  for (const row of sorted) {
    if (row.role === "user") {
      if (!s(row.contentText)) continue;
      pendingUser = row;
      continue;
    }
    if (row.role !== "assistant") continue;
    if (!pendingUser) continue;
    if (!s(row.contentText)) continue;
    turns.push({ user: pendingUser, assistant: row });
    pendingUser = null;
  }
  return turns;
}

function toLocalGuestSessionId(value: unknown): string {
  const localSessionId = s(value).toLowerCase();
  if (!localSessionId.startsWith("guest_preview_")) return "";
  return localSessionId.slice(0, 160);
}

function buildImportOrigin(localSessionId: string): string {
  return `guest_preview_import:${localSessionId}`.slice(0, 240);
}

function buildGuestSyncRequestId(localSessionId: string, turnIndex: number): string {
  const prefix = "guest_sync:";
  const safeIndex = Number.isFinite(turnIndex) ? Math.max(0, Math.trunc(turnIndex)) : 0;
  const suffix = `:${safeIndex}`;
  const baseBudget = MAX_DB_REQUEST_ID_CHARS - prefix.length - suffix.length;
  const sessionSlice = Math.max(1, baseBudget);
  const safeSessionId = s(localSessionId).slice(0, sessionSlice) || "guest_preview";
  return `${prefix}${safeSessionId}${suffix}`.slice(0, MAX_DB_REQUEST_ID_CHARS);
}

function toSessionTitle(row: SyncSessionInput): string {
  const title = s(row.title);
  if (title) return title.slice(0, 220);
  const contextLabel = s(row.contextLabel);
  if (contextLabel) return contextLabel.slice(0, 220);
  return "Guest preview";
}

function toSessionContextLabel(row: SyncSessionInput): string {
  const contextLabel = s(row.contextLabel);
  if (contextLabel) return contextLabel.slice(0, 220);
  return "Guest preview";
}

export async function POST(req: NextRequest) {
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

    const ctx = await requireAiRequestContext({
      req,
      surface: "console",
    });

    const rawBody = await readSanitizedJson(req, null);
    const parsedPayloadShape = SYNC_PAYLOAD_SHAPE_SCHEMA.safeParse(rawBody);
    if (!parsedPayloadShape.success) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid guest sync payload.",
          details: parsedPayloadShape.error.flatten(),
        },
        400
      );
    }

    let importedSessions = 0;
    let reusedSessions = 0;
    let importedTurns = 0;
    let skippedSessions = 0;
    let skippedTurns = 0;
    const seenLocalSessionIds = new Set<string>();

    for (const rawSession of parsedPayloadShape.data.sessions) {
      const parsedSession = SYNC_SESSION_SCHEMA.safeParse(rawSession);
      if (!parsedSession.success) {
        skippedSessions += 1;
        continue;
      }
      const row = parsedSession.data;
      const localSessionId = toLocalGuestSessionId(row.localSessionId);
      if (!localSessionId) {
        skippedSessions += 1;
        continue;
      }
      if (seenLocalSessionIds.has(localSessionId)) continue;
      seenLocalSessionIds.add(localSessionId);

      const turns = toSyncTurns(row.messages);
      if (!turns.length) {
        skippedSessions += 1;
        continue;
      }

      try {
        const importOrigin = buildImportOrigin(localSessionId);
        const existingSession = await prisma.cavAiSession.findFirst({
          where: {
            accountId: ctx.accountId,
            userId: ctx.userId,
            origin: importOrigin,
          },
          orderBy: [{ updatedAt: "desc" }],
          select: { id: true },
        });

        let targetSessionId = s(existingSession?.id);
        if (targetSessionId) {
          reusedSessions += 1;
        } else {
          const created = await createAiSession({
            accountId: ctx.accountId,
            userId: ctx.userId,
            surface: toSessionSurface(row.surface),
            title: toSessionTitle(row),
            contextLabel: toSessionContextLabel(row),
            workspaceId: null,
            projectId: null,
            origin: importOrigin,
            contextJson: {
              source: "app.cavai",
              mode: "guest_preview_sync",
              guestPreviewSessionId: localSessionId,
              guestPreviewOrigin: s(row.origin) || "guest_preview",
              importedAt: new Date().toISOString(),
              preview: s(row.preview) || null,
              createdAt: s(row.createdAt) || null,
              updatedAt: s(row.updatedAt) || null,
            },
          });
          targetSessionId = created.id;
          importedSessions += 1;
        }

        const existingMessageCount = await prisma.cavAiMessage.count({
          where: {
            accountId: ctx.accountId,
            sessionId: targetSessionId,
          },
        });
        const startTurnIndex = Math.max(0, Math.min(turns.length, Math.floor(existingMessageCount / 2)));
        for (let offset = startTurnIndex; offset < turns.length; offset += MAX_SYNC_TURNS_PER_BATCH) {
          const chunk = turns.slice(offset, offset + MAX_SYNC_TURNS_PER_BATCH);
          if (!chunk.length) continue;

          const now = new Date();
          const messageRows: Array<{
            accountId: string;
            sessionId: string;
            role: "user" | "assistant";
            action: string | null;
            contentText: string;
            contentJson: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
            provider: string | null;
            model: string | null;
            requestId: string | null;
            status: string | null;
            errorCode: string | null;
            workspaceId: string | null;
            projectId: number | null;
            origin: string | null;
            createdByUser: string | null;
            createdAt: Date;
          }> = [];

          const validTurns: Array<{ index: number; turn: { user: SyncMessageInput; assistant: SyncMessageInput } }> = [];
          for (let index = 0; index < chunk.length; index += 1) {
            const absoluteTurnIndex = offset + index;
            const turn = chunk[index];
            const userText = s(turn.user.contentText).slice(0, MAX_SYNC_MESSAGE_CHARS);
            const assistantText = s(turn.assistant.contentText).slice(0, MAX_SYNC_MESSAGE_CHARS);
            if (!userText || !assistantText) {
              skippedTurns += 1;
              continue;
            }

            const action = s(turn.user.action || turn.assistant.action).slice(0, 120) || "technical_recap";
            const requestId = buildGuestSyncRequestId(localSessionId, absoluteTurnIndex);
            const status = s(turn.assistant.status).toUpperCase() === "ERROR" ? "ERROR" : "SUCCESS";
            const errorCode = status === "ERROR" ? (s(turn.assistant.errorCode).slice(0, 120) || "GUEST_PREVIEW_ERROR") : null;

            messageRows.push({
              accountId: ctx.accountId,
              sessionId: targetSessionId,
              role: "user",
              action,
              contentText: userText,
              contentJson:
                turn.user.contentJson && typeof turn.user.contentJson === "object"
                  ? turn.user.contentJson as Prisma.InputJsonValue
                  : Prisma.JsonNull,
              provider: null,
              model: null,
              requestId,
              status,
              errorCode: null,
              workspaceId: null,
              projectId: null,
              origin: importOrigin,
              createdByUser: ctx.userId,
              createdAt: now,
            });
            messageRows.push({
              accountId: ctx.accountId,
              sessionId: targetSessionId,
              role: "assistant",
              action,
              contentText: assistantText,
              contentJson:
                turn.assistant.contentJson && typeof turn.assistant.contentJson === "object"
                  ? turn.assistant.contentJson as Prisma.InputJsonValue
                  : Prisma.JsonNull,
              provider: s(turn.assistant.provider).slice(0, 32) || null,
              model: s(turn.assistant.model).slice(0, 120) || null,
              requestId,
              status,
              errorCode,
              workspaceId: null,
              projectId: null,
              origin: importOrigin,
              createdByUser: ctx.userId,
              createdAt: now,
            });

            validTurns.push({ index: absoluteTurnIndex, turn });
          }

          if (!messageRows.length) continue;

          try {
            await prisma.$transaction([
              prisma.cavAiMessage.createMany({ data: messageRows }),
              prisma.cavAiSession.update({
                where: { id: targetSessionId },
                data: {
                  lastMessageAt: now,
                  updatedAt: now,
                },
              }),
            ]);
            importedTurns += validTurns.length;
          } catch (batchError) {
            if (process.env.NODE_ENV !== "production") {
              console.error("[guest-sync] batch import failed; falling back to single-turn import", {
                localSessionId,
                sessionId: targetSessionId,
                startOffset: offset,
                error: batchError instanceof Error ? batchError.message : String(batchError),
              });
            }
            for (const row of validTurns) {
              const userText = s(row.turn.user.contentText).slice(0, MAX_SYNC_MESSAGE_CHARS);
              const assistantText = s(row.turn.assistant.contentText).slice(0, MAX_SYNC_MESSAGE_CHARS);
              const status = s(row.turn.assistant.status).toUpperCase() === "ERROR" ? "ERROR" : "SUCCESS";
              try {
                await appendAiSessionTurn({
                  accountId: ctx.accountId,
                  userId: ctx.userId,
                  sessionId: targetSessionId,
                  action: s(row.turn.user.action || row.turn.assistant.action).slice(0, 120) || "technical_recap",
                  requestId: buildGuestSyncRequestId(localSessionId, row.index),
                  workspaceId: null,
                  projectId: null,
                  origin: importOrigin,
                  userText,
                  userJson:
                    row.turn.user.contentJson && typeof row.turn.user.contentJson === "object"
                      ? row.turn.user.contentJson
                      : null,
                  assistantText,
                  assistantJson:
                    row.turn.assistant.contentJson && typeof row.turn.assistant.contentJson === "object"
                      ? row.turn.assistant.contentJson
                      : null,
                  provider: s(row.turn.assistant.provider).slice(0, 32) || null,
                  model: s(row.turn.assistant.model).slice(0, 120) || null,
                  status,
                  errorCode: status === "ERROR" ? (s(row.turn.assistant.errorCode).slice(0, 120) || "GUEST_PREVIEW_ERROR") : null,
                  sessionContextJson: null,
                });
                importedTurns += 1;
              } catch (turnError) {
                skippedTurns += 1;
                if (process.env.NODE_ENV !== "production") {
                  console.error("[guest-sync] turn import failed", {
                    localSessionId,
                    turnIndex: row.index,
                    error: turnError instanceof Error ? turnError.message : String(turnError),
                  });
                }
              }
            }
          }
        }
      } catch (sessionError) {
        skippedSessions += 1;
        if (process.env.NODE_ENV !== "production") {
          console.error("[guest-sync] session import failed", {
            localSessionId,
            error: sessionError instanceof Error ? sessionError.message : String(sessionError),
          });
        }
      }
    }

    return json(
      {
        ok: true,
        requestId,
        importedSessions,
        reusedSessions,
        importedTurns,
        skippedSessions,
        skippedTurns,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
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
