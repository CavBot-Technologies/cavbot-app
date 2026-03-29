import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireSession, requireUser } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import {
  upsertFileCollaborator,
  upsertFolderCollaborator,
} from "@/lib/cavcloud/collab.server";
import {
  shareCavPadDirectoryByIdentity,
  shareCavPadNoteByIdentity,
} from "@/lib/cavpad/server";
import { prisma } from "@/lib/prisma";
import { resolvePublicProfileWorkspaceContext } from "@/lib/publicProfile/teamState.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, status = 200, extra?: Record<string, string>) {
  return NextResponse.json(data, {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      ...(extra || {}),
    },
  });
}

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function parsePermission(value: unknown): "VIEW" | "EDIT" {
  return s(value).toUpperCase() === "EDIT" ? "EDIT" : "VIEW";
}

function parseSource(value: unknown): "cavpad" | "cavcloud" | "cavsafe" | null {
  const v = s(value).toLowerCase();
  if (v === "cavpad") return "cavpad";
  if (v === "cavcloud") return "cavcloud";
  if (v === "cavsafe") return "cavsafe";
  return null;
}

function parseItemType(value: unknown): "note" | "directory" | "file" | "folder" | null {
  const v = s(value).toLowerCase();
  if (v === "note") return "note";
  if (v === "directory") return "directory";
  if (v === "file") return "file";
  if (v === "folder") return "folder";
  return null;
}

