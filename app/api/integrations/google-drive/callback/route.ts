import { NextResponse } from "next/server";

import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import {
  exchangeGoogleDriveCodeForTokens,
  GoogleDriveError,
  logGoogleDriveConnectedEvent,
  upsertGoogleDriveCredential,
  verifyGoogleDriveOauthState,
} from "@/lib/integrations/googleDrive.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreRedirect(to: string): NextResponse {
  const response = NextResponse.redirect(to);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireUser(session);

    const url = new URL(req.url);
    const oauthError = String(url.searchParams.get("error") || "").trim();
    const code = String(url.searchParams.get("code") || "").trim();
    const state = String(url.searchParams.get("state") || "").trim();

    if (oauthError) {
      return noStoreRedirect(`/cavcloud?driveImport=connect_failed&reason=${encodeURIComponent(oauthError)}`);
    }

    verifyGoogleDriveOauthState(state, {
      accountId: session.accountId,
      userId: session.sub,
    });

    const tokens = await exchangeGoogleDriveCodeForTokens({
      request: req,
      code,
    });

    if (!tokens.refreshToken) {
      return noStoreRedirect("/cavcloud?driveImport=connect_failed&reason=missing_refresh_token");
    }

    await upsertGoogleDriveCredential({
      accountId: session.accountId,
      userId: session.sub,
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
      providerUserId: tokens.providerUserId,
    });

    const credential = await prisma.integrationCredential.findUnique({
      where: {
        accountId_userId_provider: {
          accountId: session.accountId,
          userId: session.sub,
          provider: "GOOGLE_DRIVE",
        },
      },
      select: {
        id: true,
      },
    });

    if (credential?.id) {
      await logGoogleDriveConnectedEvent({
        accountId: session.accountId,
        userId: session.sub,
        providerSubjectId: credential.id,
      });
    }

    return noStoreRedirect("/cavcloud?driveImport=connected");
  } catch (error) {
    const code = error instanceof GoogleDriveError ? error.code : "connect_failed";
    return noStoreRedirect(`/cavcloud?driveImport=connect_failed&reason=${encodeURIComponent(String(code).toLowerCase())}`);
  }
}
