import "server-only";

import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type OperatorAgentSurface = "cavcode" | "center" | "all";

export type OperatorAgentPublicationCandidate = {
  id: string;
  name: string;
  summary: string;
  actionKey: string;
  surface: OperatorAgentSurface;
  triggers: string[];
  instructions: string;
  iconSvg: string;
  iconBackground?: string | null;
  publicationRequested?: boolean;
  publicationRequestedAt?: string | null;
};

export type PublishedOperatorAgentRecord = {
  id: string;
  sourceAgentId: string;
  sourceUserId: string;
  sourceAccountId: string;
  ownerName: string;
  ownerUsername: string | null;
  name: string;
  summary: string;
  actionKey: string;
  surface: OperatorAgentSurface;
  triggers: string[];
  instructions: string;
  iconSvg: string;
  iconBackground: string | null;
  publishedAt: string;
  updatedAt: string;
};

type OwnerIdentity = {
  ownerName: string;
  ownerUsername: string | null;
};

type RawPublishedOperatorAgentRow = {
  publishedAgentId: string | null;
  sourceAgentId: string | null;
  sourceUserId: string | null;
  sourceAccountId: string | null;
  ownerName: string | null;
  ownerUsername: string | null;
  name: string | null;
  summary: string | null;
  actionKey: string | null;
  surface: string | null;
  triggers: unknown;
  instructions: string | null;
  iconSvg: string | null;
  iconBackground: string | null;
  publishedAt: Date | string | null;
  updatedAt: Date | string | null;
};

const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const AGENT_ACTION_KEY_RE = /^[a-z0-9][a-z0-9_]{1,63}$/;
const MAX_TRIGGERS = 12;
const MAX_LIST_LIMIT = 240;
const REQUIRED_OPERATOR_AGENT_TABLES = [
  "OperatorAgentPublicationQueue",
  "OperatorPublishedAgent",
] as const;

let tablesReady = false;
let tablesReadyPromise: Promise<void> | null = null;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeSurface(value: unknown): OperatorAgentSurface {
  const raw = s(value).toLowerCase();
  if (raw === "cavcode" || raw === "center" || raw === "all") return raw;
  return "all";
}

function normalizeAgentId(value: unknown): string {
  const id = s(value).toLowerCase();
  return AGENT_ID_RE.test(id) ? id : "";
}

function normalizeActionKey(value: unknown): string {
  const actionKey = s(value).toLowerCase();
  return AGENT_ACTION_KEY_RE.test(actionKey) ? actionKey : "";
}

function normalizeTriggers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const item of value) {
    const trigger = s(item);
    if (!trigger) continue;
    const dedupeKey = trigger.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    rows.push(trigger);
    if (rows.length >= MAX_TRIGGERS) break;
  }
  return rows;
}