type CreateCollabBody = {
  username?: unknown;
  targetUserId?: unknown;
  source?: unknown;
  itemType?: unknown;
  itemId?: unknown;
  permission?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return json({ ok: false, error: "BAD_CSRF", message: "Missing request integrity token." }, 403);
    }

    const session = await requireSession(req);
    requireUser(session);

    const body = (await readSanitizedJson(req, null)) as CreateCollabBody | null;
    if (!body) return json({ ok: false, error: "BAD_REQUEST" }, 400);

    const username = s(body.username);
    const targetUserId = s(body.targetUserId);
    const source = parseSource(body.source);
    const itemType = parseItemType(body.itemType);
    const itemId = s(body.itemId);
    const permission = parsePermission(body.permission);
    const operatorUserId = s(session.sub);

    if (!username || !targetUserId || !source || !itemType || !itemId) {
      return json({ ok: false, error: "BAD_REQUEST" }, 400);
    }

    const workspace = await resolvePublicProfileWorkspaceContext(username);
    if (!workspace?.workspaceId) return json({ ok: false, error: "WORKSPACE_NOT_FOUND" }, 404);
    const accountId = workspace.workspaceId;

    const rate = consumeInMemoryRateLimit({
      key: `public-profile-collab:${operatorUserId}:${source}`,
      limit: 24,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return json(
        { ok: false, error: "RATE_LIMITED", message: "Too many collaboration requests. Please retry shortly." },
        429,
        { "Retry-After": String(rate.retryAfterSec) }
      );
    }

    const operatorMembership = await prisma.membership.findUnique({
      where: {
        accountId_userId: {
          accountId,
          userId: operatorUserId,
        },
      },
      select: {
        role: true,
      },
    }).catch(() => null);
    const operatorRole = s(operatorMembership?.role).toUpperCase();
    const canManageWorkspace = operatorRole === "OWNER" || operatorRole === "ADMIN";
    if (!canManageWorkspace) return json({ ok: false, error: "FORBIDDEN" }, 403);

    const targetMembership = await prisma.membership.findUnique({
      where: {
        accountId_userId: {
          accountId,
          userId: targetUserId,
        },
      },
      select: {
        userId: true,
        user: {
          select: {
            username: true,
            email: true,
          },
        },
      },
    }).catch(() => null);
    if (!targetMembership?.userId) return json({ ok: false, error: "TARGET_NOT_MEMBER" }, 404);
    if (targetMembership.userId === operatorUserId) {
      return json({ ok: false, error: "BAD_REQUEST", message: "Choose another member for collaboration." }, 400);
    }

    if (source === "cavcloud") {
      if (itemType === "file") {
        const collaborator = await upsertFileCollaborator({
          accountId,
          operatorUserId,
          fileId: itemId,
          targetUserId,
          permission,
          expiresAt: null,
        });
        await auditLogWrite({
          request: req,
          accountId,
          operatorUserId,
          action: "PROJECT_UPDATED",
          actionLabel: "CavCloud collaborator granted",
          targetType: "file",
          targetId: itemId,
          targetLabel: targetMembership.user?.username ? `@${targetMembership.user.username}` : targetMembership.user?.email || targetUserId,
          metaJson: {
            source: "cavcloud",
            permission,
            itemType,
          },
        });
        return json({ ok: true, source, itemType, collaborator }, 200);
      }

      if (itemType === "folder") {
        const collaborator = await upsertFolderCollaborator({
          accountId,
          operatorUserId,
          folderId: itemId,
          targetUserId,
          role: permission === "EDIT" ? "EDITOR" : "VIEWER",
          expiresAt: null,
        });
        await auditLogWrite({
          request: req,
          accountId,
          operatorUserId,
          action: "PROJECT_UPDATED",
          actionLabel: "CavCloud folder collaborator granted",
          targetType: "folder",
          targetId: itemId,
          targetLabel: targetMembership.user?.username ? `@${targetMembership.user.username}` : targetMembership.user?.email || targetUserId,
          metaJson: {
            source: "cavcloud",
            permission,
            itemType,
          },
        });
        return json({ ok: true, source, itemType, collaborator }, 200);
      }

      return json({ ok: false, error: "BAD_ITEM_TYPE" }, 400);
    }

    const identity = targetMembership.user?.username
      ? `@${s(targetMembership.user.username)}`
      : s(targetMembership.user?.email);
    if (!identity) return json({ ok: false, error: "TARGET_IDENTITY_MISSING" }, 400);

    if (source === "cavpad") {
      if (itemType === "note") {
        const result = await shareCavPadNoteByIdentity({
          accountId,
          userId: operatorUserId,
          noteId: itemId,
          identity,
          permission,
          expiresInDays: 0,
        });
        if (!result.ok) {
          return json({ ok: false, error: s(result.error) || "COLLAB_FAILED", message: s(result.message) || "Collaboration failed." }, 400);
        }

        await auditLogWrite({
          request: req,
          accountId,
          operatorUserId,
          action: "PROJECT_UPDATED",
          actionLabel: "CavPad note collaborator granted",
          targetType: "note",
          targetId: itemId,
          targetLabel: identity,
          metaJson: {
            source: "cavpad",
            permission,
            itemType,
          },
        });

        return json({ ok: true, source, itemType, share: result.share }, 200);
      }

      if (itemType === "directory") {
        const result = await shareCavPadDirectoryByIdentity({
          accountId,
          userId: operatorUserId,
          directoryId: itemId,
          identity,
          permission,
          expiresInDays: 0,
        });

        await auditLogWrite({
          request: req,
          accountId,
          operatorUserId,
          action: "PROJECT_UPDATED",
          actionLabel: "CavPad folder collaborator granted",
          targetType: "folder",
          targetId: itemId,
          targetLabel: identity,
          metaJson: {
            source: "cavpad",
            permission,
            itemType,
          },
        });

        return json({ ok: true, source, itemType, share: result.share }, 200);
      }

      return json({ ok: false, error: "BAD_ITEM_TYPE" }, 400);
    }

    // CavSafe collaboration: premium plans only, owner-gated.
    if (workspace.planId === "free") {
      return json({ ok: false, error: "PLAN_UPGRADE_REQUIRED", message: "CavSafe collaboration is available on paid plans only." }, 403);
    }
    if (operatorRole !== "OWNER") {
      return json({ ok: false, error: "FORBIDDEN", message: "Only the workspace owner can initiate CavSafe collaboration." }, 403);
    }
    if (itemType !== "file" && itemType !== "folder") {
      return json({ ok: false, error: "BAD_ITEM_TYPE" }, 400);
    }

    const cavsafeItem =
      itemType === "file"
        ? await prisma.cavSafeFile.findFirst({
            where: {
              id: itemId,
              accountId,
              deletedAt: null,
            },
            select: {
              id: true,
              path: true,
              name: true,
            },
          }).catch(() => null)
        : await prisma.cavSafeFolder.findFirst({
            where: {
              id: itemId,
              accountId,
              deletedAt: null,
            },
            select: {
              id: true,
              path: true,
              name: true,
            },
          }).catch(() => null);
    if (!cavsafeItem?.id) {
      return json({ ok: false, error: "RESOURCE_NOT_FOUND", message: "CavSafe item not found." }, 404);
    }

    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const existingShare = await prisma.cavSafeShare.findFirst({
      where: {
        accountId,
        targetUserId,
        revokedAt: null,
        ...(itemType === "file" ? { fileId: cavsafeItem.id } : { folderId: cavsafeItem.id }),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }).catch(() => null);

    const share = existingShare?.id
      ? await prisma.cavSafeShare.update({
          where: { id: existingShare.id },
          data: {
            targetUserId,
            mode: "READ_ONLY",
            expiresAt,
            revokedAt: null,
            ...(itemType === "file" ? { fileId: cavsafeItem.id, folderId: null } : { folderId: cavsafeItem.id, fileId: null }),
          },
          select: {
            id: true,
            mode: true,
            expiresAt: true,
            fileId: true,
            folderId: true,
          },
        })
      : await prisma.cavSafeShare.create({
          data: {
            accountId,
            targetUserId,
            mode: "READ_ONLY",
            expiresAt,
            createdByUserId: operatorUserId,
            ...(itemType === "file" ? { fileId: cavsafeItem.id, folderId: null } : { folderId: cavsafeItem.id, fileId: null }),
          },
          select: {
            id: true,
            mode: true,
            expiresAt: true,
            fileId: true,
            folderId: true,
          },
        });

    const targetLabel = targetMembership.user?.username
      ? `@${targetMembership.user.username}`
      : targetMembership.user?.email || targetUserId;
    const itemLabel = s(cavsafeItem.name) || s(cavsafeItem.path) || itemId;
    const effectivePermission = "VIEW";

    await auditLogWrite({
      request: req,
      accountId,
      operatorUserId,
      action: "PROJECT_UPDATED",
      actionLabel: "CavSafe collaborator granted",
      targetType: itemType,
      targetId: cavsafeItem.id,
      targetLabel,
      metaJson: {
        source: "cavsafe",
        requestedPermission: permission,
        effectivePermission,
        itemType,
        itemPath: s(cavsafeItem.path) || null,
      },
    });

    try {
      await prisma.cavSafeActivity.create({
        data: {
          accountId,
          operatorUserId,
          action: "COLLAB_GRANTED",
          targetType: itemType,
          targetId: cavsafeItem.id,
          targetPath: s(cavsafeItem.path) || null,
          metaJson: {
            targetUserId,
            requestedPermission: permission,
            effectivePermission,
            shareId: share.id,
          },
        },
      });
    } catch {
      // Non-blocking activity write.
    }

    try {
      await prisma.notification.create({
        data: {
          userId: targetUserId,
          accountId,
          title: "CavSafe collaboration granted",
          body: `${itemLabel} was shared with you from ${workspace.workspaceName}.`,
          tone: "GOOD",
          kind: "GENERIC",
          href: "/cavsafe",
          metaJson: {
            source: "cavsafe",
            itemType,
            itemId: cavsafeItem.id,
            itemPath: s(cavsafeItem.path) || null,
            grantedByUserId: operatorUserId,
            effectivePermission,
          },
        },
      });
    } catch {
      // Non-blocking notification write.
    }

    return json(
      {
        ok: true,
        source,
        itemType,
        share,
        permission: effectivePermission,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...NO_STORE_HEADERS,
      Allow: "POST, OPTIONS",
    },
  });
}
