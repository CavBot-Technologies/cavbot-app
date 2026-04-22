import "server-only";

import { Prisma } from "@prisma/client";

import type { PublishedOperatorAgentRecord } from "@/lib/cavai/operatorAgents.server";
import { listPublishedOperatorAgents } from "@/lib/cavai/operatorAgents.server";
import { prisma } from "@/lib/prisma";

type AgentSurface = "cavcode" | "center" | "all";
export type AdminAgentCreationSource = "manual" | "generate_with_cavai" | "help_write_with_cavai" | "unknown";

export type AdminAgentTelemetryInput = {
  agentId: string;
  creationSource?: string | null;
  creationPrompt?: string | null;
  generationSessionId?: string | null;
  creationOrigin?: string | null;
  generatedWithCavAi?: boolean | null;
};

export type AdminTrackedAgentInput = {
  id: string;
  name: string;
  summary: string;
  actionKey: string;
  surface: AgentSurface;
  triggers: string[];
  instructions: string;
  iconSvg: string;
  iconBackground?: string | null;
  publicationRequested?: boolean;
  publicationRequestedAt?: string | null;
  createdAt?: string | null;
};

export type AdminTrackedAgentRecord = {
  trackingId: string;
  accountId: string;
  userId: string;
  agentId: string;
  name: string;
  summary: string;
  actionKey: string;
  surface: AgentSurface;
  triggers: string[];
  instructions: string;
  iconSvg: string;
  iconBackground: string | null;
  creationSource: AdminAgentCreationSource;
  creationPrompt: string | null;
  generationSessionId: string | null;
  creationOrigin: string | null;
  generatedWithCavAi: boolean;
  publicationRequested: boolean;
  publicationRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  removedAt: string | null;
};

type RawTrackedAgentRow = {
  trackingId: string | null;
  accountId: string | null;
  userId: string | null;
  agentId: string | null;
  name: string | null;
  summary: string | null;
  actionKey: string | null;
  surface: string | null;
  triggers: unknown;
  instructions: string | null;
  iconSvg: string | null;
  iconBackground: string | null;
  creationSource: string | null;
  creationPrompt: string | null;
  generationSessionId: string | null;
  creationOrigin: string | null;
  generatedWithCavAi: boolean | null;
  publicationRequested: boolean | null;
  publicationRequestedAt: Date | string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  isActive: boolean | null;
  removedAt: Date | string | null;
};

let tableReady = false;

function s(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeSurface(value: unknown): AgentSurface {
  const raw = s(value).toLowerCase();
  if (raw === "cavcode" || raw === "center" || raw === "all") return raw;
  return "all";
}

function normalizeAgentId(value: unknown) {
  const raw = s(value).toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,63}$/.test(raw) ? raw : "";
}

function normalizeActionKey(value: unknown) {
  const raw = s(value).toLowerCase();
  return /^[a-z0-9][a-z0-9_]{1,63}$/.test(raw) ? raw : "";
}

function toIso(value: unknown, fallback?: string | null) {
  if (value instanceof Date) return value.toISOString();
  const raw = s(value);
  if (!raw) return fallback || null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback || null : date.toISOString();
}

function normalizeCreationSource(value: unknown): AdminAgentCreationSource {
  const raw = s(value).toLowerCase();
  if (raw === "generate_with_cavai" || raw === "help_write_with_cavai" || raw === "manual") return raw;
  return "unknown";
}

function normalizeTriggers(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const entry of value) {
    const trigger = s(entry);
    if (!trigger) continue;
    const dedupeKey = trigger.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    rows.push(trigger);
    if (rows.length >= 12) break;
  }
  return rows;
}

function normalizeTelemetry(value: unknown): AdminAgentTelemetryInput[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: AdminAgentTelemetryInput[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const agentId = normalizeAgentId(record.agentId || record.id);
    if (!agentId || seen.has(agentId)) continue;
    seen.add(agentId);
    rows.push({
      agentId,
      creationSource: normalizeCreationSource(record.creationSource),
      creationPrompt: s(record.creationPrompt) || null,
      generationSessionId: s(record.generationSessionId) || null,
      creationOrigin: s(record.creationOrigin) || null,
      generatedWithCavAi: record.generatedWithCavAi === true,
    });
  }
  return rows;
}

