import "server-only";

import pg from "pg";

import { getAuthPool, newDbId, withAuthTransaction } from "@/lib/authDb";
import { prisma } from "@/lib/prisma";
import { embedAlibabaQwenText, rerankAlibabaQwenDocuments } from "@/src/lib/ai/providers/alibaba-qwen";
import { AiServiceError, type AiCenterSurface, type CavAiReasoningLevel } from "@/src/lib/ai/ai.types";

const SESSION_TITLE_MAX_CHARS = 220;
const SESSION_TITLE_SUMMARY_MAX_CHARS = 72;
const SESSION_TITLE_SUMMARY_MAX_WORDS = 12;
const GENERIC_SESSION_TITLE_KEYS = new Set([
  "workspace context",
  "general context",
  "console context",
  "cavcloud context",
  "cavsafe context",
  "cavpad context",
  "cavcode context",
  "untitled chat",
  "new chat",
  "cavai chat",
]);

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeSurface(value: unknown): AiCenterSurface {
  const raw = s(value).toLowerCase();
  if (
    raw === "general" ||
    raw === "workspace" ||
    raw === "console" ||
    raw === "cavcloud" ||
    raw === "cavsafe" ||
    raw === "cavpad" ||
    raw === "cavcode"
  ) {
    return raw;
  }
  return "workspace";
}