async function operatorAgentTablesExist(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ table_name: string | null }>>(
      Prisma.sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name IN (${Prisma.join(REQUIRED_OPERATOR_AGENT_TABLES.map((tableName) => Prisma.sql`${tableName}`), ", ")})
      `,
    );
    const existing = new Set(rows.map((row) => s(row.table_name)));
    return REQUIRED_OPERATOR_AGENT_TABLES.every((tableName) => existing.has(tableName));
  } catch {
    return false;
  }
}

function publishedAgentIdForSource(userId: string, sourceAgentId: string): string {
  const digest = createHash("sha256")
    .update(`${normalizeAgentId(userId)}:${normalizeAgentId(sourceAgentId)}`)
    .digest("hex")
    .slice(0, 20);
  return `pub_${digest}`;
}

function publishedActionKeyForSource(userId: string, sourceAgentId: string, actionKey: string): string {
  const digest = createHash("sha256")
    .update(`${normalizeAgentId(userId)}:${normalizeAgentId(sourceAgentId)}:${normalizeActionKey(actionKey)}`)
    .digest("hex")
    .slice(0, 8);
  const slug = normalizeActionKey(actionKey) || "agent";
  const scoped = `pub_${digest}_${slug}`.slice(0, 64).replace(/^_+|_+$/g, "");
  return AGENT_ACTION_KEY_RE.test(scoped) ? scoped : `pub_${digest}_agent`;
}

function isSurfaceCompatible(surface: OperatorAgentSurface, runtimeSurface?: "cavcode" | "center" | null): boolean {
  if (!runtimeSurface) return true;
  if (surface === "all") return true;
  return surface === runtimeSurface;
}

function normalizePublishedAgentRow(row: RawPublishedOperatorAgentRow): PublishedOperatorAgentRecord | null {
  const id = normalizeAgentId(row.publishedAgentId);
  const sourceAgentId = normalizeAgentId(row.sourceAgentId);
  const sourceUserId = s(row.sourceUserId);
  const sourceAccountId = s(row.sourceAccountId);
  const name = s(row.name).replace(/\s+/g, " ").slice(0, 96);
  const summary = s(row.summary).replace(/\s+/g, " ").slice(0, 240);
  const actionKey = normalizeActionKey(row.actionKey);
  const instructions = s(row.instructions).slice(0, 12_000);
  const iconSvg = s(row.iconSvg);
  if (!id || !sourceAgentId || !sourceUserId || !sourceAccountId || !name || !summary || !actionKey || !instructions || !iconSvg) {
    return null;
  }
  const publishedAtIso = row.publishedAt instanceof Date
    ? row.publishedAt.toISOString()
    : (Number.isFinite(Date.parse(s(row.publishedAt))) ? new Date(s(row.publishedAt)).toISOString() : new Date(0).toISOString());
  const updatedAtIso = row.updatedAt instanceof Date
    ? row.updatedAt.toISOString()
    : (Number.isFinite(Date.parse(s(row.updatedAt))) ? new Date(s(row.updatedAt)).toISOString() : publishedAtIso);
  return {
    id,
    sourceAgentId,
    sourceUserId,
    sourceAccountId,
    ownerName: s(row.ownerName) || "Operator",
    ownerUsername: s(row.ownerUsername) || null,
    name,
    summary,
    actionKey,
    surface: normalizeSurface(row.surface),
    triggers: normalizeTriggers(row.triggers),
    instructions,
    iconSvg,
    iconBackground: s(row.iconBackground) || null,
    publishedAt: publishedAtIso,
    updatedAt: updatedAtIso,
  };
}

async function ensureOperatorAgentTables() {
  if (tablesReady) return;
  if (tablesReadyPromise) {
    await tablesReadyPromise;
    return;
  }
  tablesReadyPromise = (async () => {
  if (await operatorAgentTablesExist()) {
    tablesReady = true;
    return;
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OperatorAgentPublicationQueue" (
      "accountId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "agentId" TEXT NOT NULL,
      "publishedAgentId" TEXT NOT NULL,
      "status" VARCHAR(24) NOT NULL DEFAULT 'submitted',
      "ownerName" VARCHAR(120) NOT NULL DEFAULT '',
      "ownerUsername" VARCHAR(120),
      "agentName" VARCHAR(96) NOT NULL DEFAULT '',
      "surface" VARCHAR(16) NOT NULL DEFAULT 'all',
      "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY ("userId", "agentId")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "OperatorPublishedAgent" (
      "publishedAgentId" TEXT PRIMARY KEY,
      "sourceUserId" TEXT NOT NULL,
      "sourceAccountId" TEXT NOT NULL,
      "sourceAgentId" TEXT NOT NULL,
      "ownerName" VARCHAR(120) NOT NULL DEFAULT '',
      "ownerUsername" VARCHAR(120),
      "name" VARCHAR(96) NOT NULL,
      "summary" VARCHAR(240) NOT NULL,
      "actionKey" VARCHAR(64) NOT NULL,
      "surface" VARCHAR(16) NOT NULL DEFAULT 'all',
      "triggers" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "instructions" TEXT NOT NULL,
      "iconSvg" TEXT NOT NULL,
      "iconBackground" VARCHAR(16),
      "publishedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("sourceUserId", "sourceAgentId")
    );
  `);
  tablesReady = true;
  })().catch((error) => {
    tablesReadyPromise = null;
    throw error;
  });
  await tablesReadyPromise;
}

async function resolveOwnerIdentity(userId: string): Promise<OwnerIdentity> {
  if (!s(userId)) {
    return { ownerName: "Operator", ownerUsername: null };
  }
  try {
    const rows = await prisma.$queryRaw<Array<{
      displayName: string | null;
      fullName: string | null;
      username: string | null;
      email: string | null;
    }>>(
      Prisma.sql`
        SELECT "displayName", "fullName", "username", "email"
        FROM "User"
        WHERE "id" = ${userId}
        LIMIT 1
      `
    );
    const row = rows[0];
    const ownerUsername = s(row?.username) || null;
    const ownerName = s(row?.displayName) || s(row?.fullName) || ownerUsername || s(row?.email).split("@")[0] || "Operator";
    return {
      ownerName: ownerName.slice(0, 120),
      ownerUsername: ownerUsername ? ownerUsername.slice(0, 120) : null,
    };
  } catch {
    return { ownerName: "Operator", ownerUsername: null };
  }
}

