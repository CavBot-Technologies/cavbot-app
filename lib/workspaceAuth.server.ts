import "server-only";

import {
  isApiAuthError,
  requireAccountContext,
  requireLowRiskWriteSession,
  requireSession,
  type CavbotSession,
  type CavbotAccountSession,
} from "@/lib/apiAuth";
import {
  resolveEffectiveAccountIdForSession,
  resolveEffectiveAccountIdFromRequest,
} from "@/lib/effectiveSessionAccount.server";

async function withEffectiveWorkspaceAccount(
  session: CavbotSession,
  req?: Request,
): Promise<CavbotAccountSession> {
  requireAccountContext(session);

  const effectiveAccountId = await (
    req ? resolveEffectiveAccountIdFromRequest(req, session) : resolveEffectiveAccountIdForSession(session)
  ).catch(() => null);
  const normalizedEffectiveAccountId = String(effectiveAccountId || "").trim();
  const normalizedSessionAccountId = String(session.accountId || "").trim();

  if (!normalizedEffectiveAccountId || normalizedEffectiveAccountId === normalizedSessionAccountId) {
    return session;
  }

  return {
    ...session,
    accountId: normalizedEffectiveAccountId,
  };
}

export async function requireWorkspaceSession(req: Request): Promise<CavbotAccountSession> {
  const session = await requireSession(req);
  return withEffectiveWorkspaceAccount(session, req);
}

export async function requireLowRiskWorkspaceSession(
  req: Request,
): Promise<CavbotAccountSession> {
  const session = await requireLowRiskWriteSession(req);
  return withEffectiveWorkspaceAccount(session, req);
}

export async function requireWorkspaceResilientSession(req: Request): Promise<CavbotAccountSession> {
  try {
    return await requireWorkspaceSession(req);
  } catch (error: unknown) {
    if (!isApiAuthError(error) || error.code !== "AUTH_BACKEND_UNAVAILABLE") throw error;
    return await requireLowRiskWorkspaceSession(req);
  }
}
