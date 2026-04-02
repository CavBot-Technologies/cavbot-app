import "server-only";

import {
  requireAccountContext,
  requireSession,
  requireUser,
  type CavbotAccountSession,
} from "@/lib/apiAuth";
import {
  clearExpiredTrialSeat,
  findAccountById,
  findActiveProjectByIdForAccount,
  getAuthPool,
} from "@/lib/authDb";
import { resolvePlanIdFromTier, type PlanId } from "@/lib/plans";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { AiServiceError, type AiSurface } from "@/src/lib/ai/ai.types";

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function n(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function isTrialActive(trialSeatActive: boolean | null, trialEndsAt: Date | null): boolean {
  if (!trialSeatActive || !trialEndsAt) return false;
  const endsAtMs = new Date(trialEndsAt).getTime();
  return Number.isFinite(endsAtMs) && endsAtMs > Date.now();
}

async function resolvePlanId(accountId: string): Promise<PlanId> {
  const pool = getAuthPool();
  await clearExpiredTrialSeat(pool, accountId);
  const account = await findAccountById(pool, accountId);
  if (!account) {
    throw new AiServiceError("UNAUTHORIZED", "Account not found for authenticated session.", 401);
  }
  if (isTrialActive(account.trialSeatActive, account.trialEndsAt)) return "premium_plus";
  return resolvePlanIdFromTier(account.tier);
}

function assertSurfacePlan(surface: AiSurface, planId: PlanId) {
  if (surface === "cavsafe" && planId === "free") {
    throw new AiServiceError(
      "PLAN_UPGRADE_REQUIRED",
      "CavSafe AI actions require a premium plan.",
      403
    );
  }
}

async function assertProjectScope(accountId: string, projectId: number): Promise<void> {
  const project = await findActiveProjectByIdForAccount(getAuthPool(), accountId, projectId);
  if (!project?.id) {
    throw new AiServiceError(
      "PROJECT_SCOPE_DENIED",
      "The provided projectId does not belong to the authenticated account.",
      403
    );
  }
}

export type AiRequestContext = {
  session: CavbotAccountSession;
  accountId: string;
  userId: string;
  memberRole: CavbotAccountSession["memberRole"];
  planId: PlanId;
  surface: AiSurface;
  projectId: number | null;
  workspaceId: string | null;
};

export async function requireAiRequestContext(args: {
  req: Request;
  surface: AiSurface;
  projectId?: unknown;
  workspaceId?: unknown;
}): Promise<AiRequestContext> {
  const session = await requireSession(args.req);
  requireUser(session);
  requireAccountContext(session);

  const accountId = s(session.accountId);
  const userId = s(session.sub);
  if (!accountId || !userId) {
    throw new AiServiceError("UNAUTHORIZED", "Missing user/account session context.", 401);
  }

  const planId = await resolvePlanId(accountId);
  assertSurfacePlan(args.surface, planId);

  const projectId = n(args.projectId) || n(args.workspaceId);
  if (projectId) {
    await assertProjectScope(accountId, projectId);
  }

  return {
    session,
    accountId,
    userId,
    memberRole: session.memberRole,
    planId,
    surface: args.surface,
    projectId: projectId || null,
    workspaceId: s(args.workspaceId) || null,
  };
}

export function enforceAiRateLimit(args: {
  accountId: string;
  userId: string;
  surface: AiSurface;
  action: string;
  limit?: number;
  windowMs?: number;
}) {
  const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Math.trunc(Number(args.limit))) : 24;
  const windowMs = Number.isFinite(Number(args.windowMs))
    ? Math.max(1_000, Math.trunc(Number(args.windowMs)))
    : 60_000;

  const key = [
    "ai",
    s(args.accountId),
    s(args.userId),
    s(args.surface),
    s(args.action),
  ].join(":");

  const consumed = consumeInMemoryRateLimit({
    key,
    limit,
    windowMs,
  });

  if (!consumed.allowed) {
    throw new AiServiceError(
      "RATE_LIMITED",
      `AI action rate limit exceeded. Retry in ${consumed.retryAfterSec}s.`,
      429,
      {
        retryAfterSec: consumed.retryAfterSec,
      }
    );
  }

  return consumed;
}