export async function syncOperatorAgentPublicationState(args: {
  accountId: string;
  userId: string;
  agents: readonly OperatorAgentPublicationCandidate[];
}): Promise<void> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return;
  await ensureOperatorAgentTables();

  const owner = await resolveOwnerIdentity(userId);
  const requestedAgents = (Array.isArray(args.agents) ? args.agents : []).filter(
    (agent) => agent && agent.publicationRequested === true && normalizeAgentId(agent.id)
  );

  if (!requestedAgents.length) {
    await prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM "OperatorAgentPublicationQueue"
        WHERE "accountId" = ${accountId}
          AND "userId" = ${userId}
      `
    );
    return;
  }

  const requestedIds = requestedAgents
    .map((agent) => normalizeAgentId(agent.id))
    .filter(Boolean);

  await prisma.$executeRaw(
    Prisma.sql`
      DELETE FROM "OperatorAgentPublicationQueue"
      WHERE "accountId" = ${accountId}
        AND "userId" = ${userId}
        AND NOT ("agentId" IN (${Prisma.join(requestedIds.map((id) => Prisma.sql`${id}`), ", ")}))
    `
  );

  for (const agent of requestedAgents) {
    const agentId = normalizeAgentId(agent.id);
    const actionKey = normalizeActionKey(agent.actionKey);
    if (!agentId || !actionKey) continue;
    const requestedAt = Number.isFinite(Date.parse(s(agent.publicationRequestedAt)))
      ? new Date(s(agent.publicationRequestedAt)).toISOString()
      : new Date().toISOString();
    const publishedAgentId = publishedAgentIdForSource(userId, agentId);
    const payload = {
      id: agentId,
      publishedAgentId,
      name: s(agent.name).replace(/\s+/g, " ").slice(0, 96),
      summary: s(agent.summary).replace(/\s+/g, " ").slice(0, 240),
      actionKey,
      surface: normalizeSurface(agent.surface),
      triggers: normalizeTriggers(agent.triggers),
      instructions: s(agent.instructions).slice(0, 12_000),
      iconSvg: s(agent.iconSvg),
      iconBackground: s(agent.iconBackground) || null,
      publicationRequested: true,
      publicationRequestedAt: requestedAt,
      ownerName: owner.ownerName,
      ownerUsername: owner.ownerUsername,
    };
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "OperatorAgentPublicationQueue" (
          "accountId",
          "userId",
          "agentId",
          "publishedAgentId",
          "status",
          "ownerName",
          "ownerUsername",
          "agentName",
          "surface",
          "payload",
          "requestedAt",
          "updatedAt"
        )
        VALUES (
          ${accountId},
          ${userId},
          ${agentId},
          ${publishedAgentId},
          'submitted',
          ${owner.ownerName},
          ${owner.ownerUsername},
          ${payload.name},
          ${payload.surface},
          CAST(${JSON.stringify(payload)} AS jsonb),
          ${requestedAt}::timestamptz,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("userId", "agentId")
        DO UPDATE SET
          "publishedAgentId" = EXCLUDED."publishedAgentId",
          "status" = 'submitted',
          "ownerName" = EXCLUDED."ownerName",
          "ownerUsername" = EXCLUDED."ownerUsername",
          "agentName" = EXCLUDED."agentName",
          "surface" = EXCLUDED."surface",
          "payload" = EXCLUDED."payload",
          "requestedAt" = EXCLUDED."requestedAt",
          "updatedAt" = CURRENT_TIMESTAMP
      `
    );
  }
}

export async function listPublishedOperatorAgents(args?: {
  surface?: "cavcode" | "center" | null;
  excludeUserId?: string | null;
  limit?: number;
}): Promise<PublishedOperatorAgentRecord[]> {
  await ensureOperatorAgentTables();
  const excludeUserId = s(args?.excludeUserId);
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(Number(args?.limit) || 80)));
  const rows = await prisma.$queryRaw<RawPublishedOperatorAgentRow[]>(
    Prisma.sql`
      SELECT
        "publishedAgentId",
        "sourceAgentId",
        "sourceUserId",
        "sourceAccountId",
        "ownerName",
        "ownerUsername",
        "name",
        "summary",
        "actionKey",
        "surface",
        "triggers",
        "instructions",
        "iconSvg",
        "iconBackground",
        "publishedAt",
        "updatedAt"
      FROM "OperatorPublishedAgent"
      WHERE 1 = 1
        ${excludeUserId ? Prisma.sql`AND "sourceUserId" <> ${excludeUserId}` : Prisma.empty}
      ORDER BY "publishedAt" DESC, "updatedAt" DESC
      LIMIT ${limit}
    `
  );
  return rows
    .map((row) => normalizePublishedAgentRow(row))
    .filter((row): row is PublishedOperatorAgentRecord => Boolean(row))
    .filter((row) => isSurfaceCompatible(row.surface, args?.surface || null));
}

