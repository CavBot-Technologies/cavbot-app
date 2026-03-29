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

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function clampLimit(value: unknown, fallback = 40) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(120, Math.trunc(n)));
}

function parseSource(value: unknown): "cavpad" | "cavcloud" | "cavsafe" | null {
  const v = s(value).toLowerCase();
  if (v === "cavpad") return "cavpad";
  if (v === "cavcloud") return "cavcloud";
  if (v === "cavsafe") return "cavsafe";
  return null;
}

function containsFilter(query: string) {
  if (!query) return undefined;
  return {
    contains: query,
    mode: "insensitive" as const,
  };
}

export async function GET(req: NextRequest) {
  try {
    const username = s(req.nextUrl.searchParams.get("username"));
    const source = parseSource(req.nextUrl.searchParams.get("source"));
    const q = s(req.nextUrl.searchParams.get("q"));
    const limit = clampLimit(req.nextUrl.searchParams.get("limit"), 40);

    if (!source) return json({ ok: false, error: "BAD_SOURCE" }, 400);

    const workspace = await resolvePublicProfileWorkspaceContext(username);
    if (!workspace?.workspaceId) return json({ ok: false, error: "WORKSPACE_NOT_FOUND" }, 404);

    const session = await getSession(req).catch(() => null);
    const viewer = await resolvePublicProfileViewerTeamState({
      session,
      workspaceId: workspace.workspaceId,
    });
    if (!viewer.authenticated || !viewer.canManageWorkspace || !viewer.viewerUserId) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const queryFilter = containsFilter(q);

    if (source === "cavpad") {
      const [notes, directories] = await Promise.all([
        prisma.cavPadNote.findMany({
          where: {
            accountId: workspace.workspaceId,
            trashedAt: null,
            ...(queryFilter ? { title: queryFilter } : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          select: {
            id: true,
            title: true,
            updatedAt: true,
            directory: {
              select: {
                name: true,
              },
            },
          },
        }),
        prisma.cavPadDirectory.findMany({
          where: {
            accountId: workspace.workspaceId,
            ...(queryFilter ? { name: queryFilter } : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          select: {
            id: true,
            name: true,
            updatedAt: true,
          },
        }),
      ]);

      const items = [
        ...directories.map((row) => ({
          id: String(row.id),
          source: "cavpad" as const,
          itemType: "directory" as const,
          label: String(row.name || "Folder"),
          subLabel: "CavPad folder",
          updatedAtISO: new Date(row.updatedAt).toISOString(),
        })),
        ...notes.map((row) => ({
          id: String(row.id),
          source: "cavpad" as const,
          itemType: "note" as const,
          label: String(row.title || "Untitled"),
          subLabel: row.directory?.name ? `CavPad note · ${String(row.directory.name)}` : "CavPad note",
          updatedAtISO: new Date(row.updatedAt).toISOString(),
        })),
      ]
        .sort((a, b) => Date.parse(b.updatedAtISO) - Date.parse(a.updatedAtISO))
        .slice(0, limit);

      return json(
        {
          ok: true,
          source,
          cavsafeAvailable: workspace.planId !== "free" && viewer.workspaceRole === "OWNER",
          items,
        },
        200
      );
    }

    if (source === "cavcloud") {
      const [files, folders] = await Promise.all([
        prisma.cavCloudFile.findMany({
          where: {
            accountId: workspace.workspaceId,
            deletedAt: null,
            ...(queryFilter
              ? {
                  OR: [
                    { name: queryFilter },
                    { path: queryFilter },
                  ],
                }
              : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          select: {
            id: true,
            name: true,
            path: true,
            updatedAt: true,
          },
        }),
        prisma.cavCloudFolder.findMany({
          where: {
            accountId: workspace.workspaceId,
            deletedAt: null,
            ...(queryFilter
              ? {
                  OR: [
                    { name: queryFilter },
                    { path: queryFilter },
                  ],
                }
              : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          select: {
            id: true,
            name: true,
            path: true,
            updatedAt: true,
          },
        }),
      ]);

      const items = [
        ...folders.map((row) => ({
          id: String(row.id),
          source: "cavcloud" as const,
          itemType: "folder" as const,
          label: String(row.name || "Folder"),
          subLabel: s(row.path) || "CavCloud folder",
          updatedAtISO: new Date(row.updatedAt).toISOString(),
        })),
        ...files.map((row) => ({
          id: String(row.id),
          source: "cavcloud" as const,
          itemType: "file" as const,
          label: String(row.name || "File"),
          subLabel: s(row.path) || "CavCloud file",
          updatedAtISO: new Date(row.updatedAt).toISOString(),
        })),
      ]
        .sort((a, b) => Date.parse(b.updatedAtISO) - Date.parse(a.updatedAtISO))
        .slice(0, limit);

      return json(
        {
          ok: true,
          source,
          cavsafeAvailable: workspace.planId !== "free" && viewer.workspaceRole === "OWNER",
          items,
        },
        200
      );
    }

    if (workspace.planId === "free") {
      return json(
        {
          ok: true,
          source,
          cavsafeAvailable: false,
          items: [],
        },
        200
      );
    }

    // CavSafe listing is restricted to workspace owners.
    if (viewer.workspaceRole !== "OWNER") {
      return json(
        {
          ok: true,
          source,
          cavsafeAvailable: false,
          items: [],
        },
        200
      );
    }

    const [files, folders] = await Promise.all([
      prisma.cavSafeFile.findMany({
        where: {
          accountId: workspace.workspaceId,
          deletedAt: null,
          ...(queryFilter
            ? {
                OR: [
                  { name: queryFilter },
                  { path: queryFilter },
                ],
              }
            : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          path: true,
          updatedAt: true,
        },
      }),
      prisma.cavSafeFolder.findMany({
        where: {
          accountId: workspace.workspaceId,
          deletedAt: null,
          ...(queryFilter
            ? {
                OR: [
                  { name: queryFilter },
                  { path: queryFilter },
                ],
              }
            : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          path: true,
          updatedAt: true,
        },
      }),
    ]);

    const items = [
      ...folders.map((row) => ({
        id: String(row.id),
        source: "cavsafe" as const,
        itemType: "folder" as const,
        label: String(row.name || "Folder"),
        subLabel: s(row.path) || "CavSafe folder",
        updatedAtISO: new Date(row.updatedAt).toISOString(),
      })),
      ...files.map((row) => ({
        id: String(row.id),
        source: "cavsafe" as const,
        itemType: "file" as const,
        label: String(row.name || "File"),
        subLabel: s(row.path) || "CavSafe file",
        updatedAtISO: new Date(row.updatedAt).toISOString(),
      })),
    ]
      .sort((a, b) => Date.parse(b.updatedAtISO) - Date.parse(a.updatedAtISO))
      .slice(0, limit);

    return json(
      {
        ok: true,
        source,
        cavsafeAvailable: true,
        items,
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
