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
  HIDDEN_SYSTEM_AGENT_IDS,
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
let tableReadyPromise: Promise<void> | null = null;
const registrySyncFingerprintByScope = new Map<string, string>();
const registrySyncPromiseByScope = new Map<string, Promise<void>>();
const AGENT_REGISTRY_CATALOG_FINGERPRINT = AGENT_CATALOG
  .map((entry) => [
    entry.id,
    entry.planTier,
    entry.installable ? "1" : "0",
    entry.visibility,
    entry.displayOrder,
  ].join(":"))
  .join("|");
const REQUIRED_AGENT_REGISTRY_COLUMNS = [
  "account_id",
  "user_id",
  "id",
  "name",
  "slug",
  "summary",
  "icon_src",
  "action_key",
  "cavcode_action",
  "center_action",
  "category",
  "bank",
  "visibility",
  "plan_tier",
  "installable",
  "available_to_modes",
  "hidden_system",
  "locked",
  "shared_with_caven",
  "shared_with_cavai",
  "shared_with_companion",
  "support_for_caven",
  "surface",
  "mode",
  "default_installed",
  "installed_state",
  "display_order",
  "created_at",
  "updated_at",
] as const;

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

function rowMatchesCatalogEntry(
  row: RawRegistryRow | undefined,
  entry: AgentCatalogEntry,
  accountPlanTier: AgentPlanTier,
): boolean {
  if (!row) return false;
  const expectedModes = [...entry.availableToModes].map((mode) => s(mode).toLowerCase()).filter(Boolean);
  const actualModes = normalizeModes(row.available_to_modes);
  return s(row.name) === entry.name
    && s(row.slug) === entry.slug
    && s(row.summary) === (entry.summary || "")
    && s(row.icon_src) === (entry.iconSrc || "")
    && s(row.action_key) === (entry.actionKey || "")
    && s(row.cavcode_action) === (entry.cavcodeAction || "")
    && s(row.center_action) === (entry.centerAction || "")
    && s(row.category) === entry.category
    && s(row.bank) === entry.bank
    && s(row.visibility) === entry.visibility
    && normalizeAgentPlanTier(row.plan_tier) === entry.planTier
    && bool(row.installable) === entry.installable
    && actualModes.length === expectedModes.length
    && actualModes.every((mode, index) => mode === expectedModes[index])
    && bool(row.hidden_system) === entry.hiddenSystem
    && bool(row.locked) === lockedForPlan(entry, accountPlanTier)
    && bool(row.shared_with_caven) === entry.sharedWithCaven
    && bool(row.shared_with_cavai) === entry.sharedWithCavai
    && bool(row.shared_with_companion) === entry.sharedWithCompanion
    && bool(row.support_for_caven) === entry.supportForCaven
    && s(row.surface) === entry.surface
    && s(row.mode) === entry.mode
    && bool(row.default_installed) === entry.defaultInstalled
    && Math.max(0, Math.trunc(Number(row.display_order) || 0)) === entry.displayOrder;
}

