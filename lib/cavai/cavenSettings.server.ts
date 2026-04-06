import "server-only";

import { Prisma } from "@prisma/client";
import type { PlanId } from "@/lib/plans";
import { ALIBABA_QWEN_CODER_MODEL_ID } from "@/src/lib/ai/model-catalog";
import { syncAgentInstallState, toImageStudioPlanTier } from "@/lib/cavai/imageStudio.server";
import { INSTALLABLE_AGENT_CATALOG } from "@/lib/cavai/agentCatalog";
import {
  agentMinimumPlan,
  defaultInstalledAgentIds,
  listActiveInstalledBuiltInAgentIds,
  updateBuiltInInstallState,
} from "@/lib/cavai/agentRegistry.server";
import {
  listPublishedOperatorAgents,
  listPublishedOperatorAgentIds,
  syncOperatorAgentPublicationState,
} from "@/lib/cavai/operatorAgents.server";

import { prisma } from "@/lib/prisma";

const COMPOSER_ENTER_BEHAVIORS = ["enter", "meta_enter"] as const;
const REASONING_LEVELS = ["low", "medium", "high", "extra_high"] as const;
const INFERENCE_SPEEDS = ["standard", "fast"] as const;
const CAVEN_AGENT_IDS = INSTALLABLE_AGENT_CATALOG.map((row) => row.id);
const CAVEN_AGENT_MIN_PLAN = new Map<string, PlanId>(
  CAVEN_AGENT_IDS.map((id) => [id, agentMinimumPlan(id) as PlanId])
);
const DEFAULT_INSTALLED_AGENT_IDS = defaultInstalledAgentIds();
const DEFAULT_INSTALLED_AGENT_IDS_JSON = JSON.stringify(DEFAULT_INSTALLED_AGENT_IDS);
const DEFAULT_CUSTOM_AGENTS_JSON = "[]";
const MAX_CUSTOM_AGENTS = 120;
const MAX_INSTALLED_AGENT_IDS = 240;
const MAX_AGENT_TRIGGERS = 12;
const MAX_AGENT_ICON_SVG_CHARS = 120_000;
const THEME_OPTIONS = [
  "cavbot-default",
  "cavbot-light",
  "cavbot-lime",
  "cavbot-classic",
  "cavbot-dark",
  "cavbot-cobalt",
  "cavbot-ember",
  "cavbot-obsidian",
  "cavbot-mocha",
  "cavbot-graphite",
  "cavbot-nord",
  "cavbot-dawn",
] as const;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 40;
const MIN_TAB_SIZE = 1;
const MAX_TAB_SIZE = 8;
const MAX_TTY_SEQ = 999;
const CAVEN_AGENT_ID_SET = new Set<string>(CAVEN_AGENT_IDS);
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const AGENT_ACTION_KEY_RE = /^[a-z0-9][a-z0-9_]{1,63}$/;

export type CavenComposerEnterBehavior = (typeof COMPOSER_ENTER_BEHAVIORS)[number];
export type CavenReasoningLevel = (typeof REASONING_LEVELS)[number];
export type CavenInferenceSpeed = (typeof INFERENCE_SPEEDS)[number];
export type CavenAgentSurface = "cavcode" | "center" | "all";
export type CavenThemeOption = (typeof THEME_OPTIONS)[number];

export type CavenEditorSettings = {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
  formatOnSave: boolean;
  autosave: boolean;
  telemetry: boolean;
  theme: CavenThemeOption;
  syncToCavcloud: boolean;
};

export type CavenTerminalState = {
  lastLoginTs: number;
  ttySeq: number;
};

export type CavenCustomAgent = {
  id: string;
  name: string;
  summary: string;
  actionKey: string;
  surface: CavenAgentSurface;
  triggers: string[];
  instructions: string;
  iconSvg: string;
  iconBackground: string | null;
  createdAt: string;
  publicationRequested: boolean;
  publicationRequestedAt: string | null;
};

export type CavenSettings = {
  defaultModelId: string;
  inferenceSpeed: CavenInferenceSpeed;
  queueFollowUps: boolean;
  composerEnterBehavior: CavenComposerEnterBehavior;
  includeIdeContext: boolean;
  confirmBeforeApplyPatch: boolean;
  autoOpenResolvedFiles: boolean;
  showReasoningTimeline: boolean;
  telemetryOptIn: boolean;
  defaultReasoningLevel: CavenReasoningLevel;
  asrAudioSkillEnabled: boolean;
  installedAgentIds: string[];
  customAgents: CavenCustomAgent[];
  editorSettings: CavenEditorSettings;
  terminalState: CavenTerminalState;
};

export type CavenSettingsPatch = Partial<CavenSettings>;

