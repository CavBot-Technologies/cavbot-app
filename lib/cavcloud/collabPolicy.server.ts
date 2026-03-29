import "server-only";

import { prisma } from "@/lib/prisma";

export type CavCloudCollabPolicy = {
  allowAdminsManageCollaboration: boolean;
  allowMembersEditFiles: boolean;
  allowMembersCreateUpload: boolean;
  allowAdminsPublishArtifacts: boolean;
  allowAdminsViewAccessLogs: boolean;
  enableContributorLinks: boolean;
  allowTeamAiAccess: boolean;
};

export const DEFAULT_CAVCLOUD_COLLAB_POLICY: CavCloudCollabPolicy = {
  allowAdminsManageCollaboration: false,
  allowMembersEditFiles: false,
  allowMembersCreateUpload: false,
  allowAdminsPublishArtifacts: false,
  allowAdminsViewAccessLogs: false,
  enableContributorLinks: false,
  allowTeamAiAccess: false,
};

type CollabPolicyPatch = Partial<CavCloudCollabPolicy>;

function isMissingPolicyTableError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code || "");
  const message = String(
    (err as { meta?: { message?: unknown }; message?: unknown })?.meta?.message
      || (err as { message?: unknown })?.message
      || "",
  ).toLowerCase();
  return code === "P2021" || (message.includes("cavcloudcollabpolicy") && message.includes("does not exist"));
}

function isMissingPolicyColumnError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code || "");
  const message = String(
    (err as { meta?: { message?: unknown }; message?: unknown })?.meta?.message
      || (err as { message?: unknown })?.message
      || "",
  ).toLowerCase();
  return code === "P2022" || (message.includes("allowteamaiaccess") && message.includes("column"));
}

function isPolicyAccountUniqueError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code || "");
  if (code !== "P2002") return false;
  const target = (err as { meta?: { target?: unknown } })?.meta?.target;
  if (Array.isArray(target)) {
    return target.some((field) => String(field || "").toLowerCase() === "accountid");
  }
  const text = String(target || "").toLowerCase();
  return text.includes("accountid");
}

let aiPolicyColumnEnsured = false;
async function ensureAiPolicyColumn() {
  if (aiPolicyColumnEnsured) return;
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "CavCloudCollabPolicy" ADD COLUMN IF NOT EXISTS "allowTeamAiAccess" BOOLEAN NOT NULL DEFAULT false'
    );
    aiPolicyColumnEnsured = true;
  } catch (err) {
    if (isMissingPolicyTableError(err)) return;
    if (isMissingPolicyColumnError(err)) return;
    throw err;
  }
}

async function readAllowTeamAiAccess(accountId: string): Promise<boolean> {
  await ensureAiPolicyColumn();
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ allowTeamAiAccess?: unknown }>>(
      'SELECT "allowTeamAiAccess" FROM "CavCloudCollabPolicy" WHERE "accountId" = $1 LIMIT 1',
      accountId
    );
    const value = rows?.[0]?.allowTeamAiAccess;
    return value === true;
  } catch (err) {
    if (isMissingPolicyTableError(err) || isMissingPolicyColumnError(err)) return false;
    throw err;
  }
}

async function writeAllowTeamAiAccess(accountId: string, nextValue: boolean): Promise<void> {
  await ensureAiPolicyColumn();
  try {
    await prisma.$executeRawUnsafe(
      'UPDATE "CavCloudCollabPolicy" SET "allowTeamAiAccess" = $2, "updatedAt" = NOW() WHERE "accountId" = $1',
      accountId,
      nextValue === true
    );
  } catch (err) {
    if (isMissingPolicyTableError(err) || isMissingPolicyColumnError(err)) return;
    throw err;
  }
}