function trackingIdFor(accountId: string, userId: string, agentId: string) {
  return `${accountId}:${userId}:${agentId}`;
}

function normalizeRow(row: RawTrackedAgentRow | null | undefined): AdminTrackedAgentRecord | null {
  if (!row) return null;
  const accountId = s(row.accountId);
  const userId = s(row.userId);
  const agentId = normalizeAgentId(row.agentId);
  const actionKey = normalizeActionKey(row.actionKey);
  const name = s(row.name).replace(/\s+/g, " ").slice(0, 96);
  const summary = s(row.summary).replace(/\s+/g, " ").slice(0, 240);
  const instructions = s(row.instructions).slice(0, 12_000);
  const iconSvg = s(row.iconSvg);
  if (!accountId || !userId || !agentId || !actionKey || !name || !summary || !instructions || !iconSvg) return null;
  return {
    trackingId: s(row.trackingId) || trackingIdFor(accountId, userId, agentId),
    accountId,
    userId,
    agentId,
    name,
    summary,
    actionKey,
    surface: normalizeSurface(row.surface),
    triggers: normalizeTriggers(row.triggers),
    instructions,
    iconSvg,
    iconBackground: s(row.iconBackground) || null,
    creationSource: normalizeCreationSource(row.creationSource),
    creationPrompt: s(row.creationPrompt) || null,
    generationSessionId: s(row.generationSessionId) || null,
    creationOrigin: s(row.creationOrigin) || null,
    generatedWithCavAi: row.generatedWithCavAi === true,
    publicationRequested: row.publicationRequested === true,
    publicationRequestedAt: toIso(row.publicationRequestedAt),
    createdAt: toIso(row.createdAt) || new Date(0).toISOString(),
    updatedAt: toIso(row.updatedAt) || new Date(0).toISOString(),
    isActive: row.isActive !== false,
    removedAt: toIso(row.removedAt),
  };
}