export const DEFAULT_CAVEN_SETTINGS: CavenSettings = {
  defaultModelId: ALIBABA_QWEN_CODER_MODEL_ID,
  inferenceSpeed: "standard",
  queueFollowUps: true,
  composerEnterBehavior: "enter",
  includeIdeContext: true,
  confirmBeforeApplyPatch: true,
  autoOpenResolvedFiles: true,
  showReasoningTimeline: true,
  telemetryOptIn: true,
  defaultReasoningLevel: "medium",
  asrAudioSkillEnabled: true,
  installedAgentIds: [...DEFAULT_INSTALLED_AGENT_IDS],
  customAgents: [],
  editorSettings: {
    fontSize: 12,
    tabSize: 2,
    wordWrap: true,
    minimap: true,
    formatOnSave: false,
    autosave: true,
    telemetry: false,
    theme: "cavbot-default",
    syncToCavcloud: false,
  },
  terminalState: {
    lastLoginTs: Date.now(),
    ttySeq: 0,
  },
};

type RawCavenSettingsRow = Partial<Record<keyof CavenSettings, unknown>>;

let tableReady = false;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function planRank(planId: PlanId): number {
  if (planId === "premium_plus") return 3;
  if (planId === "premium") return 2;
  return 1;
}

function isAgentPlanEligible(agentId: string, planId: PlanId): boolean {
  const normalizedAgentId = s(agentId).toLowerCase();
  const required = CAVEN_AGENT_MIN_PLAN.get(normalizedAgentId) || (agentMinimumPlan(normalizedAgentId) as PlanId);
  return planRank(planId) >= planRank(required);
}

function fallbackBuiltInInstalledIds(installedAgentIds: readonly string[], planId?: PlanId): string[] {
  const installedSet = new Set(
    (Array.isArray(installedAgentIds) ? installedAgentIds : [])
      .map((id) => s(id).toLowerCase())
      .filter((id) => CAVEN_AGENT_ID_SET.has(id)),
  );
  return CAVEN_AGENT_IDS.filter((id) => {
    if (!installedSet.has(id)) return false;
    return !planId || isAgentPlanEligible(id, planId);
  });
}

function toAgentSlug(input: unknown): string {
  return s(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pickBool(value: unknown, fallback: boolean): boolean {
  return value == null ? fallback : value === true;
}

function pickComposerEnterBehavior(value: unknown, fallback: CavenComposerEnterBehavior): CavenComposerEnterBehavior {
  const raw = s(value).toLowerCase();
  return raw === "meta_enter" ? "meta_enter" : fallback;
}

function pickDefaultModelId(value: unknown, fallback: string): string {
  const raw = s(value);
  if (raw === ALIBABA_QWEN_CODER_MODEL_ID) return raw;
  if (fallback === ALIBABA_QWEN_CODER_MODEL_ID) return fallback;
  return ALIBABA_QWEN_CODER_MODEL_ID;
}

function pickInferenceSpeed(value: unknown, fallback: CavenInferenceSpeed): CavenInferenceSpeed {
  const raw = s(value).toLowerCase();
  if (raw === "fast" || raw === "standard") return raw;
  return fallback;
}

function pickReasoningLevel(value: unknown, fallback: CavenReasoningLevel): CavenReasoningLevel {
  const raw = s(value).toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "extra_high") return raw;
  return fallback;
}

function pickInt(value: unknown, fallback: number, min: number, max: number): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || !Number.isInteger(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(raw)));
}

function pickThemeOption(value: unknown, fallback: CavenThemeOption): CavenThemeOption {
  const raw = s(value).toLowerCase();
  if ((THEME_OPTIONS as readonly string[]).includes(raw)) return raw as CavenThemeOption;
  return fallback;
}

function normalizeEditorSettings(value: unknown, fallback: CavenEditorSettings): CavenEditorSettings {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    fontSize: pickInt(row.fontSize, fallback.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE),
    tabSize: pickInt(row.tabSize, fallback.tabSize, MIN_TAB_SIZE, MAX_TAB_SIZE),
    wordWrap: row.wordWrap == null ? fallback.wordWrap : row.wordWrap === true,
    minimap: row.minimap == null ? fallback.minimap : row.minimap === true,
    formatOnSave: row.formatOnSave == null ? fallback.formatOnSave : row.formatOnSave === true,
    autosave: row.autosave == null ? fallback.autosave : row.autosave === true,
    telemetry: row.telemetry == null ? fallback.telemetry : row.telemetry === true,
    theme: pickThemeOption(row.theme, fallback.theme),
    syncToCavcloud: row.syncToCavcloud == null ? fallback.syncToCavcloud : row.syncToCavcloud === true,
  };
}

function normalizeTerminalState(value: unknown, fallback: CavenTerminalState): CavenTerminalState {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const lastLoginTsRaw = Number(row.lastLoginTs);
  const ttySeqRaw = Number(row.ttySeq);
  const lastLoginTs = Number.isFinite(lastLoginTsRaw) && lastLoginTsRaw > 0
    ? Math.trunc(lastLoginTsRaw)
    : fallback.lastLoginTs;
  const ttySeq = Number.isFinite(ttySeqRaw)
    ? Math.max(0, Math.min(MAX_TTY_SEQ, Math.trunc(ttySeqRaw)))
    : fallback.ttySeq;
  return {
    lastLoginTs,
    ttySeq,
  };
}

function parseInstalledAgentIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: string[] = [];

  for (const row of value) {
    const id = s(row).toLowerCase();
    if (!id || !AGENT_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    rows.push(id);
    if (rows.length >= MAX_INSTALLED_AGENT_IDS) break;
  }

  return rows;
}