function toProjectId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function toOptionalBoolean(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function toReasoningLevel(value: unknown): CavAiReasoningLevel | null {
  const normalized = s(value).toLowerCase();
  if (
    normalized === "low"
    || normalized === "medium"
    || normalized === "high"
    || normalized === "extra_high"
  ) {
    return normalized;
  }
  return null;
}

function defaultTitle(surface: AiCenterSurface, contextLabel?: string | null): string {
  const label = s(contextLabel);
  if (label) return label.slice(0, 220);
  if (surface === "general") return "General context";
  if (surface === "console") return "Console context";
  if (surface === "cavcloud") return "CavCloud context";
  if (surface === "cavsafe") return "CavSafe context";
  if (surface === "cavpad") return "CavPad context";
  if (surface === "cavcode") return "CavCode context";
  return "Workspace context";
}

function normalizeTitleKey(value: unknown): string {
  return s(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function shouldAutoGenerateSessionTitle(args: {
  surface: AiCenterSurface;
  contextLabel?: string | null;
  currentTitle?: string | null;
}): boolean {
  const currentKey = normalizeTitleKey(args.currentTitle);
  if (!currentKey) return true;
  if (GENERIC_SESSION_TITLE_KEYS.has(currentKey)) return true;
  const fallbackWithContextKey = normalizeTitleKey(defaultTitle(args.surface, args.contextLabel));
  if (fallbackWithContextKey && currentKey === fallbackWithContextKey) return true;
  const fallbackSurfaceKey = normalizeTitleKey(defaultTitle(args.surface));
  if (fallbackSurfaceKey && currentKey === fallbackSurfaceKey) return true;
  return false;
}

function summarizeSessionTitleFromPrompt(prompt: unknown): string {
  const raw = s(prompt);
  if (!raw) return "";

  const lines = raw
    .split(/\r?\n/)
    .map((line) => s(line))
    .filter(Boolean)
    .filter((line) => !/^```/.test(line))
    .filter((line) => !/^(workspace|project|active file|file path|context|diagnostics|model|reasoning)\s*:/i.test(line));

  const cleanedLine = lines
    .map((line) =>
      line
        .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
        .replace(/\[[^\]]*]\((https?:\/\/[^)]+)\)/gi, " ")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/[#>*_~]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .find((line) => line.length >= 4);

  const normalized = (cleanedLine || raw)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\((https?:\/\/[^)]+)\)/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /^(please|pls|hey|hi|hello|yo|ok|okay|can you|could you|would you|i need|need you to|help me|let's|lets|kindly)\b[\s,:-]*/i,
      ""
    )
    .replace(/^[\"'`([{]+/, "")
    .replace(/[\"'`)\]}]+$/, "")
    .trim();

  if (!normalized) return "";

  const words = normalized.split(/\s+/).filter(Boolean);
  const compact: string[] = [];
  for (const word of words) {
    const token = word.replace(/[<>]/g, "");
    if (!token) continue;
    const next = compact.length ? `${compact.join(" ")} ${token}` : token;
    if (next.length > SESSION_TITLE_SUMMARY_MAX_CHARS) break;
    compact.push(token);
    if (compact.length >= SESSION_TITLE_SUMMARY_MAX_WORDS) break;
  }

  const summary = compact.join(" ").replace(/[.,:;!?-]+$/g, "").trim();
  if (!summary) return "";

  const capped = summary.slice(0, SESSION_TITLE_SUMMARY_MAX_CHARS).trim();
  return capped.slice(0, 1).toUpperCase() + capped.slice(1);
}

type AiQueryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;
type SessionTitleDbClient = Pick<typeof prisma, "cavAiSession">;

type AiSessionDbRow = {
  id: string;
  accountId?: string;
  userId?: string;
  surface: string;
  title: string;
  contextLabel: string | null;
  contextJson?: unknown;
  workspaceId: string | null;
  projectId: number | null;
  origin: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  lastMessageAt?: string | Date | null;
};

type AiSessionSummaryDbRow = {
  id: string;
  surface: string;
  title: string;
  contextLabel: string | null;
  workspaceId: string | null;
  projectId: number | null;
  origin: string | null;
  updatedAt: string | Date;
  createdAt: string | Date;
  lastMessageAt: string | Date | null;
  contextJson: unknown;
  previewText: string | null;
};

type AiMessageDbRow = {
  id: string;
  role: string;
  action: string | null;
  contentText: string;
  contentJson: unknown;
  provider: string | null;
  model: string | null;
  requestId: string | null;
  status: string | null;
  errorCode: string | null;
  createdAt: string | Date;
};

type AiFeedbackDbRow = {
  messageId: string;
  reaction: string | null;
  copyCount: number;
  shareCount: number;
  retryCount: number;
  updatedAt: string | Date | null;
};

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function jsonParam(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

async function queryOne<T extends pg.QueryResultRow>(
  queryable: AiQueryable,
  text: string,
  values: unknown[] = []
): Promise<T | null> {
  const result = await queryable.query<T>(text, values);
  return result.rows[0] ?? null;
}

async function resolveUniqueSessionTitleQuery(args: {
  queryable: AiQueryable;
  accountId: string;
  userId: string;
  sessionId: string;
  baseTitle: string;
}): Promise<string> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const sessionId = s(args.sessionId);
  const baseTitleRaw = s(args.baseTitle).slice(0, SESSION_TITLE_MAX_CHARS);
  const baseTitle = baseTitleRaw || "Untitled chat";
  const baseKey = normalizeTitleKey(baseTitle);

  const values: unknown[] = [accountId, userId];
  const excludedIdClause = sessionId
    ? (() => {
        values.push(sessionId);
        return ` AND "id" <> $${values.length}`;
      })()
    : "";
  const result = await args.queryable.query<{ title: string }>(
    `SELECT "title"
      FROM "CavAiSession"
      WHERE "accountId" = $1
        AND "userId" = $2${excludedIdClause}
      ORDER BY "updatedAt" DESC
      LIMIT 500`,
    values
  );

  const used = new Set(result.rows.map((row) => normalizeTitleKey(row.title)).filter(Boolean));
  if (!used.has(baseKey)) return baseTitle;

  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const suffixText = ` (${suffix})`;
    const root = baseTitle.slice(0, Math.max(1, SESSION_TITLE_MAX_CHARS - suffixText.length)).trim();
    const candidate = `${root}${suffixText}`;
    if (!used.has(normalizeTitleKey(candidate))) {
      return candidate;
    }
  }

  const fallbackSuffix = ` (${Date.now().toString().slice(-4)})`;
  const fallbackRoot = baseTitle.slice(0, Math.max(1, SESSION_TITLE_MAX_CHARS - fallbackSuffix.length)).trim();
  return `${fallbackRoot}${fallbackSuffix}`;
}

async function readAiSessionRow(args: {
  queryable: AiQueryable;
  accountId: string;
  sessionId: string;
}): Promise<AiSessionDbRow | null> {
  return queryOne<AiSessionDbRow>(
    args.queryable,
    `SELECT
        "id",
        "accountId",
        "userId",
        "surface",
        "title",
        "contextLabel",
        "contextJson",
        "workspaceId",
        "projectId",
        "origin",
        "createdAt",
        "updatedAt",
        "lastMessageAt"
      FROM "CavAiSession"
      WHERE "id" = $1
        AND "accountId" = $2
      LIMIT 1`,
    [s(args.sessionId), s(args.accountId)]
  );
}

async function resolveUniqueSessionTitle(args: {
  db: SessionTitleDbClient;
  accountId: string;
  userId: string;
  sessionId: string;
  baseTitle: string;
}): Promise<string> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const sessionId = s(args.sessionId);
  const baseTitleRaw = s(args.baseTitle).slice(0, SESSION_TITLE_MAX_CHARS);
  const baseTitle = baseTitleRaw || "Untitled chat";
  const baseKey = normalizeTitleKey(baseTitle);

  const existing = await args.db.cavAiSession.findMany({
    where: {
      accountId,
      userId,
      id: { not: sessionId },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 500,
    select: {
      title: true,
    },
  });

  const used = new Set(existing.map((row) => normalizeTitleKey(row.title)).filter(Boolean));
  if (!used.has(baseKey)) return baseTitle;

  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const suffixText = ` (${suffix})`;
    const root = baseTitle.slice(0, Math.max(1, SESSION_TITLE_MAX_CHARS - suffixText.length)).trim();
    const candidate = `${root}${suffixText}`;
    if (!used.has(normalizeTitleKey(candidate))) {
      return candidate;
    }
  }

  const fallbackSuffix = ` (${Date.now().toString().slice(-4)})`;
  const fallbackRoot = baseTitle.slice(0, Math.max(1, SESSION_TITLE_MAX_CHARS - fallbackSuffix.length)).trim();
  return `${fallbackRoot}${fallbackSuffix}`;
}

export type AiSessionSummary = {
  id: string;
  surface: AiCenterSurface;
  title: string;
  contextLabel: string | null;
  workspaceId: string | null;
  projectId: number | null;
  origin: string | null;
  updatedAt: string;
  createdAt: string;
  lastMessageAt: string | null;
  preview: string | null;
  model?: string | null;
  reasoningLevel?: CavAiReasoningLevel | null;
  queueEnabled?: boolean | null;
  projectRootPath?: string | null;
  activeFilePath?: string | null;
};

export type AiSessionMessage = {
  id: string;
  role: "user" | "assistant";
  action: string | null;
  contentText: string;
  contentJson: Record<string, unknown> | null;
  provider: string | null;
  model: string | null;
  requestId: string | null;
  status: string | null;
  errorCode: string | null;
  createdAt: string;
  feedback: AiMessageFeedbackState | null;
};

export type AiMessageFeedbackState = {
  reaction: "like" | "dislike" | null;
  copyCount: number;
  shareCount: number;
  retryCount: number;
  updatedAt: string | null;
};

export type CavCodeQueuedPrompt = {
  id: string;
  sessionId: string;
  status: "QUEUED" | "PROCESSING";
  prompt: string;
  action: string;
  filePath: string;
  language: string | null;
  model: string | null;
  reasoningLevel: CavAiReasoningLevel | null;
  imageCount: number;
  createdAt: string;
  payload?: {
    action: string;
    agentId?: string | null;
    agentActionKey?: string | null;
    filePath: string;
    language: string | null;
    selectedCode: string;
    diagnostics: Array<Record<string, unknown>>;
    prompt: string;
    model: string | null;
    reasoningLevel: CavAiReasoningLevel | null;
    queueEnabled: boolean;
    imageAttachments: Array<Record<string, unknown>>;
    context: Record<string, unknown>;
  };
};

export async function createAiSession(args: {
  accountId: string;
  userId: string;
  surface: AiCenterSurface;
  title?: string | null;
  contextLabel?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
  contextJson?: Record<string, unknown> | null;
}): Promise<{ id: string }> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  return withAuthTransaction(async (tx) => {
    const baseTitle = s(args.title) || defaultTitle(args.surface, args.contextLabel);
    const title = await resolveUniqueSessionTitleQuery({
      queryable: tx,
      accountId,
      userId,
      sessionId: "",
      baseTitle,
    });
    const id = newDbId();
    await tx.query(
      `INSERT INTO "CavAiSession" (
          "id",
          "accountId",
          "userId",
          "surface",
          "title",
          "contextLabel",
          "contextJson",
          "workspaceId",
          "projectId",
          "origin",
          "lastMessageAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
      [
        id,
        accountId,
        userId,
        normalizeSurface(args.surface),
        title.slice(0, SESSION_TITLE_MAX_CHARS),
        s(args.contextLabel) || null,
        jsonParam(args.contextJson),
        s(args.workspaceId) || null,
        toProjectId(args.projectId),
        s(args.origin) || null,
        null,
      ]
    );
    return { id };
  });
}

export async function getAiSessionForAccount(args: {
  accountId: string;
  sessionId: string;
}): Promise<{
  id: string;
  surface: AiCenterSurface;
  workspaceId: string | null;
  projectId: number | null;
  origin: string | null;
  contextLabel: string | null;
}> {
  const session = await readAiSessionRow({
    queryable: getAuthPool(),
    accountId: args.accountId,
    sessionId: args.sessionId,
  });

  if (!session) {
    throw new AiServiceError("SESSION_NOT_FOUND", "AI session was not found for this account scope.", 404);
  }

  return {
    id: session.id,
    surface: normalizeSurface(session.surface),
    workspaceId: session.workspaceId,
    projectId: session.projectId,
    origin: session.origin,
    contextLabel: session.contextLabel,
  };
}

export async function getAiSessionMetaForAccount(args: {
  accountId: string;
  sessionId: string;
}): Promise<{
  id: string;
  title: string;
  surface: AiCenterSurface;
  workspaceId: string | null;
  projectId: number | null;
  origin: string | null;
  contextLabel: string | null;
}> {
  const session = await readAiSessionRow({
    queryable: getAuthPool(),
    accountId: args.accountId,
    sessionId: args.sessionId,
  });

  if (!session) {
    throw new AiServiceError("SESSION_NOT_FOUND", "AI session was not found for this account scope.", 404);
  }

  return {
    id: session.id,
    title: s(session.title) || "Untitled chat",
    surface: normalizeSurface(session.surface),
    workspaceId: session.workspaceId,
    projectId: session.projectId,
    origin: session.origin,
    contextLabel: session.contextLabel,
  };
}

export async function listAiSessions(args: {
  accountId: string;
  userId: string;
  surface?: AiCenterSurface;
  workspaceId?: string | null;
  projectId?: number | null;
  limit?: number;
}): Promise<AiSessionSummary[]> {
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(args.limit || 30))));
  const values: unknown[] = [s(args.accountId), s(args.userId)];
  const filters = [`s."accountId" = $1`, `s."userId" = $2`];

  if (args.surface) {
    values.push(normalizeSurface(args.surface));
    filters.push(`s."surface" = $${values.length}`);
  }
  if (s(args.workspaceId)) {
    values.push(s(args.workspaceId));
    filters.push(`s."workspaceId" = $${values.length}`);
  }
  const projectId = toProjectId(args.projectId);
  if (projectId) {
    values.push(projectId);
    filters.push(`s."projectId" = $${values.length}`);
  }
  values.push(limit);

  const result = await getAuthPool().query<AiSessionSummaryDbRow>(
    `SELECT
        s."id",
        s."surface",
        s."title",
        s."contextLabel",
        s."workspaceId",
        s."projectId",
        s."origin",
        s."updatedAt",
        s."createdAt",
        s."lastMessageAt",
        s."contextJson",
        latest."contentText" AS "previewText"
      FROM "CavAiSession" s
      LEFT JOIN LATERAL (
        SELECT "contentText"
        FROM "CavAiMessage"
        WHERE "sessionId" = s."id"
        ORDER BY "createdAt" DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE ${filters.join(" AND ")}
      ORDER BY s."updatedAt" DESC
      LIMIT $${values.length}`,
    values
  );
  const rows = result.rows;

  return rows.map((row) => {
    const context = recordOrNull(row.contextJson) || {};

    return {
      id: row.id,
      surface: normalizeSurface(row.surface),
      title: row.title,
      contextLabel: row.contextLabel,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      origin: row.origin,
      updatedAt: toIso(row.updatedAt) || new Date(0).toISOString(),
      createdAt: toIso(row.createdAt) || new Date(0).toISOString(),
      lastMessageAt: toIso(row.lastMessageAt),
      preview: s(row.previewText).slice(0, 260) || null,
      model: s(context.model) || null,
      reasoningLevel: toReasoningLevel(context.reasoningLevel),
      queueEnabled: toOptionalBoolean(context.queueEnabled),
      projectRootPath: s(context.projectRootPath) || null,
      activeFilePath: s(context.activeFilePath) || null,
    };
  });
}

export async function renameAiSessionForAccount(args: {
  accountId: string;
  sessionId: string;
  title: string;
}) {
  const accountId = s(args.accountId);
  const sessionId = s(args.sessionId);
  const title = s(args.title).slice(0, 220);
  if (!accountId || !sessionId || !title) {
    throw new AiServiceError("INVALID_INPUT", "accountId, sessionId, and title are required.", 400);
  }
  await getAiSessionForAccount({ accountId, sessionId });
  const updated = await prisma.cavAiSession.update({
    where: { id: sessionId },
    data: {
      title,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      title: true,
      updatedAt: true,
    },
  });
  return {
    id: updated.id,
    title: updated.title,
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function deleteAiSessionForAccount(args: {
  accountId: string;
  sessionId: string;
}) {
  const accountId = s(args.accountId);
  const sessionId = s(args.sessionId);
  if (!accountId || !sessionId) {
    throw new AiServiceError("INVALID_INPUT", "accountId and sessionId are required.", 400);
  }
  await getAiSessionForAccount({ accountId, sessionId });
  await prisma.cavAiSession.delete({
    where: { id: sessionId },
  });
}

export async function rewindAiSessionFromMessage(args: {
  accountId: string;
  sessionId: string;
  messageId: string;
}): Promise<{
  sessionId: string;
  messageId: string;
  deletedCount: number;
  remainingCount: number;
  lastMessageAt: string | null;
}> {
  const accountId = s(args.accountId);
  const sessionId = s(args.sessionId);
  const messageId = s(args.messageId);
  if (!accountId || !sessionId || !messageId) {
    throw new AiServiceError("INVALID_INPUT", "accountId, sessionId, and messageId are required.", 400);
  }

  await getAiSessionForAccount({
    accountId,
    sessionId,
  });

  // Session ownership is already verified above via getAiSessionForAccount(accountId, sessionId).
  // Query by sessionId so rewind works even when legacy message.accountId drifted.
  const rows = await prisma.cavAiMessage.findMany({
    where: {
      sessionId,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      createdAt: true,
    },
  });
  if (!rows.length) {
    throw new AiServiceError("MESSAGE_NOT_FOUND", "AI message was not found for this session.", 404);
  }
  const rewindIndex = rows.findIndex((row) => row.id === messageId);
  if (rewindIndex < 0) {
    throw new AiServiceError("MESSAGE_NOT_FOUND", "AI message was not found for this session.", 404);
  }

  const deleteIds = rows.slice(rewindIndex).map((row) => row.id);
  const remainingRows = rows.slice(0, rewindIndex);
  const lastRemaining = remainingRows.length ? remainingRows[remainingRows.length - 1] : null;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (deleteIds.length) {
      await tx.cavAiMessageFeedback.deleteMany({
        where: {
          sessionId,
          messageId: { in: deleteIds },
        },
      });
      await tx.cavAiMessage.deleteMany({
        where: {
          sessionId,
          id: { in: deleteIds },
        },
      });
    }
    await tx.cavAiSession.update({
      where: { id: sessionId },
      data: {
        lastMessageAt: lastRemaining?.createdAt ?? null,
        updatedAt: now,
      },
    });
  });

  return {
    sessionId,
    messageId,
    deletedCount: deleteIds.length,
    remainingCount: remainingRows.length,
    lastMessageAt: lastRemaining ? lastRemaining.createdAt.toISOString() : null,
  };
}

export async function listAiSessionMessages(args: {
  accountId: string;
  sessionId: string;
  userId?: string | null;
  limit?: number;
}): Promise<AiSessionMessage[]> {
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(args.limit || 200))));
  const sessionId = s(args.sessionId);
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  await getAiSessionForAccount({
    accountId,
    sessionId,
  });

  const rows = (
    await getAuthPool().query<AiMessageDbRow>(
      `SELECT
          "id",
          "role",
          "action",
          "contentText",
          "contentJson",
          "provider",
          "model",
          "requestId",
          "status",
          "errorCode",
          "createdAt"
        FROM "CavAiMessage"
        WHERE "sessionId" = $1
        ORDER BY "createdAt" ASC
        LIMIT $2`,
      [sessionId, limit]
    )
  ).rows;

  const feedbackByMessageId = new Map<string, AiMessageFeedbackState>();
  if (userId && rows.length) {
    const feedbackRows = (
      await getAuthPool().query<AiFeedbackDbRow>(
        `SELECT
            "messageId",
            "reaction",
            "copyCount",
            "shareCount",
            "retryCount",
            "updatedAt"
          FROM "CavAiMessageFeedback"
          WHERE "accountId" = $1
            AND "userId" = $2
            AND "messageId" = ANY($3::text[])`,
        [accountId, userId, rows.map((row) => row.id)]
      )
    ).rows;
    for (const row of feedbackRows) {
      feedbackByMessageId.set(row.messageId, {
        reaction: toFeedbackReaction(row.reaction),
        copyCount: Math.max(0, Math.trunc(Number(row.copyCount || 0))),
        shareCount: Math.max(0, Math.trunc(Number(row.shareCount || 0))),
        retryCount: Math.max(0, Math.trunc(Number(row.retryCount || 0))),
        updatedAt: toIso(row.updatedAt),
      });
    }
  }

  return rows.map((row) => ({
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    action: row.action || null,
    contentText: row.contentText,
    contentJson: recordOrNull(row.contentJson),
    provider: row.provider || null,
    model: row.model || null,
    requestId: row.requestId || null,
    status: row.status || null,
    errorCode: row.errorCode || null,
    createdAt: toIso(row.createdAt) || new Date(0).toISOString(),
    feedback: feedbackByMessageId.get(row.id) || null,
  }));
}

function toFeedbackReaction(value: unknown): "like" | "dislike" | null {
  const normalized = s(value).toLowerCase();
  if (normalized === "like") return "like";
  if (normalized === "dislike") return "dislike";
  return null;
}

export type AiMessageFeedbackAction = "copy" | "share" | "retry" | "like" | "dislike" | "clear_reaction";

function feedbackStateFromRow(row: {
  reaction: string | null;
  copyCount: number;
  shareCount: number;
  retryCount: number;
  updatedAt: Date;
}): AiMessageFeedbackState {
  return {
    reaction: toFeedbackReaction(row.reaction),
    copyCount: Math.max(0, Math.trunc(Number(row.copyCount || 0))),
    shareCount: Math.max(0, Math.trunc(Number(row.shareCount || 0))),
    retryCount: Math.max(0, Math.trunc(Number(row.retryCount || 0))),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function updateAiMessageFeedback(args: {
  accountId: string;
  userId: string;
  sessionId: string;
  messageId: string;
  action: AiMessageFeedbackAction;
}): Promise<AiMessageFeedbackState> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const sessionId = s(args.sessionId);
  const messageId = s(args.messageId);
  if (!accountId || !userId || !sessionId || !messageId) {
    throw new AiServiceError("INVALID_INPUT", "accountId, userId, sessionId, and messageId are required.", 400);
  }

  await getAiSessionForAccount({
    accountId,
    sessionId,
  });

  const message = await prisma.cavAiMessage.findFirst({
    where: {
      id: messageId,
      accountId,
      sessionId,
    },
    select: { id: true },
  });
  if (!message) {
    throw new AiServiceError("MESSAGE_NOT_FOUND", "AI message was not found for this session.", 404);
  }

  const action = s(args.action).toLowerCase();
  const now = new Date();
  const updated = await prisma.cavAiMessageFeedback.upsert({
    where: {
      accountId_messageId_userId: {
        accountId,
        messageId,
        userId,
      },
    },
    create: {
      accountId,
      sessionId,
      messageId,
      userId,
      reaction: action === "like" ? "like" : action === "dislike" ? "dislike" : null,
      copyCount: action === "copy" ? 1 : 0,
      shareCount: action === "share" ? 1 : 0,
      retryCount: action === "retry" ? 1 : 0,
      lastCopiedAt: action === "copy" ? now : null,
      lastSharedAt: action === "share" ? now : null,
      lastRetriedAt: action === "retry" ? now : null,
    },
    update: {
      sessionId,
      reaction:
        action === "like"
          ? "like"
          : action === "dislike"
            ? "dislike"
            : action === "clear_reaction"
              ? null
              : undefined,
      copyCount: action === "copy" ? { increment: 1 } : undefined,
      shareCount: action === "share" ? { increment: 1 } : undefined,
      retryCount: action === "retry" ? { increment: 1 } : undefined,
      lastCopiedAt: action === "copy" ? now : undefined,
      lastSharedAt: action === "share" ? now : undefined,
      lastRetriedAt: action === "retry" ? now : undefined,
    },
    select: {
      reaction: true,
      copyCount: true,
      shareCount: true,
      retryCount: true,
      updatedAt: true,
    },
  });

  return feedbackStateFromRow(updated);
}

export async function ensureAiSession(args: {
  accountId: string;
  userId: string;
  sessionId?: string | null;
  surface: AiCenterSurface;
  title?: string | null;
  contextLabel?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
  contextJson?: Record<string, unknown> | null;
}): Promise<string> {
  const requested = s(args.sessionId);
  if (requested) {
    const existing = await getAiSessionForAccount({
      accountId: args.accountId,
      sessionId: requested,
    });
    return existing.id;
  }

  const created = await createAiSession({
    accountId: args.accountId,
    userId: args.userId,
    surface: args.surface,
    title: args.title,
    contextLabel: args.contextLabel,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    origin: args.origin,
    contextJson: args.contextJson,
  });
  return created.id;
}

export async function appendAiSessionTurn(args: {
  accountId: string;
  userId: string;
  sessionId: string;
  action: string;
  requestId: string;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
  userText: string;
  userJson?: Record<string, unknown> | null;
  assistantText: string;
  assistantJson?: Record<string, unknown> | null;
  provider?: string | null;
  model?: string | null;
  status?: "SUCCESS" | "ERROR";
  errorCode?: string | null;
  sessionContextJson?: Record<string, unknown> | null;
}) {
  const sessionId = s(args.sessionId);
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const userText = s(args.userText);
  const assistantText = s(args.assistantText);
  if (!sessionId) {
    throw new AiServiceError("SESSION_REQUIRED", "sessionId is required for AI message persistence.", 400);
  }

  const now = new Date();
  await withAuthTransaction(async (tx) => {
    const session = await readAiSessionRow({
      queryable: tx,
      accountId,
      sessionId,
    });
    if (!session) {
      throw new AiServiceError("SESSION_NOT_FOUND", "AI session was not found for this account scope.", 404);
    }

    let nextAutoTitle = "";
    if (session) {
      const surface = normalizeSurface(session.surface);
      if (
        shouldAutoGenerateSessionTitle({
          surface,
          contextLabel: session.contextLabel,
          currentTitle: session.title,
        })
      ) {
        const firstUserMessage = await queryOne<{ contentText: string }>(
          tx,
          `SELECT "contentText"
            FROM "CavAiMessage"
            WHERE "accountId" = $1
              AND "sessionId" = $2
              AND "role" = 'user'
            ORDER BY "createdAt" ASC, "id" ASC
            LIMIT 1`,
          [accountId, sessionId]
        );

        const seedPrompt = s(firstUserMessage?.contentText) || userText;
        const summarized = summarizeSessionTitleFromPrompt(seedPrompt);
        const baseTitle = summarized || defaultTitle(surface, session.contextLabel);
        nextAutoTitle = await resolveUniqueSessionTitleQuery({
          queryable: tx,
          accountId,
          userId: s(session.userId) || userId,
          sessionId,
          baseTitle,
        });
      }
    }

    await tx.query(
      `INSERT INTO "CavAiMessage" (
          "id",
          "accountId",
          "sessionId",
          "role",
          "action",
          "contentText",
          "contentJson",
          "requestId",
          "status",
          "workspaceId",
          "projectId",
          "origin",
          "createdByUser"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)`,
      [
        newDbId(),
        accountId,
        sessionId,
        "user",
        s(args.action).slice(0, 120) || null,
        userText,
        jsonParam(args.userJson),
        s(args.requestId) || null,
        s(args.status || "SUCCESS") || null,
        s(args.workspaceId) || null,
        toProjectId(args.projectId),
        s(args.origin) || null,
        userId || null,
      ]
    );

    await tx.query(
      `INSERT INTO "CavAiMessage" (
          "id",
          "accountId",
          "sessionId",
          "role",
          "action",
          "contentText",
          "contentJson",
          "provider",
          "model",
          "requestId",
          "status",
          "errorCode",
          "workspaceId",
          "projectId",
          "origin",
          "createdByUser"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        newDbId(),
        accountId,
        sessionId,
        "assistant",
        s(args.action).slice(0, 120) || null,
        assistantText,
        jsonParam(args.assistantJson),
        s(args.provider) || null,
        s(args.model) || null,
        s(args.requestId) || null,
        s(args.status || "SUCCESS") || null,
        s(args.errorCode) || null,
        s(args.workspaceId) || null,
        toProjectId(args.projectId),
        s(args.origin) || null,
        userId || null,
      ]
    );

    await tx.query(
      `UPDATE "CavAiSession"
        SET "lastMessageAt" = $2,
            "updatedAt" = $2,
            "contextJson" = CASE
              WHEN $3::jsonb IS NULL THEN "contextJson"
              ELSE $3::jsonb
            END,
            "title" = COALESCE($4, "title")
        WHERE "id" = $1`,
      [
        sessionId,
        now,
        jsonParam(args.sessionContextJson),
        nextAutoTitle ? nextAutoTitle.slice(0, SESSION_TITLE_MAX_CHARS) : null,
      ]
    );
  });
}

function parseQueuePayload(value: unknown): {
  action: string;
  agentId: string | null;
  agentActionKey: string | null;
  filePath: string;
  language: string | null;
  selectedCode: string;
  diagnostics: Array<Record<string, unknown>>;
  prompt: string;
  model: string | null;
  reasoningLevel: CavAiReasoningLevel | null;
  queueEnabled: boolean;
  imageAttachments: Array<Record<string, unknown>>;
  context: Record<string, unknown>;
} {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const diagnosticsRaw = Array.isArray(raw.diagnostics) ? raw.diagnostics : [];
  const imagesRaw = Array.isArray(raw.imageAttachments) ? raw.imageAttachments : [];
  return {
    action: s(raw.action) || "suggest_fix",
    agentId: s(raw.agentId).toLowerCase() || null,
    agentActionKey: s(raw.agentActionKey).toLowerCase() || null,
    filePath: s(raw.filePath),
    language: s(raw.language) || null,
    selectedCode: s(raw.selectedCode),
    diagnostics: diagnosticsRaw
      .filter((row) => row && typeof row === "object" && !Array.isArray(row))
      .map((row) => row as Record<string, unknown>),
    prompt: s(raw.prompt),
    model: s(raw.model) || null,
    reasoningLevel: toReasoningLevel(raw.reasoningLevel),
    queueEnabled: raw.queueEnabled === true,
    imageAttachments: imagesRaw
      .filter((row) => row && typeof row === "object" && !Array.isArray(row))
      .map((row) => row as Record<string, unknown>),
    context: raw.context && typeof raw.context === "object" && !Array.isArray(raw.context)
      ? (raw.context as Record<string, unknown>)
      : {},
  };
}

function toQueuedPromptRecord(row: {
  id: string;
  sessionId: string;
  status: string | null;
  action: string | null;
  contentText: string;
  contentJson: unknown;
  createdAt: Date;
}, includePayload = false): CavCodeQueuedPrompt {
  const payloadRaw = row.contentJson && typeof row.contentJson === "object" && !Array.isArray(row.contentJson)
    ? (row.contentJson as Record<string, unknown>)
    : {};
  const payload = parseQueuePayload(payloadRaw);
  const imageCount = Array.isArray(payload.imageAttachments) ? payload.imageAttachments.length : 0;
  const status = s(row.status).toUpperCase() === "PROCESSING" ? "PROCESSING" : "QUEUED";
  const record: CavCodeQueuedPrompt = {
    id: row.id,
    sessionId: row.sessionId,
    status,
    prompt: payload.prompt || s(row.contentText),
    action: payload.action || s(row.action) || "suggest_fix",
    filePath: payload.filePath,
    language: payload.language,
    model: payload.model,
    reasoningLevel: payload.reasoningLevel,
    imageCount,
    createdAt: row.createdAt.toISOString(),
  };
  if (includePayload) {
    record.payload = payload;
  }
  return record;
}

export async function enqueueCavCodePrompt(args: {
  accountId: string;
  userId: string;
  sessionId?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  requestId?: string | null;
  action: string;
  agentId?: string | null;
  agentActionKey?: string | null;
  filePath: string;
  language?: string | null;
  selectedCode?: string;
  diagnostics?: Array<Record<string, unknown>>;
  prompt: string;
  model?: string | null;
  reasoningLevel?: CavAiReasoningLevel | null;
  queueEnabled?: boolean;
  imageAttachments?: Array<Record<string, unknown>>;
  context?: Record<string, unknown>;
}): Promise<{ sessionId: string; messageId: string }> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const ensuredSessionId = await ensureAiSession({
    accountId,
    userId,
    sessionId: args.sessionId || null,
    surface: "cavcode",
    title: "CavCode context",
    contextLabel: "CavCode context",
    workspaceId: args.workspaceId || null,
    projectId: args.projectId || null,
    origin: null,
    contextJson: {
      surface: "cavcode",
      queueEnabled: args.queueEnabled === true,
      workspaceId: args.workspaceId || null,
      projectId: toProjectId(args.projectId),
      model: s(args.model) || null,
      reasoningLevel: toReasoningLevel(args.reasoningLevel),
      activeFilePath: s(args.filePath) || null,
    },
  });

  const prompt = s(args.prompt);
  const created = await prisma.$transaction(async (tx) => {
    const session = await tx.cavAiSession.findFirst({
      where: {
        id: ensuredSessionId,
        accountId,
      },
      select: {
        userId: true,
        surface: true,
        title: true,
        contextLabel: true,
      },
    });

    let nextAutoTitle = "";
    if (session) {
      const surface = normalizeSurface(session.surface);
      if (
        shouldAutoGenerateSessionTitle({
          surface,
          contextLabel: session.contextLabel,
          currentTitle: session.title,
        })
      ) {
        const firstUserMessage = await tx.cavAiMessage.findFirst({
          where: {
            accountId,
            sessionId: ensuredSessionId,
            role: "user",
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            contentText: true,
          },
        });

        const seedPrompt = s(firstUserMessage?.contentText) || prompt;
        const summarized = summarizeSessionTitleFromPrompt(seedPrompt);
        const baseTitle = summarized || defaultTitle(surface, session.contextLabel);
        nextAutoTitle = await resolveUniqueSessionTitle({
          db: tx,
          accountId,
          userId: s(session.userId) || userId,
          sessionId: ensuredSessionId,
          baseTitle,
        });
      }
    }

    const message = await tx.cavAiMessage.create({
      data: {
        accountId,
        sessionId: ensuredSessionId,
        role: "user",
        action: s(args.action).slice(0, 120) || "suggest_fix",
        contentText: prompt,
        contentJson: {
          action: s(args.action) || "suggest_fix",
          agentId: s(args.agentId).toLowerCase() || null,
          agentActionKey: s(args.agentActionKey).toLowerCase() || null,
          filePath: s(args.filePath),
          language: s(args.language) || null,
          selectedCode: s(args.selectedCode),
          diagnostics: Array.isArray(args.diagnostics) ? args.diagnostics : [],
          prompt,
          model: s(args.model) || null,
          reasoningLevel: toReasoningLevel(args.reasoningLevel),
          queueEnabled: args.queueEnabled === true,
          imageAttachments: Array.isArray(args.imageAttachments) ? args.imageAttachments : [],
          context: args.context && typeof args.context === "object" ? args.context : {},
        } as unknown as object,
        requestId: s(args.requestId) || null,
        status: "QUEUED",
        workspaceId: s(args.workspaceId) || null,
        projectId: toProjectId(args.projectId),
        createdByUser: userId || null,
      },
      select: { id: true },
    });

    await tx.cavAiSession.update({
      where: { id: ensuredSessionId },
      data: {
        lastMessageAt: new Date(),
        ...(nextAutoTitle ? { title: nextAutoTitle.slice(0, SESSION_TITLE_MAX_CHARS) } : {}),
      },
    });

    return message;
  });

  return {
    sessionId: ensuredSessionId,
    messageId: created.id,
  };
}

export async function listCavCodeQueuedPrompts(args: {
  accountId: string;
  sessionId: string;
  limit?: number;
}): Promise<CavCodeQueuedPrompt[]> {
  const sessionId = s(args.sessionId);
  await getAiSessionForAccount({
    accountId: args.accountId,
    sessionId,
  });

  const limit = Math.max(1, Math.min(120, Math.trunc(Number(args.limit || 40))));
  const rows = await prisma.cavAiMessage.findMany({
    where: {
      accountId: s(args.accountId),
      sessionId,
      role: "user",
      status: { in: ["QUEUED", "PROCESSING"] },
    },
    orderBy: [{ createdAt: "asc" }],
    take: limit,
    select: {
      id: true,
      sessionId: true,
      status: true,
      action: true,
      contentText: true,
      contentJson: true,
      createdAt: true,
    },
  });

  return rows.map((row) => toQueuedPromptRecord(row));
}

export async function claimNextCavCodeQueuedPrompt(args: {
  accountId: string;
  sessionId: string;
}): Promise<CavCodeQueuedPrompt | null> {
  const sessionId = s(args.sessionId);
  await getAiSessionForAccount({
    accountId: args.accountId,
    sessionId,
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = await prisma.cavAiMessage.findFirst({
      where: {
        accountId: s(args.accountId),
        sessionId,
        role: "user",
        status: "QUEUED",
      },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        sessionId: true,
        status: true,
        action: true,
        contentText: true,
        contentJson: true,
        createdAt: true,
      },
    });
    if (!candidate) return null;

    const claim = await prisma.cavAiMessage.updateMany({
      where: {
        id: candidate.id,
        accountId: s(args.accountId),
        sessionId,
        role: "user",
        status: "QUEUED",
      },
      data: {
        status: "PROCESSING",
      },
    });
    if (claim.count < 1) continue;

    return {
      ...toQueuedPromptRecord(candidate, true),
      status: "PROCESSING",
    };
  }

  return null;
}

export async function editCavCodeQueuedPrompt(args: {
  accountId: string;
  sessionId: string;
  messageId: string;
  prompt: string;
}): Promise<CavCodeQueuedPrompt> {
  const sessionId = s(args.sessionId);
  const messageId = s(args.messageId);
  const prompt = s(args.prompt);
  if (!sessionId || !messageId || !prompt) {
    throw new AiServiceError("INVALID_INPUT", "sessionId, messageId, and prompt are required.", 400);
  }

  await getAiSessionForAccount({
    accountId: args.accountId,
    sessionId,
  });

  const existing = await prisma.cavAiMessage.findFirst({
    where: {
      id: messageId,
      accountId: s(args.accountId),
      sessionId,
      role: "user",
      status: "QUEUED",
    },
    select: {
      id: true,
      sessionId: true,
      status: true,
      action: true,
      contentText: true,
      contentJson: true,
      createdAt: true,
    },
  });
  if (!existing) {
    throw new AiServiceError("QUEUE_MESSAGE_NOT_FOUND", "Queued message not found.", 404);
  }

  const payloadRaw = existing.contentJson && typeof existing.contentJson === "object" && !Array.isArray(existing.contentJson)
    ? (existing.contentJson as Record<string, unknown>)
    : {};
  const nextJson: Record<string, unknown> = {
    ...payloadRaw,
    prompt,
  };

  const updated = await prisma.cavAiMessage.update({
    where: { id: existing.id },
    data: {
      contentText: prompt,
      contentJson: nextJson as unknown as object,
    },
    select: {
      id: true,
      sessionId: true,
      status: true,
      action: true,
      contentText: true,
      contentJson: true,
      createdAt: true,
    },
  });

  return toQueuedPromptRecord(updated);
}

export async function cancelCavCodeQueuedPrompt(args: {
  accountId: string;
  sessionId: string;
  messageId: string;
}) {
  const sessionId = s(args.sessionId);
  const messageId = s(args.messageId);
  if (!sessionId || !messageId) {
    throw new AiServiceError("INVALID_INPUT", "sessionId and messageId are required.", 400);
  }

  await getAiSessionForAccount({
    accountId: args.accountId,
    sessionId,
  });

  const existing = await prisma.cavAiMessage.findFirst({
    where: {
      id: messageId,
      accountId: s(args.accountId),
      sessionId,
      role: "user",
      status: "QUEUED",
    },
    select: {
      id: true,
      contentJson: true,
    },
  });
  if (!existing) {
    throw new AiServiceError("QUEUE_MESSAGE_NOT_FOUND", "Queued message not found.", 404);
  }

  const payloadRaw =
    existing.contentJson && typeof existing.contentJson === "object" && !Array.isArray(existing.contentJson)
      ? (existing.contentJson as Record<string, unknown>)
      : {};
  const nextJson: Record<string, unknown> = {
    ...payloadRaw,
    queueStatus: "CANCELLED",
    queueSettledAt: new Date().toISOString(),
    queueCancelledByUser: true,
  };

  await prisma.cavAiMessage.update({
    where: { id: existing.id },
    data: {
      status: "CANCELLED",
      contentJson: nextJson as unknown as object,
    },
    select: { id: true },
  });
}

export async function settleCavCodeQueuedPrompt(args: {
  accountId: string;
  sessionId: string;
  messageId: string;
  status: "PROCESSED" | "ERROR";
  result?: Record<string, unknown> | null;
  errorCode?: string | null;
}) {
  const sessionId = s(args.sessionId);
  const messageId = s(args.messageId);
  if (!sessionId || !messageId) return;

  const existing = await prisma.cavAiMessage.findFirst({
    where: {
      id: messageId,
      accountId: s(args.accountId),
      sessionId,
      role: "user",
      status: { in: ["QUEUED", "PROCESSING"] },
    },
    select: {
      id: true,
      contentJson: true,
    },
  });
  if (!existing) return;

  const payloadRaw = existing.contentJson && typeof existing.contentJson === "object" && !Array.isArray(existing.contentJson)
    ? (existing.contentJson as Record<string, unknown>)
    : {};
  const nextJson: Record<string, unknown> = {
    ...payloadRaw,
    queueResult: args.result && typeof args.result === "object" ? args.result : {},
    queueSettledAt: new Date().toISOString(),
    queueStatus: args.status,
    queueErrorCode: s(args.errorCode) || null,
  };

  await prisma.cavAiMessage.update({
    where: { id: existing.id },
    data: {
      status: args.status,
      errorCode: s(args.errorCode) || null,
      contentJson: nextJson as unknown as object,
    },
  });
}

type AiMemoryCategory =
  | "identity"
  | "preference"
  | "writing_style"
  | "product_preference"
  | "project_goal";

export type AiUserMemoryFact = {
  id: string;
  factKey: string;
  factValue: string;
  category: AiMemoryCategory;
  confidence: number;
  isSensitive: boolean;
  lastUsedAt: string | null;
  updatedAt: string;
};

export async function getAiUserMemorySetting(args: {
  accountId: string;
  userId: string;
}): Promise<{ memoryEnabled: boolean; updatedAt: string | null }> {
  const row = await prisma.cavAiUserMemorySetting.findUnique({
    where: {
      accountId_userId: {
        accountId: s(args.accountId),
        userId: s(args.userId),
      },
    },
    select: {
      memoryEnabled: true,
      updatedAt: true,
    },
  });
  if (!row) {
    return {
      memoryEnabled: true,
      updatedAt: null,
    };
  }
  return {
    memoryEnabled: row.memoryEnabled === true,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

async function writeMemoryEvent(args: {
  accountId: string;
  userId: string;
  eventType: string;
  factId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  metaJson?: Record<string, unknown> | null;
}) {
  try {
    await prisma.cavAiUserMemoryEvent.create({
      data: {
        accountId: s(args.accountId),
        userId: s(args.userId),
        eventType: s(args.eventType).slice(0, 32),
        factId: s(args.factId) || null,
        sessionId: s(args.sessionId) || null,
        requestId: s(args.requestId) || null,
        metaJson: args.metaJson ? (args.metaJson as unknown as object) : undefined,
      },
    });
  } catch {
    // Non-blocking event write.
  }
}

export async function setAiUserMemoryEnabled(args: {
  accountId: string;
  userId: string;
  memoryEnabled: boolean;
}) {
  const updated = await prisma.cavAiUserMemorySetting.upsert({
    where: {
      accountId_userId: {
        accountId: s(args.accountId),
        userId: s(args.userId),
      },
    },
    create: {
      accountId: s(args.accountId),
      userId: s(args.userId),
      memoryEnabled: args.memoryEnabled === true,
    },
    update: {
      memoryEnabled: args.memoryEnabled === true,
    },
    select: {
      memoryEnabled: true,
      updatedAt: true,
    },
  });

  await writeMemoryEvent({
    accountId: args.accountId,
    userId: args.userId,
    eventType: "setting_update",
    metaJson: {
      memoryEnabled: updated.memoryEnabled === true,
    },
  });

  return {
    memoryEnabled: updated.memoryEnabled === true,
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function listAiUserMemoryFacts(args: {
  accountId: string;
  userId: string;
  limit?: number;
}): Promise<AiUserMemoryFact[]> {
  const rows = await prisma.cavAiUserMemoryFact.findMany({
    where: {
      accountId: s(args.accountId),
      userId: s(args.userId),
      deletedAt: null,
    },
    orderBy: [{ lastUsedAt: "desc" }, { updatedAt: "desc" }],
    take: Math.max(1, Math.min(200, Math.trunc(Number(args.limit || 40)))),
    select: {
      id: true,
      factKey: true,
      factValue: true,
      category: true,
      confidence: true,
      isSensitive: true,
      lastUsedAt: true,
      updatedAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    factKey: row.factKey,
    factValue: row.factValue,
    category: (s(row.category) || "preference") as AiMemoryCategory,
    confidence: Number(row.confidence) || 0.6,
    isSensitive: row.isSensitive === true,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function upsertAiUserMemoryFact(args: {
  accountId: string;
  userId: string;
  factKey: string;
  factValue: string;
  category: AiMemoryCategory;
  confidence?: number;
  isSensitive?: boolean;
  sourceSessionId?: string | null;
  sourceMessageId?: string | null;
  requestId?: string | null;
}) {
  const factKey = s(args.factKey).toLowerCase().slice(0, 120);
  const factValue = s(args.factValue);
  if (!factKey || !factValue) {
    throw new AiServiceError("INVALID_INPUT", "factKey and factValue are required.", 400);
  }

  const row = await prisma.cavAiUserMemoryFact.upsert({
    where: {
      accountId_userId_factKey: {
        accountId: s(args.accountId),
        userId: s(args.userId),
        factKey,
      },
    },
    create: {
      accountId: s(args.accountId),
      userId: s(args.userId),
      factKey,
      factValue,
      category: s(args.category).slice(0, 40),
      confidence: Math.max(0.1, Math.min(1, Number(args.confidence || 0.7))),
      isSensitive: args.isSensitive === true,
      sourceSessionId: s(args.sourceSessionId) || null,
      sourceMessageId: s(args.sourceMessageId) || null,
      lastUsedAt: new Date(),
      deletedAt: null,
    },
    update: {
      factValue,
      category: s(args.category).slice(0, 40),
      confidence: Math.max(0.1, Math.min(1, Number(args.confidence || 0.7))),
      isSensitive: args.isSensitive === true,
      sourceSessionId: s(args.sourceSessionId) || null,
      sourceMessageId: s(args.sourceMessageId) || null,
      lastUsedAt: new Date(),
      deletedAt: null,
    },
    select: {
      id: true,
      factKey: true,
      factValue: true,
      category: true,
      confidence: true,
      isSensitive: true,
      lastUsedAt: true,
      updatedAt: true,
    },
  });

  await writeMemoryEvent({
    accountId: args.accountId,
    userId: args.userId,
    eventType: "fact_upsert",
    factId: row.id,
    sessionId: args.sourceSessionId || null,
    requestId: args.requestId || null,
    metaJson: {
      factKey: row.factKey,
      category: row.category,
    },
  });

  return {
    id: row.id,
    factKey: row.factKey,
    factValue: row.factValue,
    category: (s(row.category) || "preference") as AiMemoryCategory,
    confidence: Number(row.confidence) || 0.6,
    isSensitive: row.isSensitive === true,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  } satisfies AiUserMemoryFact;
}

export async function deleteAiUserMemoryFact(args: {
  accountId: string;
  userId: string;
  factId: string;
}) {
  const existing = await prisma.cavAiUserMemoryFact.findFirst({
    where: {
      id: s(args.factId),
      accountId: s(args.accountId),
      userId: s(args.userId),
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });
  if (!existing) {
    throw new AiServiceError("MEMORY_NOT_FOUND", "Memory fact was not found.", 404);
  }

  await prisma.cavAiUserMemoryFact.update({
    where: { id: existing.id },
    data: {
      deletedAt: new Date(),
    },
  });

  await writeMemoryEvent({
    accountId: args.accountId,
    userId: args.userId,
    eventType: "fact_delete",
    factId: existing.id,
  });
}

function tokenOverlapScore(query: string, candidate: string): number {
  const queryTokens = new Set(
    s(query)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 3)
  );
  const candidateTokens = new Set(
    s(candidate)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 3)
  );
  if (!queryTokens.size || !candidateTokens.size) return 0;
  let hits = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) hits += 1;
  }
  return hits / Math.max(1, queryTokens.size);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!Array.isArray(left) || !Array.isArray(right)) return 0;
  if (!left.length || !right.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm <= 0 || rightNorm <= 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export async function retrieveRelevantAiUserMemoryFacts(args: {
  accountId: string;
  userId: string;
  prompt: string;
  goal?: string | null;
  limit?: number;
  sessionId?: string | null;
  requestId?: string | null;
}): Promise<AiUserMemoryFact[]> {
  const setting = await getAiUserMemorySetting({
    accountId: args.accountId,
    userId: args.userId,
  });
  if (!setting.memoryEnabled) return [];

  const query = `${s(args.prompt)} ${s(args.goal)}`;
  const rows = await prisma.cavAiUserMemoryFact.findMany({
    where: {
      accountId: s(args.accountId),
      userId: s(args.userId),
      deletedAt: null,
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 120,
    select: {
      id: true,
      factKey: true,
      factValue: true,
      category: true,
      confidence: true,
      isSensitive: true,
      lastUsedAt: true,
      updatedAt: true,
    },
  });

  const limit = Math.max(1, Math.min(12, Math.trunc(Number(args.limit || 5))));
  const lexicalScored = rows
    .map((row) => ({
      row,
      text: `${s(row.factKey)} ${s(row.factValue)}`.trim(),
      lexicalScore: tokenOverlapScore(query, `${row.factKey} ${row.factValue}`),
      confidenceScore: Number(row.confidence || 0.6) * 0.22,
    }))
    .map((item) => ({
      ...item,
      score: item.lexicalScore + item.confidenceScore,
    }));

  const semanticSeed = lexicalScored
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);

  const enhancedScores = new Map<string, number>();
  try {
    if (query && semanticSeed.length) {
      const queryEmbedding = await embedAlibabaQwenText({
        text: query,
        timeoutMs: 18_000,
      });

      const embeddings = await Promise.all(
        semanticSeed.map(async (item) => {
          try {
            const embedded = await embedAlibabaQwenText({
              text: item.text,
              timeoutMs: 18_000,
            });
            const semantic = cosineSimilarity(queryEmbedding.embedding, embedded.embedding);
            return {
              id: item.row.id,
              semanticScore: Number.isFinite(semantic) ? Math.max(0, semantic) : 0,
            };
          } catch {
            return {
              id: item.row.id,
              semanticScore: 0,
            };
          }
        })
      );

      const rerank = await rerankAlibabaQwenDocuments({
        query,
        documents: semanticSeed.map((item) => item.text),
        topN: Math.max(limit * 3, 12),
        timeoutMs: 18_000,
      }).catch(() => null);
      const rerankScoreByIndex = new Map<number, number>();
      if (rerank) {
        for (const row of rerank.items) {
          const index = Math.max(0, Math.trunc(Number(row.index)));
          const score = Number(row.score);
          if (!Number.isFinite(score)) continue;
          rerankScoreByIndex.set(index, Math.max(0, score));
        }
      }

      for (let index = 0; index < semanticSeed.length; index += 1) {
        const item = semanticSeed[index];
        const embeddingRow = embeddings.find((row) => row.id === item.row.id);
        const semanticScore = Number(embeddingRow?.semanticScore || 0);
        const rerankScore = Number(rerankScoreByIndex.get(index) || 0);
        const boostedScore =
          (item.lexicalScore * 0.38)
          + (semanticScore * 0.42)
          + (rerankScore * 0.2)
          + item.confidenceScore;
        enhancedScores.set(item.row.id, boostedScore);
      }
    }
  } catch {
    // Retrieval always falls back to lexical ranking if embedding/rerank is unavailable.
  }

  const ranked = lexicalScored
    .map((item) => ({
      row: item.row,
      score: enhancedScores.get(item.row.id) ?? item.score,
    }))
    .filter((item) => item.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const selected = ranked.map((item) => item.row);
  if (selected.length) {
    const ids = selected.map((row) => row.id);
    const now = new Date();
    await prisma.cavAiUserMemoryFact.updateMany({
      where: {
        accountId: s(args.accountId),
        userId: s(args.userId),
        id: { in: ids },
      },
      data: {
        lastUsedAt: now,
      },
    });
  }

  await writeMemoryEvent({
    accountId: args.accountId,
    userId: args.userId,
    eventType: "fact_retrieve",
    sessionId: args.sessionId || null,
    requestId: args.requestId || null,
    metaJson: {
      resultCount: selected.length,
    },
  });

  return selected.map((row) => ({
    id: row.id,
    factKey: row.factKey,
    factValue: row.factValue,
    category: (s(row.category) || "preference") as AiMemoryCategory,
    confidence: Number(row.confidence) || 0.6,
    isSensitive: row.isSensitive === true,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

function extractMemoryFactCandidates(text: string): Array<{
  factKey: string;
  factValue: string;
  category: AiMemoryCategory;
  confidence: number;
  isSensitive?: boolean;
}> {
  const source = s(text);
  if (!source) return [];
  const lower = source.toLowerCase();
  const rows: Array<{
    factKey: string;
    factValue: string;
    category: AiMemoryCategory;
    confidence: number;
    isSensitive?: boolean;
  }> = [];

  const callMe = lower.match(/\bcall me\s+([a-z0-9 _.-]{2,40})/i);
  if (callMe?.[1]) {
    rows.push({
      factKey: "identity.display_name",
      factValue: s(callMe[1]),
      category: "identity",
      confidence: 0.9,
    });
  }

  const prefer = lower.match(/\bi prefer\s+([^.!?\n]{3,120})/i);
  if (prefer?.[1]) {
    rows.push({
      factKey: "preference.general",
      factValue: s(prefer[1]),
      category: "preference",
      confidence: 0.78,
    });
  }

  const writingTone = lower.match(/\b(use|keep)\s+(a|an)?\s*(formal|casual|friendly|professional|concise|direct)\s+(tone|style)/i);
  if (writingTone?.[3]) {
    rows.push({
      factKey: "writing.tone",
      factValue: s(writingTone[3]),
      category: "writing_style",
      confidence: 0.82,
    });
  }

  const recurringGoal = lower.match(/\bmy (main )?goal is\s+([^.!?\n]{4,180})/i);
  if (recurringGoal?.[2]) {
    rows.push({
      factKey: "project.main_goal",
      factValue: s(recurringGoal[2]),
      category: "project_goal",
      confidence: 0.75,
    });
  }

  const productPref = lower.match(/\b(i use|we use)\s+(cavcloud|cavsafe|cavpad|cavcode)\b/i);
  if (productPref?.[2]) {
    rows.push({
      factKey: `product.uses.${s(productPref[2]).toLowerCase()}`,
      factValue: "true",
      category: "product_preference",
      confidence: 0.7,
    });
  }

  return rows;
}

export async function learnAiUserMemoryFromPrompt(args: {
  accountId: string;
  userId: string;
  sessionId?: string | null;
  requestId?: string | null;
  userPrompt: string;
  sourceMessageId?: string | null;
}) {
  try {
    const setting = await getAiUserMemorySetting({
      accountId: args.accountId,
      userId: args.userId,
    });
    if (!setting.memoryEnabled) return;

    const candidates = extractMemoryFactCandidates(args.userPrompt).slice(0, 4);
    for (const row of candidates) {
      await upsertAiUserMemoryFact({
        accountId: args.accountId,
        userId: args.userId,
        factKey: row.factKey,
        factValue: row.factValue,
        category: row.category,
        confidence: row.confidence,
        isSensitive: row.isSensitive === true,
        sourceSessionId: args.sessionId || null,
        sourceMessageId: args.sourceMessageId || null,
        requestId: args.requestId || null,
      });
    }
  } catch {
    // Memory learning must not break live assist flows.
  }
}