async function ensureAgentIntelligenceTable() {
  if (tableReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AdminTrackedAgent" (
      "trackingId" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "agentId" TEXT NOT NULL,
      "name" VARCHAR(96) NOT NULL,
      "summary" VARCHAR(240) NOT NULL,
      "actionKey" VARCHAR(64) NOT NULL,
      "surface" VARCHAR(16) NOT NULL DEFAULT 'all',
      "triggers" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "instructions" TEXT NOT NULL,
      "iconSvg" TEXT NOT NULL,
      "iconBackground" VARCHAR(16),
      "creationSource" VARCHAR(32) NOT NULL DEFAULT 'unknown',
      "creationPrompt" TEXT,
      "generationSessionId" TEXT,
      "creationOrigin" VARCHAR(32),
      "generatedWithCavAi" BOOLEAN NOT NULL DEFAULT FALSE,
      "publicationRequested" BOOLEAN NOT NULL DEFAULT FALSE,
      "publicationRequestedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
      "removedAt" TIMESTAMPTZ,
      UNIQUE ("accountId", "userId", "agentId")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AdminTrackedAgent_account_surface_createdAt_idx"
    ON "AdminTrackedAgent"("accountId", "surface", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AdminTrackedAgent_user_active_updatedAt_idx"
    ON "AdminTrackedAgent"("userId", "isActive", "updatedAt");
  `);
  tableReady = true;
}

async function readOwnerTrackedAgents(accountId: string, userId: string) {
  await ensureAgentIntelligenceTable();
  const rows = await prisma.$queryRaw<RawTrackedAgentRow[]>(
    Prisma.sql`
      SELECT
        "trackingId",
        "accountId",
        "userId",
        "agentId",
        "name",
        "summary",
        "actionKey",
        "surface",
        "triggers",
        "instructions",
        "iconSvg",
        "iconBackground",
        "creationSource",
        "creationPrompt",
        "generationSessionId",
        "creationOrigin",
        "generatedWithCavAi",
        "publicationRequested",
        "publicationRequestedAt",
        "createdAt",
        "updatedAt",
        "isActive",
        "removedAt"
      FROM "AdminTrackedAgent"
      WHERE "accountId" = ${accountId}
        AND "userId" = ${userId}
    `,
  );
  return rows.map((row) => normalizeRow(row)).filter((row): row is AdminTrackedAgentRecord => Boolean(row));
}

export function parseAdminAgentTelemetryPayload(value: unknown) {
  return normalizeTelemetry(value);
}

export async function syncAdminTrackedAgents(args: {
  accountId: string;
  userId: string;
  agents: readonly AdminTrackedAgentInput[];
  telemetry?: readonly AdminAgentTelemetryInput[];
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return;
  await ensureAgentIntelligenceTable();

  const existing = new Map((await readOwnerTrackedAgents(accountId, userId)).map((row) => [row.agentId, row]));
  const telemetryByAgentId = new Map(
    normalizeTelemetry(args.telemetry).map((row) => [row.agentId, row]),
  );
  const activeIds: string[] = [];

  for (const rawAgent of Array.isArray(args.agents) ? args.agents : []) {
    const agentId = normalizeAgentId(rawAgent.id);
    const actionKey = normalizeActionKey(rawAgent.actionKey);
    const name = s(rawAgent.name).replace(/\s+/g, " ").slice(0, 96);
    const summary = s(rawAgent.summary).replace(/\s+/g, " ").slice(0, 240);
    const instructions = s(rawAgent.instructions).slice(0, 12_000);
    const iconSvg = s(rawAgent.iconSvg);
    if (!agentId || !actionKey || !name || !summary || !instructions || !iconSvg) continue;
    activeIds.push(agentId);
    const trackingId = trackingIdFor(accountId, userId, agentId);
    const persisted = existing.get(agentId) || null;
    const telemetry = telemetryByAgentId.get(agentId) || null;
    const creationSource = telemetry?.creationSource
      ? normalizeCreationSource(telemetry.creationSource)
      : persisted?.creationSource || "unknown";
    const creationPrompt = telemetry?.creationPrompt ?? persisted?.creationPrompt ?? null;
    const generationSessionId = telemetry?.generationSessionId ?? persisted?.generationSessionId ?? null;
    const creationOrigin = telemetry?.creationOrigin ?? persisted?.creationOrigin ?? "cavcode";
    const generatedWithCavAi = telemetry?.generatedWithCavAi === true
      ? true
      : persisted?.generatedWithCavAi === true
        ? true
        : creationSource === "generate_with_cavai" || creationSource === "help_write_with_cavai";
    const createdAt = toIso(rawAgent.createdAt, persisted?.createdAt || new Date().toISOString()) || new Date().toISOString();
    const publicationRequested = rawAgent.publicationRequested === true
      ? true
      : rawAgent.publicationRequested === false
        ? false
        : (persisted?.publicationRequested === true || !persisted);
    const publicationRequestedAt = publicationRequested
      ? toIso(rawAgent.publicationRequestedAt, persisted?.publicationRequestedAt || createdAt) || createdAt
      : null;

    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "AdminTrackedAgent" (
          "trackingId",
          "accountId",
          "userId",
          "agentId",
          "name",
          "summary",
          "actionKey",
          "surface",
          "triggers",
          "instructions",
          "iconSvg",
          "iconBackground",
          "creationSource",
          "creationPrompt",
          "generationSessionId",
          "creationOrigin",
          "generatedWithCavAi",
          "publicationRequested",
          "publicationRequestedAt",
          "createdAt",
          "updatedAt",
          "isActive",
          "removedAt"
        )
        VALUES (
          ${trackingId},
          ${accountId},
          ${userId},
          ${agentId},
          ${name},
          ${summary},
          ${actionKey},
          ${normalizeSurface(rawAgent.surface)},
          CAST(${JSON.stringify(normalizeTriggers(rawAgent.triggers))} AS jsonb),
          ${instructions},
          ${iconSvg},
          ${s(rawAgent.iconBackground) || null},
          ${creationSource},
          ${creationPrompt},
          ${generationSessionId},
          ${creationOrigin},
          ${generatedWithCavAi},
          ${publicationRequested},
          ${publicationRequestedAt ? Prisma.sql`${publicationRequestedAt}::timestamptz` : Prisma.sql`NULL`},
          ${createdAt}::timestamptz,
          CURRENT_TIMESTAMP,
          TRUE,
          NULL
        )
        ON CONFLICT ("accountId", "userId", "agentId")
        DO UPDATE SET
          "trackingId" = EXCLUDED."trackingId",
          "name" = EXCLUDED."name",
          "summary" = EXCLUDED."summary",
          "actionKey" = EXCLUDED."actionKey",
          "surface" = EXCLUDED."surface",
          "triggers" = EXCLUDED."triggers",
          "instructions" = EXCLUDED."instructions",
          "iconSvg" = EXCLUDED."iconSvg",
          "iconBackground" = EXCLUDED."iconBackground",
          "creationSource" = EXCLUDED."creationSource",
          "creationPrompt" = EXCLUDED."creationPrompt",
          "generationSessionId" = EXCLUDED."generationSessionId",
          "creationOrigin" = EXCLUDED."creationOrigin",
          "generatedWithCavAi" = EXCLUDED."generatedWithCavAi",
          "publicationRequested" = EXCLUDED."publicationRequested",
          "publicationRequestedAt" = EXCLUDED."publicationRequestedAt",
          "createdAt" = COALESCE("AdminTrackedAgent"."createdAt", EXCLUDED."createdAt"),
          "updatedAt" = CURRENT_TIMESTAMP,
          "isActive" = TRUE,
          "removedAt" = NULL
      `,
    );
  }

  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "AdminTrackedAgent"
      SET
        "isActive" = FALSE,
        "removedAt" = COALESCE("removedAt", CURRENT_TIMESTAMP),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "accountId" = ${accountId}
        AND "userId" = ${userId}
        ${activeIds.length
          ? Prisma.sql`AND NOT ("agentId" IN (${Prisma.join(activeIds.map((id) => Prisma.sql`${id}`), ", ")}))`
          : Prisma.empty}
    `,
  );
}

export async function listAdminTrackedAgents(args?: {
  activeOnly?: boolean;
  accountId?: string | null;
  userId?: string | null;
  limit?: number;
}) {
  await ensureAgentIntelligenceTable();
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(args?.limit) || 240)));
  const rows = await prisma.$queryRaw<RawTrackedAgentRow[]>(
    Prisma.sql`
      SELECT
        "trackingId",
        "accountId",
        "userId",
        "agentId",
        "name",
        "summary",
        "actionKey",
        "surface",
        "triggers",
        "instructions",
        "iconSvg",
        "iconBackground",
        "creationSource",
        "creationPrompt",
        "generationSessionId",
        "creationOrigin",
        "generatedWithCavAi",
        "publicationRequested",
        "publicationRequestedAt",
        "createdAt",
        "updatedAt",
        "isActive",
        "removedAt"
      FROM "AdminTrackedAgent"
      WHERE 1 = 1
        ${args?.activeOnly === true ? Prisma.sql`AND "isActive" = TRUE` : Prisma.empty}
        ${s(args?.accountId) ? Prisma.sql`AND "accountId" = ${s(args?.accountId)}` : Prisma.empty}
        ${s(args?.userId) ? Prisma.sql`AND "userId" = ${s(args?.userId)}` : Prisma.empty}
      ORDER BY "createdAt" DESC, "updatedAt" DESC
      LIMIT ${limit}
    `,
  );
  return rows.map((row) => normalizeRow(row)).filter((row): row is AdminTrackedAgentRecord => Boolean(row));
}

export async function getAdminTrackedAgentRecord(args: {
  accountId: string;
  userId: string;
  agentId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const agentId = normalizeAgentId(args.agentId);
  if (!accountId || !userId || !agentId) return null;
  const rows = await listAdminTrackedAgents({
    accountId,
    userId,
    limit: 240,
  });
  return rows.find((row) => row.agentId === agentId) || null;
}

export async function getPublishedOperatorAgentMap() {
  const rows = await listPublishedOperatorAgents({ limit: 240 });
  const bySource = new Map<string, PublishedOperatorAgentRecord>();
  for (const row of rows) {
    bySource.set(`${row.sourceAccountId}:${row.sourceUserId}:${row.sourceAgentId}`, row);
  }
  return bySource;
}