function pickInstalledAgentIds(
  value: unknown,
  fallback: readonly string[],
  customAgentIdSet?: ReadonlySet<string>,
  planId?: PlanId,
  publishedAgentIdSet?: ReadonlySet<string>
): string[] {
  const parsed = parseInstalledAgentIdList(value);
  if (!parsed.length) return [...fallback];

  const customIds = customAgentIdSet || new Set<string>();
  const publishedIds = publishedAgentIdSet || new Set<string>();
  const rows: string[] = [];
  for (const id of parsed) {
    if (!CAVEN_AGENT_ID_SET.has(id) && !customIds.has(id) && !publishedIds.has(id)) continue;
    if (CAVEN_AGENT_ID_SET.has(id) && planId && !isAgentPlanEligible(id, planId)) continue;
    rows.push(id);
  }
  if (!rows.length) return [...fallback];

  const builtInOrdered = CAVEN_AGENT_IDS.filter((id) => rows.includes(id));
  const customOrdered = rows.filter((id) => !CAVEN_AGENT_ID_SET.has(id) && customIds.has(id));
  const publishedOrdered = rows.filter((id) => !CAVEN_AGENT_ID_SET.has(id) && !customIds.has(id) && publishedIds.has(id));
  return [...builtInOrdered, ...customOrdered, ...publishedOrdered];
}

function pickAgentSurface(value: unknown): CavenAgentSurface {
  const raw = s(value).toLowerCase();
  if (raw === "cavcode" || raw === "center" || raw === "all") return raw;
  return "all";
}

function normalizeAgentIconSvg(value: unknown): string {
  const raw = s(value);
  if (!raw) return "";
  if (raw.length > MAX_AGENT_ICON_SVG_CHARS) return "";
  if (!/<svg[\s>]/i.test(raw) || !/<\/svg>/i.test(raw)) return "";
  if (/<script[\s>]/i.test(raw)) return "";
  if (/<foreignObject[\s>]/i.test(raw)) return "";
  if (/\son[a-z]+\s*=/i.test(raw)) return "";
  return raw;
}

function normalizeAgentIconBackground(value: unknown): string | null {
  const raw = s(value).replace(/\s+/g, "");
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  const match = normalized.match(/^#?([a-f0-9]{3}|[a-f0-9]{6}|[a-f0-9]{8})$/i);
  if (!match) return null;
  const token = match[1];
  if (token.length === 3) {
    return `#${token.split("").map((part) => `${part}${part}`).join("")}`.toUpperCase();
  }
  return `#${token.slice(0, 6)}`.toUpperCase();
}

function normalizeCustomAgents(value: unknown): CavenCustomAgent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: CavenCustomAgent[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;

    const name = s(row.name).replace(/\s+/g, " ");
    const summary = s(row.summary).replace(/\s+/g, " ");
    const instructions = s(row.instructions);
    if (!name || !summary || !instructions) continue;

    const fallbackSlug = toAgentSlug(name) || "agent";
    const id = (s(row.id).toLowerCase() || `custom_${fallbackSlug}`).slice(0, 64);
    if (!AGENT_ID_RE.test(id) || CAVEN_AGENT_ID_SET.has(id) || seen.has(id)) continue;

    const rawActionKey = s(row.actionKey)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
    const fallbackActionKey = (`custom_${fallbackSlug.replace(/-/g, "_")}` || "custom_agent").slice(0, 64);
    const actionKey = AGENT_ACTION_KEY_RE.test(rawActionKey) ? rawActionKey : fallbackActionKey;

    const triggerList = Array.isArray(row.triggers)
      ? row.triggers.map((item) => s(item)).filter(Boolean).slice(0, MAX_AGENT_TRIGGERS)
      : [];
    const iconSvg = normalizeAgentIconSvg(row.iconSvg);
    const iconBackground = normalizeAgentIconBackground(row.iconBackground);

    const createdAtRaw = s(row.createdAt);
    const createdAtParsed = Date.parse(createdAtRaw);
    const createdAt = Number.isFinite(createdAtParsed)
      ? new Date(createdAtParsed).toISOString()
      : new Date().toISOString();

    rows.push({
      id,
      name: name.slice(0, 64),
      summary: summary.slice(0, 220),
      actionKey,
      surface: pickAgentSurface(row.surface),
      triggers: triggerList,
      instructions: instructions.slice(0, 12000),
      iconSvg,
      iconBackground,
      createdAt,
      publicationRequested: row.publicationRequested === true,
      publicationRequestedAt: row.publicationRequested === true
        ? (Number.isFinite(Date.parse(s(row.publicationRequestedAt))) ? new Date(s(row.publicationRequestedAt)).toISOString() : createdAt)
        : null,
    });
    seen.add(id);

    if (rows.length >= MAX_CUSTOM_AGENTS) break;
  }

  return rows;
}

