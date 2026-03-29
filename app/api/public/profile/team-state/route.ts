import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/apiAuth";
import {
  resolvePublicProfileViewerTeamState,
  resolvePublicProfileWorkspaceContext,
} from "@/lib/publicProfile/teamState.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export async function GET(req: NextRequest) {
  try {
    const username = String(req.nextUrl.searchParams.get("username") || "").trim();
    const workspace = await resolvePublicProfileWorkspaceContext(username);
    if (!workspace) return json({ ok: false, error: "PROFILE_NOT_FOUND" }, 404);

    const session = await getSession(req).catch(() => null);
    const viewer = await resolvePublicProfileViewerTeamState({
      session,
      workspaceId: workspace.workspaceId,
    });

    const membershipState = viewer.inWorkspace
      ? viewer.workspaceRole === "OWNER"
        ? "OWNER"
        : viewer.workspaceRole === "ADMIN"
          ? "ADMIN"
          : "MEMBER"
      : viewer.pendingInvite
        ? "INVITED_PENDING"
        : viewer.pendingRequest
          ? "REQUEST_PENDING"
          : "NONE";

    return json(
      {
        ok: true,
        profile: {
          username: workspace.username,
          userId: workspace.profileUserId,
        },
        workspace: {
          id: workspace.workspaceId,
          name: workspace.workspaceName,
          planId: workspace.planId,
        },
        viewer: {
          authenticated: viewer.authenticated,
          userId: viewer.viewerUserId,
          inWorkspace: viewer.inWorkspace,
          workspaceRole: viewer.workspaceRole,
          canManageWorkspace: viewer.canManageWorkspace,
          canInviteFromCurrentAccount: viewer.canInviteFromCurrentAccount,
          pendingInvite: viewer.pendingInvite,
          pendingRequest: viewer.pendingRequest,
          membershipState,
          canRequestAccess: viewer.authenticated && !viewer.inWorkspace && !viewer.pendingInvite && !viewer.pendingRequest,
          canAcceptInvite: Boolean(viewer.pendingInvite?.id),
        },
      },
      200
    );
  } catch {
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...NO_STORE_HEADERS,
      Allow: "GET, OPTIONS",
    },
  });
}