export async function listPublishedOperatorAgentIds(): Promise<string[]> {
  const rows = await listPublishedOperatorAgents({ limit: MAX_LIST_LIMIT });
  return rows.map((row) => row.id);
}

export async function listOwnedPublishedOperatorSourceAgentIds(args: {
  userId: string;
  limit?: number;
}): Promise<string[]> {
  const userId = s(args.userId);
  if (!userId) return [];
  await ensureOperatorAgentTables();
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(Number(args.limit) || 240)));
  const rows = await prisma.$queryRaw<Array<{ sourceAgentId: string | null }>>(
    Prisma.sql`
      SELECT "sourceAgentId"
      FROM "OperatorPublishedAgent"
      WHERE "sourceUserId" = ${userId}
      ORDER BY "publishedAt" DESC, "updatedAt" DESC
      LIMIT ${limit}
    `
  );
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    const id = normalizeAgentId(row?.sourceAgentId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export async function upsertPublishedOperatorAgent(args: {
  accountId: string;
  userId: string;
  agent: OperatorAgentPublicationCandidate;
  publishedAt?: string | null;
}): Promise<PublishedOperatorAgentRecord | null> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const sourceAgentId = normalizeAgentId(args.agent.id);
  const name = s(args.agent.name).replace(/\s+/g, " ").slice(0, 96);
  const summary = s(args.agent.summary).replace(/\s+/g, " ").slice(0, 240);
  const instructions = s(args.agent.instructions).slice(0, 12_000);
  const iconSvg = s(args.agent.iconSvg);
  if (!accountId || !userId || !sourceAgentId || !name || !summary || !instructions || !iconSvg) {
    return null;
  }
  await ensureOperatorAgentTables();
  const owner = await resolveOwnerIdentity(userId);
  const publishedAgentId = publishedAgentIdForSource(userId, sourceAgentId);
  const actionKey = publishedActionKeyForSource(userId, sourceAgentId, args.agent.actionKey);
  const publishedAt = Number.isFinite(Date.parse(s(args.publishedAt)))
    ? new Date(s(args.publishedAt)).toISOString()
    : new Date().toISOString();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "OperatorPublishedAgent" (
        "publishedAgentId",
        "sourceUserId",
        "sourceAccountId",
        "sourceAgentId",
        "ownerName",
        "ownerUsername",
        "name",
        "summary",
        "actionKey",
        "surface",
        "triggers",
        "instructions",
        "iconSvg",
        "iconBackground",
        "publishedAt",
        "updatedAt"
      )
      VALUES (
        ${publishedAgentId},
        ${userId},
        ${accountId},
        ${sourceAgentId},
        ${owner.ownerName},
        ${owner.ownerUsername},
        ${name},
        ${summary},
        ${actionKey},
        ${normalizeSurface(args.agent.surface)},
        CAST(${JSON.stringify(normalizeTriggers(args.agent.triggers))} AS jsonb),
        ${instructions},
        ${iconSvg},
        ${s(args.agent.iconBackground) || null},
        ${publishedAt}::timestamptz,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("publishedAgentId")
      DO UPDATE SET
        "sourceUserId" = EXCLUDED."sourceUserId",
        "sourceAccountId" = EXCLUDED."sourceAccountId",
        "sourceAgentId" = EXCLUDED."sourceAgentId",
        "ownerName" = EXCLUDED."ownerName",
        "ownerUsername" = EXCLUDED."ownerUsername",
        "name" = EXCLUDED."name",
        "summary" = EXCLUDED."summary",
        "actionKey" = EXCLUDED."actionKey",
        "surface" = EXCLUDED."surface",
        "triggers" = EXCLUDED."triggers",
        "instructions" = EXCLUDED."instructions",
        "iconSvg" = EXCLUDED."iconSvg",
        "iconBackground" = EXCLUDED."iconBackground",
        "publishedAt" = EXCLUDED."publishedAt",
        "updatedAt" = CURRENT_TIMESTAMP
    `
  );
  const rows = await listPublishedOperatorAgents({ limit: MAX_LIST_LIMIT });
  return rows.find((row) => row.id === publishedAgentId) || null;
}

export async function removePublishedOperatorAgent(args: {
  userId: string;
  agentId: string;
}): Promise<void> {
  const userId = s(args.userId);
  const sourceAgentId = normalizeAgentId(args.agentId);
  if (!userId || !sourceAgentId) return;
  await ensureOperatorAgentTables();
  await prisma.$executeRaw(
    Prisma.sql`
      DELETE FROM "OperatorPublishedAgent"
      WHERE "sourceUserId" = ${userId}
        AND "sourceAgentId" = ${sourceAgentId}
    `
  );
}