function normalizeSettings(
  row: RawCavenSettingsRow | null | undefined,
  planId?: PlanId,
  publishedAgentIdSet?: ReadonlySet<string>
): CavenSettings {
  const safe = row || {};
  const editorSettings = normalizeEditorSettings(safe.editorSettings, DEFAULT_CAVEN_SETTINGS.editorSettings);
  const terminalState = normalizeTerminalState(safe.terminalState, DEFAULT_CAVEN_SETTINGS.terminalState);
  const customAgents = normalizeCustomAgents(safe.customAgents);
  const customAgentIdSet = new Set<string>(customAgents.map((agent) => agent.id));
  const agentIds = pickInstalledAgentIds(
    safe.installedAgentIds,
    DEFAULT_CAVEN_SETTINGS.installedAgentIds,
    customAgentIdSet,
    planId,
    publishedAgentIdSet
  );
  const asrAudioSkillEnabled = pickBool(
    safe.asrAudioSkillEnabled,
    DEFAULT_CAVEN_SETTINGS.asrAudioSkillEnabled
  );

  return {
    defaultModelId: pickDefaultModelId(safe.defaultModelId, DEFAULT_CAVEN_SETTINGS.defaultModelId),
    inferenceSpeed: pickInferenceSpeed(safe.inferenceSpeed, DEFAULT_CAVEN_SETTINGS.inferenceSpeed),
    queueFollowUps: pickBool(safe.queueFollowUps, DEFAULT_CAVEN_SETTINGS.queueFollowUps),
    composerEnterBehavior: pickComposerEnterBehavior(
      safe.composerEnterBehavior,
      DEFAULT_CAVEN_SETTINGS.composerEnterBehavior
    ),
    includeIdeContext: pickBool(safe.includeIdeContext, DEFAULT_CAVEN_SETTINGS.includeIdeContext),
    confirmBeforeApplyPatch: pickBool(safe.confirmBeforeApplyPatch, DEFAULT_CAVEN_SETTINGS.confirmBeforeApplyPatch),
    autoOpenResolvedFiles: pickBool(safe.autoOpenResolvedFiles, DEFAULT_CAVEN_SETTINGS.autoOpenResolvedFiles),
    showReasoningTimeline: pickBool(safe.showReasoningTimeline, DEFAULT_CAVEN_SETTINGS.showReasoningTimeline),
    telemetryOptIn: pickBool(safe.telemetryOptIn, DEFAULT_CAVEN_SETTINGS.telemetryOptIn),
    defaultReasoningLevel: pickReasoningLevel(
      safe.defaultReasoningLevel,
      DEFAULT_CAVEN_SETTINGS.defaultReasoningLevel
    ),
    asrAudioSkillEnabled,
    installedAgentIds: agentIds,
    customAgents,
    editorSettings,
    terminalState,
  };
}

