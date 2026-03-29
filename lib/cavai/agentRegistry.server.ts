import "server-only";

import { Prisma } from "@prisma/client";

import type { PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import {
  AGENT_CATALOG,
  AGENT_CATALOG_BY_ID,
  type AgentCatalogEntry,
  type AgentPlanTier,
  DEFAULT_INSTALLED_AGENT_IDS,
  INSTALLABLE_AGENT_CATALOG,
  INSTALLABLE_AGENT_ID_SET,
  isAgentPlanEligible,
  normalizeAgentPlanTier,
} from "@/lib/cavai/agentCatalog";

export type AgentRegistryRow = {
  id: string;
  name: string;
  slug: string;
  summary: string;
  iconSrc: string;
  actionKey: string;
  cavcodeAction: string | null;
  centerAction: string | null;
  category: string;
  bank: string;
  visibility: string;
  planTier: AgentPlanTier;
  installable: boolean;
  hiddenSystem: boolean;
  availableToModes: string[];
  locked: boolean;
  sharedWithCaven: boolean;
  sharedWithCavai: boolean;
  sharedWithCompanion: boolean;
  supportForCaven: boolean;
  surface: string;
  mode: string;
  defaultInstalled: boolean;
  installedState: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentRegistryCard = {
  id: string;
  name: string;
  summary: string;
  iconSrc: string;
  actionKey: string;
  cavcodeAction: string | null;
  centerAction: string | null;
  minimumPlan: AgentPlanTier;
  installed: boolean;
  locked: boolean;
  bank: string;
  supportForCaven: boolean;
  source: "builtin";
};

export type AgentRegistryUiSnapshot = {
  generatedAt: string;
  caven: {
    installed: AgentRegistryCard[];
    available: AgentRegistryCard[];
    support: AgentRegistryCard[];
    premiumLocked: AgentRegistryCard[];
  };
  cavai: {
    installed: AgentRegistryCard[];
    available: AgentRegistryCard[];
    locked: AgentRegistryCard[];
  };
  companion: {
    installed: AgentRegistryCard[];
    available: AgentRegistryCard[];
  };
  hiddenSystemIds: string[];
};

type RawRegistryRow = {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  icon_src: string | null;
  action_key: string | null;
  cavcode_action: string | null;
  center_action: string | null;
  category: string;
  bank: string;
  visibility: string;
  plan_tier: string;
  installable: boolean;
  hidden_system: boolean;
  available_to_modes: unknown;
  locked: boolean;
  shared_with_caven: boolean;
  shared_with_cavai: boolean;
  shared_with_companion: boolean;
  support_for_caven: boolean;
  surface: string;
  mode: string;
  default_installed: boolean;
  installed_state: boolean;
  display_order: number;
  created_at: Date | string;
  updated_at: Date | string;
};

let tableReady = false;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function bool(value: unknown, fallback = false): boolean {
  return value == null ? fallback : value === true;
}

function toIso(value: unknown): string {
  const raw = value instanceof Date ? value.toISOString() : s(value);
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return new Date().toISOString();
  return new Date(ts).toISOString();
}

function normalizeModes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const item of value) {
    const mode = s(item).toLowerCase();
    if (!mode || seen.has(mode)) continue;
    seen.add(mode);
    rows.push(mode);
    if (rows.length >= 8) break;
  }
  return rows;
}

function toPlanTier(planId: PlanId | undefined): AgentPlanTier {
  return normalizeAgentPlanTier(planId || "free");
}

function lockedForPlan(entry: AgentCatalogEntry, accountPlanTier: AgentPlanTier): boolean {
  if (!entry.installable || entry.visibility !== "visible") return false;
  return !isAgentPlanEligible(entry.planTier, accountPlanTier);
}

