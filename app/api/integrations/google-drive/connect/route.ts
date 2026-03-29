import { NextResponse } from "next/server";

import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { buildGoogleDriveAuthorizeUrl, createGoogleDriveOauthState, GoogleDriveError } from "@/lib/integrations/googleDrive.server";

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

    const state = createGoogleDriveOauthState({
      accountId: session.accountId,
      userId: session.sub,
    });

    const authorizeUrl = buildGoogleDriveAuthorizeUrl(req, state);
    return noStoreRedirect(authorizeUrl);
  } catch (error) {
    const code = error instanceof GoogleDriveError ? error.code : "connect_failed";
    return noStoreRedirect(`/cavcloud?driveImport=connect_failed&reason=${encodeURIComponent(String(code).toLowerCase())}`);
  }
}