async function ensureCavenSettingsTable() {
  if (tableReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavenSettings" (
      "accountId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "defaultModelId" VARCHAR(120) NOT NULL DEFAULT '${DEFAULT_CAVEN_SETTINGS.defaultModelId}',
      "inferenceSpeed" VARCHAR(16) NOT NULL DEFAULT '${DEFAULT_CAVEN_SETTINGS.inferenceSpeed}',
      "queueFollowUps" BOOLEAN NOT NULL DEFAULT true,
      "composerEnterBehavior" VARCHAR(24) NOT NULL DEFAULT 'enter',
      "includeIdeContext" BOOLEAN NOT NULL DEFAULT true,
      "confirmBeforeApplyPatch" BOOLEAN NOT NULL DEFAULT true,
      "autoOpenResolvedFiles" BOOLEAN NOT NULL DEFAULT true,
      "showReasoningTimeline" BOOLEAN NOT NULL DEFAULT true,
      "telemetryOptIn" BOOLEAN NOT NULL DEFAULT true,
      "defaultReasoningLevel" VARCHAR(24) NOT NULL DEFAULT 'medium',
      "asrAudioSkillEnabled" BOOLEAN NOT NULL DEFAULT true,
      "installedAgentIds" JSONB NOT NULL DEFAULT '${DEFAULT_INSTALLED_AGENT_IDS_JSON}'::jsonb,
      "customAgents" JSONB NOT NULL DEFAULT '${DEFAULT_CUSTOM_AGENTS_JSON}'::jsonb,
      "editorSettings" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "terminalState" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CavenSettings_pkey" PRIMARY KEY ("accountId", "userId")
    );
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "defaultModelId" VARCHAR(120) NOT NULL DEFAULT '${DEFAULT_CAVEN_SETTINGS.defaultModelId}';
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "inferenceSpeed" VARCHAR(16) NOT NULL DEFAULT '${DEFAULT_CAVEN_SETTINGS.inferenceSpeed}';
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "queueFollowUps" BOOLEAN NOT NULL DEFAULT true;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "composerEnterBehavior" VARCHAR(24) NOT NULL DEFAULT 'enter';
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "includeIdeContext" BOOLEAN NOT NULL DEFAULT true;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "confirmBeforeApplyPatch" BOOLEAN NOT NULL DEFAULT true;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "autoOpenResolvedFiles" BOOLEAN NOT NULL DEFAULT true;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "showReasoningTimeline" BOOLEAN NOT NULL DEFAULT true;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "telemetryOptIn" BOOLEAN NOT NULL DEFAULT true;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "defaultReasoningLevel" VARCHAR(24) NOT NULL DEFAULT 'medium';
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "asrAudioSkillEnabled" BOOLEAN NOT NULL DEFAULT true;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "installedAgentIds" JSONB NOT NULL DEFAULT '${DEFAULT_INSTALLED_AGENT_IDS_JSON}'::jsonb;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ALTER COLUMN "installedAgentIds" SET DEFAULT '${DEFAULT_INSTALLED_AGENT_IDS_JSON}'::jsonb;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "customAgents" JSONB NOT NULL DEFAULT '${DEFAULT_CUSTOM_AGENTS_JSON}'::jsonb;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "editorSettings" JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "terminalState" JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CavenSettings"
    ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE "CavenSettings"
    SET "createdAt" = COALESCE("createdAt", CURRENT_TIMESTAMP),
        "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
    WHERE "createdAt" IS NULL OR "updatedAt" IS NULL;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavenSettings_userId_idx"
    ON "CavenSettings" ("userId");
  `);
  tableReady = true;
}

async function ensureSettingsRow(accountId: string, userId: string) {
  await ensureCavenSettingsTable();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavenSettings" (
        "accountId",
        "userId",
        "defaultModelId",
        "inferenceSpeed",
        "queueFollowUps",
        "composerEnterBehavior",
        "includeIdeContext",
        "confirmBeforeApplyPatch",
        "autoOpenResolvedFiles",
        "showReasoningTimeline",
        "telemetryOptIn",
        "defaultReasoningLevel",
        "asrAudioSkillEnabled",
        "installedAgentIds",
        "customAgents",
        "editorSettings",
        "terminalState"
      ) VALUES (
        ${accountId},
        ${userId},
        ${DEFAULT_CAVEN_SETTINGS.defaultModelId},
        ${DEFAULT_CAVEN_SETTINGS.inferenceSpeed},
        ${DEFAULT_CAVEN_SETTINGS.queueFollowUps},
        ${DEFAULT_CAVEN_SETTINGS.composerEnterBehavior},
        ${DEFAULT_CAVEN_SETTINGS.includeIdeContext},
        ${DEFAULT_CAVEN_SETTINGS.confirmBeforeApplyPatch},
        ${DEFAULT_CAVEN_SETTINGS.autoOpenResolvedFiles},
        ${DEFAULT_CAVEN_SETTINGS.showReasoningTimeline},
        ${DEFAULT_CAVEN_SETTINGS.telemetryOptIn},
        ${DEFAULT_CAVEN_SETTINGS.defaultReasoningLevel},
        ${DEFAULT_CAVEN_SETTINGS.asrAudioSkillEnabled},
        CAST(${JSON.stringify(DEFAULT_CAVEN_SETTINGS.installedAgentIds)} AS jsonb),
        CAST(${JSON.stringify(DEFAULT_CAVEN_SETTINGS.customAgents)} AS jsonb),
        CAST(${JSON.stringify(DEFAULT_CAVEN_SETTINGS.editorSettings)} AS jsonb),
        CAST(${JSON.stringify(DEFAULT_CAVEN_SETTINGS.terminalState)} AS jsonb)
      )
      ON CONFLICT ("accountId", "userId") DO NOTHING
    `
  );
}

async function readSettingsRow(accountId: string, userId: string): Promise<RawCavenSettingsRow | null> {
  await ensureCavenSettingsTable();
  const rows = await prisma.$queryRaw<RawCavenSettingsRow[]>(
    Prisma.sql`
      SELECT
        "defaultModelId",
        "inferenceSpeed",
        "queueFollowUps",
        "composerEnterBehavior",
        "includeIdeContext",
        "confirmBeforeApplyPatch",
        "autoOpenResolvedFiles",
        "showReasoningTimeline",
        "telemetryOptIn",
        "defaultReasoningLevel",
        "asrAudioSkillEnabled",
        "installedAgentIds",
        "customAgents",
        "editorSettings",
        "terminalState"
      FROM "CavenSettings"
      WHERE "accountId" = ${accountId}
        AND "userId" = ${userId}
      LIMIT 1
    `
  );
  return rows[0] || null;
}