async function ensureAgentRegistryTable() {
  if (tableReady) return;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS agent_registry (
      account_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      id VARCHAR(64) NOT NULL,
      name VARCHAR(160) NOT NULL,
      slug VARCHAR(160) NOT NULL,
      summary TEXT,
      icon_src TEXT,
      action_key VARCHAR(64),
      cavcode_action VARCHAR(64),
      center_action VARCHAR(64),
      category VARCHAR(48) NOT NULL,
      bank VARCHAR(48) NOT NULL,
      visibility VARCHAR(24) NOT NULL,
      plan_tier VARCHAR(24) NOT NULL DEFAULT 'free',
      installable BOOLEAN NOT NULL DEFAULT FALSE,
      available_to_modes JSONB NOT NULL DEFAULT '[]'::jsonb,
      hidden_system BOOLEAN NOT NULL DEFAULT FALSE,
      locked BOOLEAN NOT NULL DEFAULT FALSE,
      shared_with_caven BOOLEAN NOT NULL DEFAULT FALSE,
      shared_with_cavai BOOLEAN NOT NULL DEFAULT FALSE,
      shared_with_companion BOOLEAN NOT NULL DEFAULT FALSE,
      support_for_caven BOOLEAN NOT NULL DEFAULT FALSE,
      surface VARCHAR(24) NOT NULL DEFAULT 'all',
      mode VARCHAR(24) NOT NULL DEFAULT 'general',
      default_installed BOOLEAN NOT NULL DEFAULT FALSE,
      installed_state BOOLEAN NOT NULL DEFAULT FALSE,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, user_id, id)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS agent_registry_lookup_idx
    ON agent_registry (account_id, user_id, bank, installable, installed_state, updated_at DESC);
  `);

  tableReady = true;
}

async function readRegistryRows(args: { accountId: string; userId: string }): Promise<RawRegistryRow[]> {
  return prisma.$queryRaw<RawRegistryRow[]>(
    Prisma.sql`
      SELECT
        id,
        name,
        slug,
        summary,
        icon_src,
        action_key,
        cavcode_action,
        center_action,
        category,
        bank,
        visibility,
        plan_tier,
        installable,
        available_to_modes,
        hidden_system,
        locked,
        shared_with_caven,
        shared_with_cavai,
        shared_with_companion,
        support_for_caven,
        surface,
        mode,
        default_installed,
        installed_state,
        display_order,
        created_at,
        updated_at
      FROM agent_registry
      WHERE account_id = ${args.accountId}
        AND user_id = ${args.userId}
      ORDER BY display_order ASC, id ASC
    `,
  );
}

function rowToDto(row: RawRegistryRow): AgentRegistryRow {
  const id = s(row.id).toLowerCase();
  const catalogEntry = AGENT_CATALOG_BY_ID.get(id);
  return {
    id,
    name: catalogEntry?.name || s(row.name),
    slug: s(row.slug),
    summary: s(row.summary),
    iconSrc: s(row.icon_src),
    actionKey: s(row.action_key),
    cavcodeAction: s(row.cavcode_action) || null,
    centerAction: s(row.center_action) || null,
    category: s(row.category),
    bank: s(row.bank),
    visibility: s(row.visibility),
    planTier: normalizeAgentPlanTier(row.plan_tier),
    installable: bool(row.installable),
    hiddenSystem: bool(row.hidden_system),
    availableToModes: normalizeModes(row.available_to_modes),
    locked: bool(row.locked),
    sharedWithCaven: bool(row.shared_with_caven),
    sharedWithCavai: bool(row.shared_with_cavai),
    sharedWithCompanion: bool(row.shared_with_companion),
    supportForCaven: bool(row.support_for_caven),
    surface: s(row.surface),
    mode: s(row.mode),
    defaultInstalled: bool(row.default_installed),
    installedState: bool(row.installed_state),
    displayOrder: Math.max(0, Math.trunc(Number(row.display_order) || 0)),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function seedAndSyncAgentRegistry(args: {
  accountId: string;
  userId: string;
  planId?: PlanId;
  legacyInstalledAgentIds?: string[];
}): Promise<void> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return;

  await ensureAgentRegistryTable();

  const existing = await readRegistryRows({ accountId, userId });
  const existingInstalled = new Map<string, boolean>();
  for (const row of existing) {
    existingInstalled.set(s(row.id).toLowerCase(), bool(row.installed_state));
  }

  const legacyInstalledSet = new Set(
    (Array.isArray(args.legacyInstalledAgentIds) ? args.legacyInstalledAgentIds : [])
      .map((id) => s(id).toLowerCase())
      .filter(Boolean),
  );

  const planTier = toPlanTier(args.planId);

  for (const entry of AGENT_CATALOG) {
    const existingState = existingInstalled.get(entry.id);
    const initialInstalled = entry.hiddenSystem
      ? true
      : existingState !== undefined
        ? existingState
        : (legacyInstalledSet.has(entry.id)
            || (
              entry.defaultInstalled
              && entry.installable
              && entry.visibility === "visible"
              && isAgentPlanEligible(entry.planTier, planTier)
            ));

    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO agent_registry (
          account_id,
          user_id,
          id,
          name,
          slug,
          summary,
          icon_src,
          action_key,
          cavcode_action,
          center_action,
          category,
          bank,
          visibility,
          plan_tier,
          installable,
          available_to_modes,
          hidden_system,
          locked,
          shared_with_caven,
          shared_with_cavai,
          shared_with_companion,
          support_for_caven,
          surface,
          mode,
          default_installed,
          installed_state,
          display_order,
          created_at,
          updated_at
        ) VALUES (
          ${accountId},
          ${userId},
          ${entry.id},
          ${entry.name},
          ${entry.slug},
          ${entry.summary || null},
          ${entry.iconSrc || null},
          ${entry.actionKey || null},
          ${entry.cavcodeAction || null},
          ${entry.centerAction || null},
          ${entry.category},
          ${entry.bank},
          ${entry.visibility},
          ${entry.planTier},
          ${entry.installable},
          CAST(${JSON.stringify(entry.availableToModes)} AS jsonb),
          ${entry.hiddenSystem},
          ${lockedForPlan(entry, planTier)},
          ${entry.sharedWithCaven},
          ${entry.sharedWithCavai},
          ${entry.sharedWithCompanion},
          ${entry.supportForCaven},
          ${entry.surface},
          ${entry.mode},
          ${entry.defaultInstalled},
          ${initialInstalled},
          ${entry.displayOrder},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (account_id, user_id, id)
        DO UPDATE SET
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          summary = EXCLUDED.summary,
          icon_src = EXCLUDED.icon_src,
          action_key = EXCLUDED.action_key,
          cavcode_action = EXCLUDED.cavcode_action,
          center_action = EXCLUDED.center_action,
          category = EXCLUDED.category,
          bank = EXCLUDED.bank,
          visibility = EXCLUDED.visibility,
          plan_tier = EXCLUDED.plan_tier,
          installable = EXCLUDED.installable,
          available_to_modes = EXCLUDED.available_to_modes,
          hidden_system = EXCLUDED.hidden_system,
          locked = EXCLUDED.locked,
          shared_with_caven = EXCLUDED.shared_with_caven,
          shared_with_cavai = EXCLUDED.shared_with_cavai,
          shared_with_companion = EXCLUDED.shared_with_companion,
          support_for_caven = EXCLUDED.support_for_caven,
          surface = EXCLUDED.surface,
          mode = EXCLUDED.mode,
          default_installed = EXCLUDED.default_installed,
          display_order = EXCLUDED.display_order,
          updated_at = CURRENT_TIMESTAMP
      `,
    );
  }

  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE agent_registry
      SET installed_state = TRUE,
          updated_at = CURRENT_TIMESTAMP
      WHERE account_id = ${accountId}
        AND user_id = ${userId}
        AND hidden_system = TRUE
    `,
  );
}

export async function listAgentRegistryRows(args: {
  accountId: string;
  userId: string;
  planId?: PlanId;
  legacyInstalledAgentIds?: string[];
}): Promise<AgentRegistryRow[]> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return [];

  await seedAndSyncAgentRegistry({
    accountId,
    userId,
    planId: args.planId,
    legacyInstalledAgentIds: args.legacyInstalledAgentIds,
  });

  const rows = await readRegistryRows({ accountId, userId });
  return rows.map(rowToDto);
}

function toCard(row: AgentRegistryRow): AgentRegistryCard {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    iconSrc: row.iconSrc,
    actionKey: row.actionKey,
    cavcodeAction: row.cavcodeAction,
    centerAction: row.centerAction,
    minimumPlan: row.planTier,
    installed: row.installedState,
    locked: row.locked,
    bank: row.bank,
    supportForCaven: row.supportForCaven,
    source: "builtin",
  };
}

function orderCards(rows: AgentRegistryRow[]): AgentRegistryCard[] {
  return rows
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((row) => toCard(row));
}

export async function getAgentRegistryUiSnapshot(args: {
  accountId: string;
  userId: string;
  planId?: PlanId;
  legacyInstalledAgentIds?: string[];
}): Promise<AgentRegistryUiSnapshot> {
  const rows = await listAgentRegistryRows(args);

  const visibleInstallable = rows.filter((row) => row.installable && row.visibility === "visible");

  const cavenNative = visibleInstallable.filter((row) => row.bank === "caven_native");
  const cavenInstalled = cavenNative.filter((row) => row.installedState && !row.locked);
  const cavenAvailable = cavenNative.filter((row) => !row.installedState && !row.locked);
  const cavenPremiumLocked = cavenNative.filter((row) => row.locked);
  const cavenSupport = visibleInstallable.filter((row) => row.bank === "cavai_work" && row.supportForCaven);

  const cavaiWork = visibleInstallable.filter((row) => row.bank === "cavai_work");
  const cavaiInstalled = cavaiWork.filter((row) => row.installedState && !row.locked);
  const cavaiAvailable = cavaiWork.filter((row) => !row.installedState && !row.locked);
  const cavaiLocked = cavaiWork.filter((row) => row.locked);

  const companion = visibleInstallable.filter((row) => row.bank === "companion");
  const companionInstalled = companion.filter((row) => row.installedState && !row.locked);
  const companionAvailable = companion.filter((row) => !row.installedState && !row.locked);

  const hiddenSystemIds = rows
    .filter((row) => row.hiddenSystem)
    .map((row) => row.id);

  return {
    generatedAt: new Date().toISOString(),
    caven: {
      installed: orderCards(cavenInstalled),
      available: orderCards(cavenAvailable),
      support: orderCards(cavenSupport),
      premiumLocked: orderCards(cavenPremiumLocked),
    },
    cavai: {
      installed: orderCards(cavaiInstalled),
      available: orderCards(cavaiAvailable),
      locked: orderCards(cavaiLocked),
    },
    companion: {
      installed: orderCards(companionInstalled),
      available: orderCards(companionAvailable),
    },
    hiddenSystemIds,
  };
}

export async function updateBuiltInInstallState(args: {
  accountId: string;
  userId: string;
  planId?: PlanId;
  installedAgentIds: string[];
  legacyInstalledAgentIds?: string[];
}): Promise<string[]> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return [];

  const planTier = toPlanTier(args.planId);

  await seedAndSyncAgentRegistry({
    accountId,
    userId,
    planId: args.planId,
    legacyInstalledAgentIds: args.legacyInstalledAgentIds,
  });

  const requestedInstalledSet = new Set(
    (Array.isArray(args.installedAgentIds) ? args.installedAgentIds : [])
      .map((id) => s(id).toLowerCase())
      .filter((id) => INSTALLABLE_AGENT_ID_SET.has(id)),
  );

  for (const entry of INSTALLABLE_AGENT_CATALOG) {
    const nextInstalled = requestedInstalledSet.has(entry.id) && isAgentPlanEligible(entry.planTier, planTier);
    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE agent_registry
        SET installed_state = ${nextInstalled},
            locked = ${lockedForPlan(entry, planTier)},
            updated_at = CURRENT_TIMESTAMP
        WHERE account_id = ${accountId}
          AND user_id = ${userId}
          AND id = ${entry.id}
      `,
    );
  }

  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE agent_registry
      SET installed_state = TRUE,
          updated_at = CURRENT_TIMESTAMP
      WHERE account_id = ${accountId}
        AND user_id = ${userId}
        AND hidden_system = TRUE
    `,
  );

  const rows = await listAgentRegistryRows({ accountId, userId, planId: args.planId });
  return rows
    .filter((row) => row.installable && row.visibility === "visible" && row.installedState && !row.locked)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((row) => row.id);
}

export async function listActiveInstalledBuiltInAgentIds(args: {
  accountId: string;
  userId: string;
  planId?: PlanId;
  legacyInstalledAgentIds?: string[];
}): Promise<string[]> {
  const rows = await listAgentRegistryRows(args);
  return rows
    .filter((row) => row.installable && row.visibility === "visible" && row.installedState && !row.locked)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((row) => row.id);
}

function isInstalledForAction(rows: AgentRegistryRow[], action: string): boolean {
  const matches = rows.filter(
    (row) => row.installable && row.visibility === "visible" && row.cavcodeAction === action,
  );
  if (!matches.length) return true;
  return matches.some((row) => row.installedState && !row.locked);
}

const CAVCODE_FALLBACK_ACTIONS = [
  "suggest_fix",
  "explain_error",
  "explain_code",
  "summarize_file",
  "write_note",
] as const;

export async function resolveInstalledCavCodeAction(args: {
  accountId: string;
  userId: string;
  planId?: PlanId;
  requestedAction: string;
  legacyInstalledAgentIds?: string[];
}): Promise<{ action: string; downgraded: boolean }> {
  const requestedAction = s(args.requestedAction).toLowerCase();
  if (!requestedAction) return { action: requestedAction, downgraded: false };

  const rows = await listAgentRegistryRows({
    accountId: args.accountId,
    userId: args.userId,
    planId: args.planId,
    legacyInstalledAgentIds: args.legacyInstalledAgentIds,
  });

  if (isInstalledForAction(rows, requestedAction)) {
    return { action: requestedAction, downgraded: false };
  }

  for (const fallbackAction of CAVCODE_FALLBACK_ACTIONS) {
    if (isInstalledForAction(rows, fallbackAction)) {
      return { action: fallbackAction, downgraded: true };
    }
  }

  return { action: requestedAction, downgraded: false };
}

export function isInstallableAgentId(id: string): boolean {
  return INSTALLABLE_AGENT_ID_SET.has(s(id).toLowerCase());
}

export function defaultInstalledAgentIds(): string[] {
  return [...DEFAULT_INSTALLED_AGENT_IDS];
}

export function agentMinimumPlan(agentId: string): AgentPlanTier {
  return AGENT_CATALOG_BY_ID.get(s(agentId).toLowerCase())?.planTier || "free";
}