function normalizePolicyRow(row: Partial<Record<string, unknown>> | null | undefined): CavCloudCollabPolicy {
  const safe = row || {};
  return {
    allowAdminsManageCollaboration:
      typeof safe.allowAdminsManageCollaboration === "boolean"
        ? safe.allowAdminsManageCollaboration
        : DEFAULT_CAVCLOUD_COLLAB_POLICY.allowAdminsManageCollaboration,
    allowMembersEditFiles:
      typeof safe.allowMembersEditFiles === "boolean"
        ? safe.allowMembersEditFiles
        : DEFAULT_CAVCLOUD_COLLAB_POLICY.allowMembersEditFiles,
    allowMembersCreateUpload:
      typeof safe.allowMembersCreateUpload === "boolean"
        ? safe.allowMembersCreateUpload
        : DEFAULT_CAVCLOUD_COLLAB_POLICY.allowMembersCreateUpload,
    allowAdminsPublishArtifacts:
      typeof safe.allowAdminsPublishArtifacts === "boolean"
        ? safe.allowAdminsPublishArtifacts
        : DEFAULT_CAVCLOUD_COLLAB_POLICY.allowAdminsPublishArtifacts,
    allowAdminsViewAccessLogs:
      typeof safe.allowAdminsViewAccessLogs === "boolean"
        ? safe.allowAdminsViewAccessLogs
        : DEFAULT_CAVCLOUD_COLLAB_POLICY.allowAdminsViewAccessLogs,
    enableContributorLinks:
      typeof safe.enableContributorLinks === "boolean"
        ? safe.enableContributorLinks
        : DEFAULT_CAVCLOUD_COLLAB_POLICY.enableContributorLinks,
    allowTeamAiAccess:
      typeof safe.allowTeamAiAccess === "boolean"
        ? safe.allowTeamAiAccess
        : DEFAULT_CAVCLOUD_COLLAB_POLICY.allowTeamAiAccess,
  };
}

async function ensurePolicyRow(accountId: string) {
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const existing = await prisma.cavCloudCollabPolicy.findUnique({
        where: { accountId },
      });
      if (existing) return existing;

      try {
        return await prisma.cavCloudCollabPolicy.create({
          data: { accountId },
        });
      } catch (err) {
        if (!isPolicyAccountUniqueError(err)) throw err;
      }
    }

    return await prisma.cavCloudCollabPolicy.findUnique({
      where: { accountId },
    });
  } catch (err) {
    if (isMissingPolicyTableError(err)) return null;
    throw err;
  }
}

export function parseCavCloudCollabPolicyPatch(input: unknown):
  | { ok: true; patch: CollabPolicyPatch }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid JSON payload." };
  }

  const body = input as Record<string, unknown>;
  const patch: CollabPolicyPatch = {};

  const boolFields: Array<keyof CavCloudCollabPolicy> = [
    "allowAdminsManageCollaboration",
    "allowMembersEditFiles",
    "allowMembersCreateUpload",
    "allowAdminsPublishArtifacts",
    "allowAdminsViewAccessLogs",
    "enableContributorLinks",
    "allowTeamAiAccess",
  ];

  for (const field of boolFields) {
    if (!(field in body)) continue;
    if (typeof body[field] !== "boolean") {
      return { ok: false, error: `${field} must be boolean.` };
    }
    patch[field] = body[field] as boolean;
  }

  return { ok: true, patch };
}

export async function getCavCloudCollabPolicy(accountIdRaw: string): Promise<CavCloudCollabPolicy> {
  const accountId = String(accountIdRaw || "").trim();
  if (!accountId) return { ...DEFAULT_CAVCLOUD_COLLAB_POLICY };

  const row = await ensurePolicyRow(accountId);
  const allowTeamAiAccess = await readAllowTeamAiAccess(accountId);
  const rowRecord = (row as Partial<Record<string, unknown>> | null) || {};
  return normalizePolicyRow({
    ...rowRecord,
    allowTeamAiAccess,
  });
}

export async function updateCavCloudCollabPolicy(args: {
  accountId: string;
  patch: CollabPolicyPatch;
}): Promise<CavCloudCollabPolicy> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) return { ...DEFAULT_CAVCLOUD_COLLAB_POLICY };

  const row = await ensurePolicyRow(accountId);
  const patch = { ...args.patch };
  const hasAllowTeamAiAccessPatch = typeof patch.allowTeamAiAccess === "boolean";
  const allowTeamAiAccessPatch = patch.allowTeamAiAccess === true;
  delete (patch as Partial<CavCloudCollabPolicy>).allowTeamAiAccess;

  if (!row) {
    return {
      ...DEFAULT_CAVCLOUD_COLLAB_POLICY,
      ...normalizePolicyRow({
        ...(patch as Record<string, unknown>),
        ...(hasAllowTeamAiAccessPatch ? { allowTeamAiAccess: allowTeamAiAccessPatch } : {}),
      }),
    };
  }

  if (Object.keys(patch).length > 0) {
    await prisma.cavCloudCollabPolicy.update({
      where: { accountId },
      data: patch,
    });
  }
  if (hasAllowTeamAiAccessPatch) {
    await writeAllowTeamAiAccess(accountId, allowTeamAiAccessPatch);
  }

  return getCavCloudCollabPolicy(accountId);
}