export function parseCavenSettingsPatch(
  input: unknown
): { ok: true; patch: CavenSettingsPatch } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid JSON payload." };
  }
  const body = input as Record<string, unknown>;
  const patch: CavenSettingsPatch = {};

  const setBool = (key: keyof CavenSettingsPatch, label: string) => {
    if (!(key in body)) return;
    if (typeof body[key as string] !== "boolean") throw new Error(`${label} must be boolean.`);
    (patch as Record<string, unknown>)[key as string] = body[key as string];
  };

  try {
    if ("defaultModelId" in body) {
      patch.defaultModelId = pickDefaultModelId(body.defaultModelId, DEFAULT_CAVEN_SETTINGS.defaultModelId);
    }

    if ("inferenceSpeed" in body) {
      const value = s(body.inferenceSpeed).toLowerCase();
      if (!(INFERENCE_SPEEDS as readonly string[]).includes(value)) {
        throw new Error("inferenceSpeed is invalid.");
      }
      patch.inferenceSpeed = value as CavenInferenceSpeed;
    }

    if ("composerEnterBehavior" in body) {
      const value = s(body.composerEnterBehavior).toLowerCase();
      if (!(COMPOSER_ENTER_BEHAVIORS as readonly string[]).includes(value)) {
        throw new Error("composerEnterBehavior is invalid.");
      }
      patch.composerEnterBehavior = value as CavenComposerEnterBehavior;
    }

    if ("defaultReasoningLevel" in body) {
      const value = s(body.defaultReasoningLevel).toLowerCase();
      if (!(REASONING_LEVELS as readonly string[]).includes(value)) {
        throw new Error("defaultReasoningLevel is invalid.");
      }
      patch.defaultReasoningLevel = value as CavenReasoningLevel;
    }

    setBool("queueFollowUps", "queueFollowUps");
    setBool("includeIdeContext", "includeIdeContext");
    setBool("confirmBeforeApplyPatch", "confirmBeforeApplyPatch");
    setBool("autoOpenResolvedFiles", "autoOpenResolvedFiles");
    setBool("showReasoningTimeline", "showReasoningTimeline");
    setBool("telemetryOptIn", "telemetryOptIn");
    setBool("asrAudioSkillEnabled", "asrAudioSkillEnabled");

    if ("installedAgentIds" in body) {
      if (!Array.isArray(body.installedAgentIds)) {
        throw new Error("installedAgentIds must be an array.");
      }
      patch.installedAgentIds = parseInstalledAgentIdList(body.installedAgentIds);
    }

    if ("customAgents" in body) {
      if (!Array.isArray(body.customAgents)) {
        throw new Error("customAgents must be an array.");
      }
      patch.customAgents = normalizeCustomAgents(body.customAgents);
    }

    if ("editorSettings" in body) {
      if (!body.editorSettings || typeof body.editorSettings !== "object" || Array.isArray(body.editorSettings)) {
        throw new Error("editorSettings must be an object.");
      }
      patch.editorSettings = normalizeEditorSettings(body.editorSettings, DEFAULT_CAVEN_SETTINGS.editorSettings);
    }

    if ("terminalState" in body) {
      if (!body.terminalState || typeof body.terminalState !== "object" || Array.isArray(body.terminalState)) {
        throw new Error("terminalState must be an object.");
      }
      patch.terminalState = normalizeTerminalState(body.terminalState, DEFAULT_CAVEN_SETTINGS.terminalState);
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid settings payload." };
  }

  return { ok: true, patch };
}

export async function getCavenSettings(args: {
  accountId: string;
  userId: string;
  planId?: PlanId;
}): Promise<CavenSettings> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return { ...DEFAULT_CAVEN_SETTINGS };
  await ensureSettingsRow(accountId, userId);
  let publishedAgentIds: string[] = [];
  try {
    publishedAgentIds = await listPublishedOperatorAgentIds();
  } catch (error) {
    console.error("[cavenSettings] listPublishedOperatorAgentIds failed, using settings fallback", error);
  }
  const publishedAgentIdSet = new Set<string>(publishedAgentIds);
  const row = await readSettingsRow(accountId, userId);
  const normalized = normalizeSettings(row, args.planId, publishedAgentIdSet);
  let activeBuiltInIds = fallbackBuiltInInstalledIds(normalized.installedAgentIds, args.planId);
  try {
    activeBuiltInIds = await listActiveInstalledBuiltInAgentIds({
      accountId,
      userId,
      planId: args.planId,
      legacyInstalledAgentIds: normalized.installedAgentIds,
    });
  } catch (error) {
    console.error("[cavenSettings] listActiveInstalledBuiltInAgentIds failed, using settings fallback", error);
  }
  const customIdSet = new Set<string>(normalized.customAgents.map((agent) => agent.id));
  const customInstalled = normalized.installedAgentIds.filter((id) => customIdSet.has(id));
  const publishedInstalled = normalized.installedAgentIds.filter((id) => publishedAgentIdSet.has(id));
  const installedAgentIds = pickInstalledAgentIds(
    [...activeBuiltInIds, ...customInstalled, ...publishedInstalled],
    [],
    customIdSet,
    args.planId,
    publishedAgentIdSet
  );
  return {
    ...normalized,
    installedAgentIds,
  };
}

