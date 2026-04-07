import "server-only";

import type { CavSafeAclRole, PlanTier } from "@prisma/client";

import {
  ApiAuthError,
  requireAccountContext,
  requireSession,
  requireUser,
  type CavbotAccountSession,
} from "@/lib/apiAuth";
import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";
import { resolvePlanIdFromTier, type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

export type CavsafePlanId = Extract<PlanId, "premium" | "premium_plus">;

export type AuthorizedUserSession = CavbotAccountSession & {
  cavsafePlanId: CavsafePlanId;
  cavsafePremiumPlus: boolean;
};

export type CavSafeItemKind = "file" | "folder";

export type CavSafeResolvedItem = {
  accountId: string;
  itemId: string;
  kind: CavSafeItemKind;
  fileId: string | null;
  folderId: string | null;
  name: string;
  path: string;
  r2Key: string | null;
  mimeType: string | null;
};

const ROLE_RANK: Record<CavSafeAclRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function isTrialSeatActiveNow(trialSeatActive: boolean | null, trialEndsAt: Date | null): boolean {
  if (!trialSeatActive || !trialEndsAt) return false;
  const endsAtMs = new Date(trialEndsAt).getTime();
  return Number.isFinite(endsAtMs) && endsAtMs > Date.now();
}

function ensureCavsafePlan(planId: PlanId): CavsafePlanId {
  if (planId === "premium_plus") return "premium_plus";
  if (planId === "premium") return "premium";
  throw new ApiAuthError("PLAN_REQUIRED", 403);
}

async function resolveAccountPlan(accountId: string): Promise<PlanId> {
  const id = s(accountId);
  if (!id) throw new ApiAuthError("UNAUTHORIZED", 401);

  const effectivePlan = await getEffectiveAccountPlanContext(id).catch(() => null);
  if (effectivePlan?.planId) {
    return effectivePlan.planId;
  }

  const account = await prisma.account.findUnique({
    where: { id },
    select: {
      tier: true,
      trialSeatActive: true,
      trialEndsAt: true,
    },
  });
  if (!account) throw new ApiAuthError("UNAUTHORIZED", 401);

  if (isTrialSeatActiveNow(account.trialSeatActive, account.trialEndsAt)) {
    return "premium_plus";
  }
  return resolvePlanIdFromTier(account.tier);
}

export async function requirePremiumEntitlement(args: { accountId: string }): Promise<CavsafePlanId> {
  const planId = await resolveAccountPlan(args.accountId);
  return ensureCavsafePlan(planId);
}

export async function requireUserSession(req: Request): Promise<AuthorizedUserSession> {
  const sess = await requireSession(req);
  requireUser(sess);
  requireAccountContext(sess);

  const cavsafePlanId = await requirePremiumEntitlement({ accountId: sess.accountId });
  return {
    ...sess,
    cavsafePlanId,
    cavsafePremiumPlus: cavsafePlanId === "premium_plus",
  };
}

export function cavsafeRoleAtLeast(actual: CavSafeAclRole, minimum: CavSafeAclRole): boolean {
  return (ROLE_RANK[actual] || 0) >= (ROLE_RANK[minimum] || 0);
}

export function cavsafeRoleToApi(actual: CavSafeAclRole): "owner" | "editor" | "viewer" {
  if (actual === "OWNER") return "owner";
  if (actual === "EDITOR") return "editor";
  return "viewer";
}

export function cavsafeRoleFromApi(raw: unknown): CavSafeAclRole {
  const normalized = s(raw).toLowerCase();
  if (normalized === "owner") return "OWNER";
  if (normalized === "editor") return "EDITOR";
  if (normalized === "viewer") return "VIEWER";
  throw new ApiAuthError("BAD_REQUEST", 400);
}

export async function resolveCavSafeItemById(args: {
  accountId: string;
  itemId: string;
}): Promise<CavSafeResolvedItem | null> {
  const accountId = s(args.accountId);
  const itemId = s(args.itemId);
  if (!accountId || !itemId) return null;

  const file = await prisma.cavSafeFile.findFirst({
    where: {
      accountId,
      id: itemId,
      deletedAt: null,
    },
    select: {
      id: true,
      accountId: true,
      name: true,
      path: true,
      r2Key: true,
      mimeType: true,
    },
  });
  if (file?.id) {
    return {
      accountId,
      itemId: file.id,
      kind: "file",
      fileId: file.id,
      folderId: null,
      name: s(file.name),
      path: s(file.path),
      r2Key: s(file.r2Key) || null,
      mimeType: s(file.mimeType) || null,
    };
  }

  const folder = await prisma.cavSafeFolder.findFirst({
    where: {
      accountId,
      id: itemId,
      deletedAt: null,
    },
    select: {
      id: true,
      accountId: true,
      name: true,
      path: true,
    },
  });
  if (!folder?.id) return null;

  return {
    accountId,
    itemId: folder.id,
    kind: "folder",
    fileId: null,
    folderId: folder.id,
    name: s(folder.name),
    path: s(folder.path),
    r2Key: null,
    mimeType: null,
  };
}

export function cavsafeItemWhere(item: Pick<CavSafeResolvedItem, "kind" | "fileId" | "folderId">): {
  fileId?: string;
  folderId?: string;
} {
  if (item.kind === "file" && item.fileId) {
    return { fileId: item.fileId };
  }
  if (item.kind === "folder" && item.folderId) {
    return { folderId: item.folderId };
  }
  throw new ApiAuthError("NOT_FOUND", 404);
}

async function resolveExplicitUserAcl(args: {
  accountId: string;
  userId: string;
  item: CavSafeResolvedItem;
}) {
  return prisma.cavSafeAcl.findFirst({
    where: {
      accountId: args.accountId,
      principalType: "USER",
      principalId: args.userId,
      ...cavsafeItemWhere(args.item),
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      role: true,
      status: true,
    },
  });
}

async function resolveWorkspaceAcl(args: {
  accountId: string;
  item: CavSafeResolvedItem;
}) {
  return prisma.cavSafeAcl.findFirst({
    where: {
      accountId: args.accountId,
      principalType: "WORKSPACE",
      principalId: args.accountId,
      status: "ACTIVE",
      ...cavsafeItemWhere(args.item),
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      role: true,
    },
  });
}

async function resolveFallbackOwnerRole(args: {
  accountId: string;
  userId: string;
  explicitUserAclExists: boolean;
}): Promise<CavSafeAclRole | null> {
  if (args.explicitUserAclExists) return null;

  const membership = await prisma.membership.findUnique({
    where: {
      accountId_userId: {
        accountId: args.accountId,
        userId: args.userId,
      },
    },
    select: {
      role: true,
    },
  });

  return membership?.role === "OWNER" ? "OWNER" : null;
}

async function resolveEffectiveRole(args: {
  accountId: string;
  userId: string;
  item: CavSafeResolvedItem;
}): Promise<CavSafeAclRole | null> {
  const [userAcl, workspaceAcl] = await Promise.all([
    resolveExplicitUserAcl(args),
    resolveWorkspaceAcl(args),
  ]);

  let bestRole: CavSafeAclRole | null = null;
  if (userAcl?.status === "ACTIVE") {
    bestRole = userAcl.role;
  }
  if (workspaceAcl?.role) {
    if (!bestRole || ROLE_RANK[workspaceAcl.role] > ROLE_RANK[bestRole]) {
      bestRole = workspaceAcl.role;
    }
  }
  if (bestRole) return bestRole;

  return resolveFallbackOwnerRole({
    accountId: args.accountId,
    userId: args.userId,
    explicitUserAclExists: Boolean(userAcl?.id),
  });
}

export async function requireCavSafeAccess(args: {
  accountId: string;
  userId: string;
  itemId: string;
  minRole: CavSafeAclRole;
  onDenied?: 403 | 404;
}): Promise<{
  item: CavSafeResolvedItem;
  role: CavSafeAclRole;
}> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const itemId = s(args.itemId);
  const deniedStatus = args.onDenied === 403 ? 403 : 404;

  if (!accountId || !userId || !itemId) {
    throw new ApiAuthError("NOT_FOUND", 404);
  }

  const item = await resolveCavSafeItemById({ accountId, itemId });
  if (!item) {
    throw new ApiAuthError("NOT_FOUND", 404);
  }

  const role = await resolveEffectiveRole({
    accountId,
    userId,
    item,
  });

  if (!role) {
    throw new ApiAuthError(deniedStatus === 403 ? "FORBIDDEN" : "NOT_FOUND", deniedStatus);
  }

  if (!cavsafeRoleAtLeast(role, args.minRole)) {
    throw new ApiAuthError(deniedStatus === 403 ? "FORBIDDEN" : "NOT_FOUND", deniedStatus);
  }

  return {
    item,
    role,
  };
}

export async function canShare(args: {
  accountId: string;
  userId: string;
  itemId: string;
}): Promise<boolean> {
  try {
    await requireCavSafeAccess({
      accountId: args.accountId,
      userId: args.userId,
      itemId: args.itemId,
      minRole: "OWNER",
      onDenied: 403,
    });
    return true;
  } catch {
    return false;
  }
}

export function isFreeTier(tier: PlanTier | string | null | undefined): boolean {
  const resolved = resolvePlanIdFromTier((tier as PlanTier | undefined) || "FREE");
  return resolved === "free";
}
