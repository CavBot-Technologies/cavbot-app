import "server-only";

import { resolveAdminDepartment } from "@/lib/admin/access";
import type { AdminScope } from "@/lib/admin/permissions";
import { getAdminChatThread, listAdminChatThreads } from "@/lib/admin/chat.server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";

function readSingleSearchParam(
  searchParams: Record<string, string | string[] | undefined> | undefined,
  key: string,
) {
  const value = searchParams?.[key];
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

export async function getAdminChatWorkspaceSeed(args: {
  path: string;
  scopes: AdminScope[];
  searchParams?: Record<string, string | string[] | undefined>;
  allowMailboxSelection?: boolean;
  autoSelectFirstThread?: boolean;
}) {
  const ctx = await requireAdminAccessFromRequestContext(args.path, { scopes: args.scopes });
  const viewer = {
    id: ctx.staff.id,
    userId: ctx.userSession.sub,
    systemRole: ctx.staff.systemRole,
    scopes: ctx.staff.scopes,
  };

  const staff = await prisma.staffProfile.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ positionTitle: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      userId: true,
      systemRole: true,
      positionTitle: true,
      scopes: true,
      user: {
        select: {
          email: true,
          username: true,
          displayName: true,
          fullName: true,
          avatarImage: true,
          avatarTone: true,
        },
      },
    },
  });

  const viewerDepartment = resolveAdminDepartment(ctx.staff);
  const visibleStaff = args.allowMailboxSelection
    ? staff.filter((member) => {
        const memberDepartment = resolveAdminDepartment({
          scopes: member.scopes,
          systemRole: member.systemRole,
        });
        if (viewerDepartment === "COMMAND") return true;
        if (viewerDepartment === "HUMAN_RESOURCES") return memberDepartment !== "COMMAND";
        return member.userId === ctx.userSession.sub;
      })
    : staff;

  const staffOptions = visibleStaff.map((member) => ({
    id: member.id,
    userId: member.userId,
    name: member.user.displayName || member.user.fullName || member.user.username || member.user.email,
    email: member.user.email,
    avatarImage: member.user.avatarImage,
    avatarTone: member.user.avatarTone,
    department: Array.isArray(member.scopes)
      ? (member.scopes.find((scope) => String(scope).startsWith("department:")) || "").replace("department:", "").toUpperCase()
      : "TEAM",
    positionTitle: member.positionTitle,
  }));

  const threadQuery = readSingleSearchParam(args.searchParams, "thread");
  const mailboxQuery = readSingleSearchParam(args.searchParams, "mailbox");
  const allowedMailboxUserIds = new Set(staffOptions.map((staff) => staff.userId));
  const fallbackMailboxUserId = allowedMailboxUserIds.has(ctx.userSession.sub)
    ? ctx.userSession.sub
    : (staffOptions[0]?.userId || ctx.userSession.sub);
  const mailboxUserId = args.allowMailboxSelection
    ? (allowedMailboxUserIds.has(mailboxQuery) ? mailboxQuery : fallbackMailboxUserId)
    : undefined;

  const threads = await listAdminChatThreads({
    viewer,
    mailboxUserId,
    includeOrgBoxes: Boolean(args.allowMailboxSelection),
  });

  const initialThreadId = (
    threadQuery && threads.some((thread) => thread.id === threadQuery)
      ? threadQuery
      : args.autoSelectFirstThread
        ? (threads[0]?.id || "")
        : ""
  );
  const initialThread = initialThreadId
    ? await getAdminChatThread({
        viewer,
        threadId: initialThreadId,
        mailboxUserId,
      }).catch(() => null)
    : null;

  return {
    currentUserId: ctx.userSession.sub,
    initialThreads: JSON.parse(JSON.stringify(threads)),
    initialThread: initialThread ? JSON.parse(JSON.stringify(initialThread)) : null,
    initialMailboxUserId: mailboxUserId || ctx.userSession.sub,
    staffOptions: JSON.parse(JSON.stringify(staffOptions)),
  };
}