export async function updateCavenSettings(args: {
  accountId: string;
  userId: string;
  patch: CavenSettingsPatch;
  planId?: PlanId;
}): Promise<CavenSettings> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const patch = args.patch || {};
  if (!accountId || !userId) return { ...DEFAULT_CAVEN_SETTINGS };

  await ensureSettingsRow(accountId, userId);
  let publishedAgentIds: string[] = [];
  try {
    publishedAgentIds = await listPublishedOperatorAgentIds();
  } catch (error) {
    console.error("[cavenSettings] listPublishedOperatorAgentIds failed, using current settings fallback", error);
  }
  const publishedAgentIdSet = new Set<string>(publishedAgentIds);
  const current = normalizeSettings(await readSettingsRow(accountId, userId), args.planId, publishedAgentIdSet);

  const customAgentsPatch = patch.customAgents !== undefined ? normalizeCustomAgents(patch.customAgents) : undefined;
  const effectiveCustomAgents = customAgentsPatch ?? current.customAgents;
  const customAgentIdSet = new Set<string>(effectiveCustomAgents.map((agent) => agent.id));

  let installedAgentIdsPatch =
    patch.installedAgentIds !== undefined
      ? pickInstalledAgentIds(patch.installedAgentIds, [], customAgentIdSet, args.planId, publishedAgentIdSet)
      : undefined;
  const asrAudioSkillEnabledPatch = patch.asrAudioSkillEnabled;

  if (installedAgentIdsPatch === undefined && customAgentsPatch !== undefined) {
    installedAgentIdsPatch = pickInstalledAgentIds(
      current.installedAgentIds,
      current.installedAgentIds,
      customAgentIdSet,
      args.planId,
      publishedAgentIdSet
    );
  }
  const requestedInstalledAgentIds = installedAgentIdsPatch ?? current.installedAgentIds;
  const requestedBuiltInInstallIds = requestedInstalledAgentIds.filter((id) => CAVEN_AGENT_ID_SET.has(id));
  const requestedCustomInstallIds = requestedInstalledAgentIds.filter((id) => customAgentIdSet.has(id));

  let activeBuiltInInstalledIds = fallbackBuiltInInstalledIds(current.installedAgentIds, args.planId);
  try {
    activeBuiltInInstalledIds = await listActiveInstalledBuiltInAgentIds({
      accountId,
      userId,
      planId: args.planId,
      legacyInstalledAgentIds: current.installedAgentIds,
    });
  } catch (error) {
    console.error("[cavenSettings] initial built-in registry sync failed, using settings fallback", error);
  }
  if (installedAgentIdsPatch !== undefined || customAgentsPatch !== undefined) {
    activeBuiltInInstalledIds = fallbackBuiltInInstalledIds(requestedBuiltInInstallIds, args.planId);
    try {
      activeBuiltInInstalledIds = await updateBuiltInInstallState({
        accountId,
        userId,
        planId: args.planId,
        installedAgentIds: requestedBuiltInInstallIds,
        legacyInstalledAgentIds: current.installedAgentIds,
      });
    } catch (error) {
      console.error("[cavenSettings] updateBuiltInInstallState failed, preserving settings payload", error);
    }
  }
  const finalInstalledAgentIds = pickInstalledAgentIds(
    [...activeBuiltInInstalledIds, ...requestedCustomInstallIds, ...requestedInstalledAgentIds.filter((id) => publishedAgentIdSet.has(id))],
    [],
    customAgentIdSet,
    args.planId,
    publishedAgentIdSet
  );

  const assignments: Prisma.Sql[] = [];
  if (patch.defaultModelId !== undefined) assignments.push(Prisma.sql`"defaultModelId" = ${patch.defaultModelId}`);
  if (patch.inferenceSpeed !== undefined) assignments.push(Prisma.sql`"inferenceSpeed" = ${patch.inferenceSpeed}`);
  if (patch.queueFollowUps !== undefined) assignments.push(Prisma.sql`"queueFollowUps" = ${patch.queueFollowUps}`);
  if (patch.composerEnterBehavior !== undefined) {
    assignments.push(Prisma.sql`"composerEnterBehavior" = ${patch.composerEnterBehavior}`);
  }
  if (patch.includeIdeContext !== undefined) assignments.push(Prisma.sql`"includeIdeContext" = ${patch.includeIdeContext}`);
  if (patch.confirmBeforeApplyPatch !== undefined) {
    assignments.push(Prisma.sql`"confirmBeforeApplyPatch" = ${patch.confirmBeforeApplyPatch}`);
  }
  if (patch.autoOpenResolvedFiles !== undefined) {
    assignments.push(Prisma.sql`"autoOpenResolvedFiles" = ${patch.autoOpenResolvedFiles}`);
  }
  if (patch.showReasoningTimeline !== undefined) {
    assignments.push(Prisma.sql`"showReasoningTimeline" = ${patch.showReasoningTimeline}`);
  }
  if (patch.telemetryOptIn !== undefined) assignments.push(Prisma.sql`"telemetryOptIn" = ${patch.telemetryOptIn}`);
  if (patch.defaultReasoningLevel !== undefined) {
    assignments.push(Prisma.sql`"defaultReasoningLevel" = ${patch.defaultReasoningLevel}`);
  }
  if (asrAudioSkillEnabledPatch !== undefined) {
    assignments.push(Prisma.sql`"asrAudioSkillEnabled" = ${asrAudioSkillEnabledPatch}`);
  }
  if (
    installedAgentIdsPatch !== undefined
    || customAgentsPatch !== undefined
    || current.installedAgentIds.join("\n") !== finalInstalledAgentIds.join("\n")
  ) {
    assignments.push(Prisma.sql`"installedAgentIds" = CAST(${JSON.stringify(finalInstalledAgentIds)} AS jsonb)`);
  }
  if (customAgentsPatch !== undefined) {
    assignments.push(Prisma.sql`"customAgents" = CAST(${JSON.stringify(customAgentsPatch)} AS jsonb)`);
  }
  if (patch.editorSettings !== undefined) {
    assignments.push(Prisma.sql`"editorSettings" = CAST(${JSON.stringify(patch.editorSettings)} AS jsonb)`);
  }
  if (patch.terminalState !== undefined) {
    assignments.push(Prisma.sql`"terminalState" = CAST(${JSON.stringify(patch.terminalState)} AS jsonb)`);
  }

  if (assignments.length) {
    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE "CavenSettings"
        SET ${Prisma.join(assignments, ", ")},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "accountId" = ${accountId}
          AND "userId" = ${userId}
      `
    );
  }

  const next = await readSettingsRow(accountId, userId);
  const normalizedRaw = normalizeSettings(next, args.planId, publishedAgentIdSet);
  let activeBuiltIns = fallbackBuiltInInstalledIds(normalizedRaw.installedAgentIds, args.planId);
  try {
    activeBuiltIns = await listActiveInstalledBuiltInAgentIds({
      accountId,
      userId,
      planId: args.planId,
      legacyInstalledAgentIds: normalizedRaw.installedAgentIds,
    });
  } catch (error) {
    console.error("[cavenSettings] post-save built-in registry sync failed, using settings fallback", error);
  }
  const normalizedCustomIdSet = new Set<string>(normalizedRaw.customAgents.map((agent) => agent.id));
  const normalizedCustomInstalled = normalizedRaw.installedAgentIds.filter((id) => normalizedCustomIdSet.has(id));
  const normalizedPublishedInstalled = normalizedRaw.installedAgentIds.filter((id) => publishedAgentIdSet.has(id));
  const normalized: CavenSettings = {
    ...normalizedRaw,
    installedAgentIds: pickInstalledAgentIds(
      [...activeBuiltIns, ...normalizedCustomInstalled, ...normalizedPublishedInstalled],
      [],
      normalizedCustomIdSet,
      args.planId,
      publishedAgentIdSet
    ),
  };
  if (customAgentsPatch !== undefined) {
    try {
      await syncOperatorAgentPublicationState({
        accountId,
        userId,
        agents: normalized.customAgents,
      });
    } catch (error) {
      console.error("[cavenSettings] syncOperatorAgentPublicationState failed", error);
    }
  }
  try {
    await syncAgentInstallState({
      accountId,
      userId,
      planTier: toImageStudioPlanTier(args.planId || "free"),
      installedAgentIds: normalized.installedAgentIds,
    });
  } catch {
    // Non-blocking: settings persistence should not fail on mirror table sync issues.
  }
  return normalized;
}

function isCustomAgentSurfaceCompatible(agentSurface: CavenAgentSurface, runtimeSurface: "cavcode" | "center"): boolean {
  if (agentSurface === "all") return true;
  return agentSurface === runtimeSurface;
}

export async function resolveInstalledCavenCustomAgent(args: {
  accountId: string;
  userId: string;
  runtimeSurface: "cavcode" | "center";
  agentId?: string | null;
  agentActionKey?: string | null;
}): Promise<CavenCustomAgent | null> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const runtimeSurface = args.runtimeSurface;
  const requestedAgentId = s(args.agentId).toLowerCase();
  const requestedActionKey = s(args.agentActionKey).toLowerCase();
  if (!accountId || !userId) return null;
  if (!requestedAgentId && !requestedActionKey) return null;

  const settings = await getCavenSettings({
    accountId,
    userId,
  });

  const installedIdSet = new Set<string>((settings.installedAgentIds || []).map((id) => s(id).toLowerCase()));
  const customAgents = Array.isArray(settings.customAgents) ? settings.customAgents : [];

  for (const agent of customAgents) {
    const id = s(agent.id).toLowerCase();
    const actionKey = s(agent.actionKey).toLowerCase();
    if (!id || !installedIdSet.has(id)) continue;
    if (!isCustomAgentSurfaceCompatible(agent.surface, runtimeSurface)) continue;
    const idMatches = requestedAgentId && id === requestedAgentId;
    const actionMatches = requestedActionKey && actionKey && actionKey === requestedActionKey;
    if (!idMatches && !actionMatches) continue;
    return agent;
  }

  try {
    const publishedAgents = await listPublishedOperatorAgents({
      surface: runtimeSurface,
      limit: 240,
    });

    for (const agent of publishedAgents) {
      const id = s(agent.id).toLowerCase();
      const actionKey = s(agent.actionKey).toLowerCase();
      if (!id || !installedIdSet.has(id)) continue;
      const idMatches = requestedAgentId && id === requestedAgentId;
      const actionMatches = requestedActionKey && actionKey && actionKey === requestedActionKey;
      if (!idMatches && !actionMatches) continue;
      return {
        id,
        name: agent.name,
        summary: agent.summary,
        actionKey,
        surface: agent.surface,
        triggers: Array.isArray(agent.triggers) ? agent.triggers.map((trigger) => s(trigger)).filter(Boolean).slice(0, MAX_AGENT_TRIGGERS) : [],
        instructions: s(agent.instructions),
        iconSvg: s(agent.iconSvg),
        iconBackground: agent.iconBackground,
        createdAt: s(agent.publishedAt) || s(agent.updatedAt) || new Date().toISOString(),
        publicationRequested: false,
        publicationRequestedAt: null,
      };
    }
  } catch (error) {
    console.error("[cavenSettings] resolveInstalledCavenCustomAgent published lookup failed", error);
  }

  return null;
}
