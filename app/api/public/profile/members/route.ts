import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
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
    if (!workspace?.workspaceId) {
      return json({ ok: false, error: "WORKSPACE_NOT_FOUND" }, 404);
    }

    const session = await getSession(req).catch(() => null);
    const viewer = await resolvePublicProfileViewerTeamState({
      session,
      workspaceId: workspace.workspaceId,
    });

    if (!viewer.authenticated || !viewer.canManageWorkspace || !viewer.viewerUserId) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const members = await prisma.membership.findMany({
      where: {
        accountId: workspace.workspaceId,
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            email: true,
            avatarImage: true,
            avatarTone: true,
          },
        },
      },
    }).catch(() => []);

    return json(
      {
        ok: true,
        workspace: {
          id: workspace.workspaceId,
          name: workspace.workspaceName,
          planId: workspace.planId,
        },
        members: members.map((row) => ({
          membershipId: String(row.id),
          role: String(row.role || "MEMBER").toUpperCase(),
          createdAtISO: new Date(row.createdAt).toISOString(),
          user: {
            id: String(row.user.id),
            username: row.user.username ? String(row.user.username) : null,
            displayName: row.user.displayName ? String(row.user.displayName) : null,
            email: row.user.email ? String(row.user.email) : null,
            avatarImage: row.user.avatarImage ? String(row.user.avatarImage) : null,
            avatarTone: row.user.avatarTone ? String(row.user.avatarTone) : null,
          },
        })),
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
