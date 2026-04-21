import "server-only";

import {
  isApiAuthError,
  requireAccountContext,
  requireLowRiskWriteSession,
  requireSession,
  type CavbotAccountSession,
} from "@/lib/apiAuth";

export async function requireWorkspaceResilientSession(req: Request): Promise<CavbotAccountSession> {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    return session;
  } catch (error: unknown) {
    if (!isApiAuthError(error) || error.code !== "AUTH_BACKEND_UNAVAILABLE") throw error;

    const session = await requireLowRiskWriteSession(req);
    requireAccountContext(session);
    return session;
  }
}