async function agentRegistrySchemaReady(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<Array<{ column_name: string | null }>>(
      Prisma.sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'agent_registry'
      `,
    );
    if (!rows.length) return false;
    const existing = new Set(rows.map((row) => s(row.column_name)));
    return REQUIRED_AGENT_REGISTRY_COLUMNS.every((columnName) => existing.has(columnName));
  } catch {
    return false;
  }
}

async function ensureAgentRegistryTable() {
  if (tableReady) return;
  if (tableReadyPromise) {
    await tableReadyPromise;
    return;
  }
  tableReadyPromise = (async () => {
  if (await agentRegistrySchemaReady()) {
    tableReady = true;
    return;
  }

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

  const alterStatements = [
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS name VARCHAR(160) NOT NULL DEFAULT '';`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS slug VARCHAR(160) NOT NULL DEFAULT '';`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS summary TEXT;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS icon_src TEXT;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS action_key VARCHAR(64);`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS cavcode_action VARCHAR(64);`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS center_action VARCHAR(64);`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS category VARCHAR(48) NOT NULL DEFAULT 'mode_feature';`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS bank VARCHAR(48) NOT NULL DEFAULT 'none';`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS visibility VARCHAR(24) NOT NULL DEFAULT 'visible';`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(24) NOT NULL DEFAULT 'free';`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS installable BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS available_to_modes JSONB NOT NULL DEFAULT '[]'::jsonb;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS hidden_system BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS shared_with_caven BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS shared_with_cavai BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS shared_with_companion BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS support_for_caven BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS surface VARCHAR(24) NOT NULL DEFAULT 'all';`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS mode VARCHAR(24) NOT NULL DEFAULT 'general';`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS default_installed BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS installed_state BOOLEAN NOT NULL DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE agent_registry ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE agent_registry ALTER COLUMN available_to_modes SET DEFAULT '[]'::jsonb;`,
    `ALTER TABLE agent_registry ALTER COLUMN category SET DEFAULT 'mode_feature';`,
    `ALTER TABLE agent_registry ALTER COLUMN bank SET DEFAULT 'none';`,
    `ALTER TABLE agent_registry ALTER COLUMN visibility SET DEFAULT 'visible';`,
    `ALTER TABLE agent_registry ALTER COLUMN plan_tier SET DEFAULT 'free';`,
    `ALTER TABLE agent_registry ALTER COLUMN installable SET DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ALTER COLUMN hidden_system SET DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ALTER COLUMN locked SET DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ALTER COLUMN shared_with_caven SET DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ALTER COLUMN shared_with_cavai SET DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ALTER COLUMN shared_with_companion SET DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ALTER COLUMN support_for_caven SET DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ALTER COLUMN surface SET DEFAULT 'all';`,
    `ALTER TABLE agent_registry ALTER COLUMN mode SET DEFAULT 'general';`,
    `ALTER TABLE agent_registry ALTER COLUMN default_installed SET DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ALTER COLUMN installed_state SET DEFAULT FALSE;`,
    `ALTER TABLE agent_registry ALTER COLUMN display_order SET DEFAULT 0;`,
    `ALTER TABLE agent_registry ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE agent_registry ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;`,
  ];

  for (const statement of alterStatements) {
    await prisma.$executeRawUnsafe(statement);
  }

  await prisma.$executeRawUnsafe(`
    UPDATE agent_registry
    SET
      name = COALESCE(name, ''),
      slug = COALESCE(slug, ''),
      category = COALESCE(category, 'mode_feature'),
      bank = COALESCE(bank, 'none'),
      visibility = COALESCE(visibility, 'visible'),
      plan_tier = COALESCE(plan_tier, 'free'),
      installable = COALESCE(installable, FALSE),
      available_to_modes = COALESCE(available_to_modes, '[]'::jsonb),
      hidden_system = COALESCE(hidden_system, FALSE),
      locked = COALESCE(locked, FALSE),
      shared_with_caven = COALESCE(shared_with_caven, FALSE),
      shared_with_cavai = COALESCE(shared_with_cavai, FALSE),
      shared_with_companion = COALESCE(shared_with_companion, FALSE),
      support_for_caven = COALESCE(support_for_caven, FALSE),
      surface = COALESCE(surface, 'all'),
      mode = COALESCE(mode, 'general'),
      default_installed = COALESCE(default_installed, FALSE),
      installed_state = COALESCE(installed_state, FALSE),
      display_order = COALESCE(display_order, 0),
      created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
      updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
    WHERE
      name IS NULL
      OR slug IS NULL
      OR category IS NULL
      OR bank IS NULL
      OR visibility IS NULL
      OR plan_tier IS NULL
      OR installable IS NULL
      OR available_to_modes IS NULL
      OR hidden_system IS NULL
      OR locked IS NULL
      OR shared_with_caven IS NULL
      OR shared_with_cavai IS NULL
      OR shared_with_companion IS NULL
      OR support_for_caven IS NULL
      OR surface IS NULL
      OR mode IS NULL
      OR default_installed IS NULL
      OR installed_state IS NULL
      OR display_order IS NULL
      OR created_at IS NULL
      OR updated_at IS NULL;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS agent_registry_lookup_idx
    ON agent_registry (account_id, user_id, bank, installable, installed_state, updated_at DESC);
  `);

  tableReady = true;
  })().catch((error) => {
    tableReadyPromise = null;
    throw error;
  });
  await tableReadyPromise;
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
  const scopeKey = `${accountId}:${userId}`;
  const normalizedLegacyInstalledIds = [
    ...new Set(
      (Array.isArray(args.legacyInstalledAgentIds) ? args.legacyInstalledAgentIds : [])
        .map((id) => s(id).toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
  const fingerprint = [
    AGENT_REGISTRY_CATALOG_FINGERPRINT,
    toPlanTier(args.planId),
    normalizedLegacyInstalledIds.join(","),
  ].join("|");
  if (registrySyncFingerprintByScope.get(scopeKey) === fingerprint) return;

  const existingSync = registrySyncPromiseByScope.get(scopeKey);
  if (existingSync) {
    await existingSync;
    if (registrySyncFingerprintByScope.get(scopeKey) === fingerprint) return;
  }

  const syncPromise = (async () => {

  await ensureAgentRegistryTable();

  const existing = await readRegistryRows({ accountId, userId });
  const existingInstalled = new Map<string, boolean>();
  const existingById = new Map<string, RawRegistryRow>();
  for (const row of existing) {
    const normalizedId = s(row.id).toLowerCase();
    existingInstalled.set(normalizedId, bool(row.installed_state));
    existingById.set(normalizedId, row);
  }

  const legacyInstalledSet = new Set(
    (Array.isArray(args.legacyInstalledAgentIds) ? args.legacyInstalledAgentIds : [])
      .map((id) => s(id).toLowerCase())
      .filter(Boolean),
  );

  const planTier = toPlanTier(args.planId);

  for (const entry of AGENT_CATALOG) {
    const existingState = existingInstalled.get(entry.id);
    const existingRow = existingById.get(entry.id);
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

    if (rowMatchesCatalogEntry(existingRow, entry, planTier)) {
      continue;
    }

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
    registrySyncFingerprintByScope.set(scopeKey, fingerprint);
  })();
  registrySyncPromiseByScope.set(scopeKey, syncPromise);
  try {
    await syncPromise;
  } finally {
    if (registrySyncPromiseByScope.get(scopeKey) === syncPromise) {
      registrySyncPromiseByScope.delete(scopeKey);
    }
  }
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

export function buildFallbackAgentRegistryUiSnapshot(args: {
  planId?: PlanId;
  installedAgentIds?: string[];
}): AgentRegistryUiSnapshot {
  const planTier = toPlanTier(args.planId);
  const installedSet = new Set(
    (Array.isArray(args.installedAgentIds) && args.installedAgentIds.length
      ? args.installedAgentIds
      : DEFAULT_INSTALLED_AGENT_IDS
    )
      .map((id) => s(id).toLowerCase())
      .filter((id) => INSTALLABLE_AGENT_ID_SET.has(id)),
  );

  const visibleInstallable = INSTALLABLE_AGENT_CATALOG.filter(
    (entry) => entry.installable && entry.visibility === "visible",
  );

  const cavenInstalled: AgentRegistryRow[] = [];
  const cavenAvailable: AgentRegistryRow[] = [];
  const cavenPremiumLocked: AgentRegistryRow[] = [];
  const cavenSupport: AgentRegistryRow[] = [];
  const cavaiInstalled: AgentRegistryRow[] = [];
  const cavaiAvailable: AgentRegistryRow[] = [];
  const cavaiLocked: AgentRegistryRow[] = [];
  const companionInstalled: AgentRegistryRow[] = [];
  const companionAvailable: AgentRegistryRow[] = [];

  for (const entry of visibleInstallable) {
    const locked = lockedForPlan(entry, planTier);
    const installed = installedSet.has(entry.id) && !locked;
    const row: AgentRegistryRow = {
      id: entry.id,
      name: entry.name,
      slug: entry.slug,
      summary: entry.summary,
      iconSrc: entry.iconSrc,
      actionKey: entry.actionKey,
      cavcodeAction: entry.cavcodeAction,
      centerAction: entry.centerAction,
      category: entry.category,
      bank: entry.bank,
      visibility: entry.visibility,
      planTier: entry.planTier,
      installable: entry.installable,
      hiddenSystem: entry.hiddenSystem,
      availableToModes: [...entry.availableToModes],
      locked,
      sharedWithCaven: entry.sharedWithCaven,
      sharedWithCavai: entry.sharedWithCavai,
      sharedWithCompanion: entry.sharedWithCompanion,
      supportForCaven: entry.supportForCaven,
      surface: entry.surface,
      mode: entry.mode,
      defaultInstalled: entry.defaultInstalled,
      installedState: installed,
      displayOrder: entry.displayOrder,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };

    if (row.bank === "caven_native") {
      if (row.locked) cavenPremiumLocked.push(row);
      else if (row.installedState) cavenInstalled.push(row);
      else cavenAvailable.push(row);
      continue;
    }

    if (row.bank === "cavai_work") {
      cavenSupport.push(row);
      if (row.locked) cavaiLocked.push(row);
      else if (row.installedState) cavaiInstalled.push(row);
      else cavaiAvailable.push(row);
      continue;
    }

    if (row.bank === "companion") {
      if (row.installedState) companionInstalled.push(row);
      else if (!row.locked) companionAvailable.push(row);
    }
  }

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
    hiddenSystemIds: [...HIDDEN_SYSTEM_AGENT_IDS],
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
