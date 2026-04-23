import "server-only";

import { randomBytes } from "crypto";

import { hasAdminScope } from "@/lib/admin/permissions";
import { createAdminNotification } from "@/lib/admin/notifications.server";
import { adminR2Configured, putAdminR2Object } from "@/lib/admin/r2.server";
import { resolveAdminDepartment, type AdminDepartment } from "@/lib/admin/access";
import { getDepartmentAvatarTone } from "@/lib/admin/staffDisplay";
import { prisma } from "@/lib/prisma";

type Viewer = {
  id: string;
  userId: string;
  systemRole: string;
  scopes?: string[] | null;
};

type ChatAttachmentInput = {
  fileName: string;
  contentType: string;
  body: Buffer;
};

type ChatThreadListArgs = {
  viewer: Viewer;
  mailboxUserId?: string | null;
  search?: string | null;
  includeOrgBoxes?: boolean;
};

type ChatThreadDetailArgs = {
  viewer: Viewer;
  threadId: string;
  mailboxUserId?: string | null;
};

type AdminChatBoxDefinition = {
  slug: string;
  label: string;
  description: string;
  allowedDepartments: readonly AdminDepartment[];
};

function safeId(value: unknown) {
  return String(value || "").trim();
}

function safeText(value: unknown, max = 4000) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  return normalized.slice(0, Math.max(1, max));
}

const ALLOWED_CHAT_FONT_FAMILIES = new Set([
  '"Avenir Next", Avenir, "SF Pro Text", system-ui, sans-serif',
  '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
  '"Space Grotesk", "Avenir Next", system-ui, sans-serif',
  '"Manrope", "Inter", system-ui, sans-serif',
  '"DM Sans", "Segoe UI", system-ui, sans-serif',
  '"Nunito Sans", "Avenir Next", system-ui, sans-serif',
  '"Helvetica Neue", Helvetica, Arial, sans-serif',
  '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
  'Charter, Georgia, serif',
  '"Times New Roman", Times, serif',
  '"IBM Plex Mono", "SFMono-Regular", Menlo, monospace',
  '"SFMono-Regular", Menlo, Consolas, monospace',
]);

function sanitizeChatHtml(value: unknown, max = 40_000) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .replace(/<\s*(script|style|iframe|object|embed|meta|link)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|meta|link)[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, "")
    .slice(0, Math.max(1, max));
}

function normalizeChatFontFamily(value: unknown) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return ALLOWED_CHAT_FONT_FAMILIES.has(normalized) ? normalized : null;
}

function previewText(value: string) {
  return safeText(value, 180);
}

const ADMIN_CHAT_SYSTEM_SENDER_ID = "system:cavbot-admin";
const ADMIN_CHAT_SYSTEM_SENDER_NAME = "CavBot Admin";
const ADMIN_CHAT_SYSTEM_SENDER_EMAIL = "admin@cavbot.io";
const ADMIN_CHAT_WELCOME_THREAD_PREFIX = "system:welcome:";
const ADMIN_CHAT_WELCOME_SUBJECT = "Welcome to CavChat";

function directKeyForUsers(userIds: string[]) {
  const normalized = Array.from(new Set(userIds.map((value) => safeId(value)).filter(Boolean))).sort();
  return normalized.join(":");
}

function buildWelcomeToCavChatBody() {
  return [
    "This is your secure staff inbox for internal communication inside HQ.",
    "",
    "Use Compose or reply here to confirm your mailbox is live.",
  ].join("\n");
}

export const ADMIN_CHAT_BOX_DEFINITIONS: readonly AdminChatBoxDefinition[] = [
  {
    slug: "command",
    label: "Command",
    description: "Executive command channel.",
    allowedDepartments: ["COMMAND"],
  },
  {
    slug: "operations",
    label: "Operations",
    description: "Operational coordination.",
    allowedDepartments: ["OPERATIONS"],
  },
  {
    slug: "security",
    label: "Security",
    description: "Investigations, guardrails, and incidents.",
    allowedDepartments: ["SECURITY"],
  },
  {
    slug: "human_resources",
    label: "Human Resources",
    description: "Staff lifecycle and internal staffing workflows.",
    allowedDepartments: ["HUMAN_RESOURCES"],
  },
  {
    slug: "billing_ops",
    label: "Billing Ops",
    description: "Trials, plan changes, and revenue operations.",
    allowedDepartments: ["COMMAND", "OPERATIONS"],
  },
  {
    slug: "trust_safety",
    label: "Trust & Safety",
    description: "Suspensions, recovery, and risk review.",
    allowedDepartments: ["COMMAND", "SECURITY"],
  },
  {
    slug: "customer_success",
    label: "Customer Success",
    description: "Interventions, onboarding, and customer follow-through.",
    allowedDepartments: ["COMMAND", "OPERATIONS"],
  },
  {
    slug: "broadcasts",
    label: "Broadcasts",
    description: "Internal broadcast delivery thread.",
    allowedDepartments: ["COMMAND", "OPERATIONS", "HUMAN_RESOURCES"],
  },
  {
    slug: "approvals",
    label: "Approvals",
    description: "Sensitive actions and internal approvals.",
    allowedDepartments: ["COMMAND", "OPERATIONS", "SECURITY", "HUMAN_RESOURCES"],
  },
  {
    slug: "founder",
    label: "Founder",
    description: "Founder office and executive escalation.",
    allowedDepartments: ["COMMAND"],
  },
] as const;

function canOverseeMailbox(viewer: Viewer) {
  return hasAdminScope(viewer, "messaging.oversight");
}

function oversightViewerDepartment(viewer: Viewer) {
  return resolveAdminDepartment(viewer);
}

function isOversightReviewRequest(viewer: Viewer, requestedMailboxUserId?: string | null) {
  return canOverseeMailbox(viewer) && Boolean(safeId(requestedMailboxUserId));
}

async function assertMailboxOversightAccess(viewer: Viewer, mailboxUserId: string) {
  if (!canOverseeMailbox(viewer)) throw new Error("MAILBOX_OVERSIGHT_REQUIRED");

  const viewerDepartment = oversightViewerDepartment(viewer);
  if (viewerDepartment === "COMMAND") return;

  const mailboxStaff = await getStaffProfileByUserId(mailboxUserId);
  if (!isStaffActive(mailboxStaff)) throw new Error("MAILBOX_OVERSIGHT_FORBIDDEN");

  const mailboxDepartment = resolveAdminDepartment(mailboxStaff);
  if (viewerDepartment === "HUMAN_RESOURCES" && mailboxDepartment !== "COMMAND") return;

  throw new Error("MAILBOX_OVERSIGHT_FORBIDDEN");
}

async function resolveMailboxUserId(viewer: Viewer, requestedMailboxUserId?: string | null) {
  const mailboxUserId = safeId(requestedMailboxUserId);
  if (!mailboxUserId || mailboxUserId === viewer.userId) return viewer.userId;
  await assertMailboxOversightAccess(viewer, mailboxUserId);
  return mailboxUserId;
}

async function getStaffProfileByUserId(userId: string) {
  return prisma.staffProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      userId: true,
      systemRole: true,
      scopes: true,
      status: true,
    },
  });
}

function isStaffActive(
  staff: Awaited<ReturnType<typeof getStaffProfileByUserId>>,
): staff is NonNullable<Awaited<ReturnType<typeof getStaffProfileByUserId>>> {
  return Boolean(staff?.id) && staff?.status === "ACTIVE";
}

async function ensureChatBoxes() {
  const results = [];
  for (const definition of ADMIN_CHAT_BOX_DEFINITIONS) {
    const box = await prisma.adminChatBox.upsert({
      where: { slug: definition.slug },
      update: {
        label: definition.label,
        description: definition.description,
        kind: "ORG",
        allowedDepartments: [...definition.allowedDepartments],
      },
      create: {
        slug: definition.slug,
        label: definition.label,
        description: definition.description,
        kind: "ORG",
        allowedDepartments: [...definition.allowedDepartments],
      },
    });

    const thread = await prisma.adminChatThread.upsert({
      where: { directKey: `box:${definition.slug}` },
      update: {
        boxId: box.id,
        subject: definition.label,
      },
      create: {
        boxId: box.id,
        directKey: `box:${definition.slug}`,
        subject: definition.label,
      },
    });

    results.push({ box, thread });
  }
  return results;
}

async function ensureOrgParticipantsForThread(threadId: string, boxSlug: string) {
  const definition = ADMIN_CHAT_BOX_DEFINITIONS.find((item) => item.slug === boxSlug);
  if (!definition) return;

  const staff = await prisma.staffProfile.findMany({
    where: {
      status: "ACTIVE",
    },
    select: {
      id: true,
      userId: true,
      systemRole: true,
      scopes: true,
    },
  });

  for (const member of staff) {
    const department = resolveAdminDepartment(member);
    if (!(definition.allowedDepartments as readonly string[]).includes(department)) continue;
    await prisma.adminChatParticipant.upsert({
      where: {
        threadId_userId: {
          threadId,
          userId: member.userId,
        },
      },
      update: {
        staffId: member.id,
      },
      create: {
        threadId,
        userId: member.userId,
        staffId: member.id,
        role: department === "COMMAND" ? "OWNER" : "MEMBER",
      },
    });
  }
}

async function ensureMailboxOrgParticipants(viewer: Viewer, mailboxUserId: string) {
  const mailboxStaff = await getStaffProfileByUserId(mailboxUserId);
  if (!isStaffActive(mailboxStaff)) throw new Error("CHAT_STAFF_REQUIRED");
  const activeMailboxStaff = mailboxStaff;

  const department = resolveAdminDepartment(activeMailboxStaff);
  const allowedBoxSlugs = ADMIN_CHAT_BOX_DEFINITIONS
    .filter((definition) => definition.allowedDepartments.includes(department))
    .map((definition) => definition.slug);

  let existingOrgParticipantCount = 0;
  if (allowedBoxSlugs.length) {
    existingOrgParticipantCount = await prisma.adminChatParticipant.count({
      where: {
        userId: mailboxUserId,
        thread: {
          box: {
            slug: {
              in: allowedBoxSlugs,
            },
          },
        },
      },
    });
  }

  if (existingOrgParticipantCount < allowedBoxSlugs.length) {
    await ensureChatBoxes();
    const seeded = await prisma.adminChatBox.findMany({
      where: {
        slug: {
          in: allowedBoxSlugs,
        },
      },
      include: {
        threads: {
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });

    for (const box of seeded) {
      const thread = box.threads[0];
      if (!thread) continue;
      await prisma.adminChatParticipant.upsert({
        where: {
          threadId_userId: {
            threadId: thread.id,
            userId: mailboxUserId,
          },
        },
        update: {
          staffId: activeMailboxStaff.id,
        },
        create: {
          threadId: thread.id,
          userId: mailboxUserId,
          staffId: activeMailboxStaff.id,
          role: department === "COMMAND" ? "OWNER" : "MEMBER",
        },
      });
    }
  }

  await ensureWelcomeThreadForMailbox({
    mailboxUserId,
    mailboxStaffId: activeMailboxStaff.id,
  });
}

async function ensureWelcomeThreadForMailbox(args: {
  mailboxUserId: string;
  mailboxStaffId: string;
}) {
  const directKey = `${ADMIN_CHAT_WELCOME_THREAD_PREFIX}${safeId(args.mailboxUserId)}`;
  if (!directKey) return null;

  const existing = await prisma.adminChatThread.findUnique({
    where: { directKey },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          senderUserId: true,
          bodyText: true,
          metaJson: true,
        },
      },
    },
  });

  const thread = existing || await prisma.adminChatThread.create({
    data: {
      subject: ADMIN_CHAT_WELCOME_SUBJECT,
      directKey,
      isDirect: false,
      metaJson: {
        systemThread: true,
        systemCategory: "WELCOME",
      },
    },
  });

  await prisma.adminChatParticipant.upsert({
    where: {
      threadId_userId: {
        threadId: thread.id,
        userId: args.mailboxUserId,
      },
    },
    update: {
      staffId: args.mailboxStaffId,
      role: "OWNER",
      isArchived: false,
    },
    create: {
      threadId: thread.id,
      userId: args.mailboxUserId,
      staffId: args.mailboxStaffId,
      role: "OWNER",
    },
  });

  const body = buildWelcomeToCavChatBody();
  const existingMessage = existing?.messages?.[0] || null;
  const existingMessageMeta = existingMessage?.metaJson && typeof existingMessage.metaJson === "object"
    ? existingMessage.metaJson as Record<string, unknown>
    : null;

  if (existingMessage?.id) {
    const isWelcomeMessage = existingMessage.senderUserId === ADMIN_CHAT_SYSTEM_SENDER_ID
      && String(existingMessageMeta?.systemCategory || "").trim().toUpperCase() === "WELCOME";
    if (isWelcomeMessage && existingMessage.bodyText !== body) {
      await prisma.adminChatMessage.update({
        where: { id: existingMessage.id },
        data: {
          previewText: previewText(body),
          searchText: body,
          bodyText: body,
        },
      });

      const existingNotification = await prisma.notification.findFirst({
        where: {
          userId: args.mailboxUserId,
          kind: "HQ_CHAT_MESSAGE",
          title: ADMIN_CHAT_WELCOME_SUBJECT,
          href: "/admin-internal/chat",
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (existingNotification?.id) {
        await prisma.notification.update({
          where: { id: existingNotification.id },
          data: {
            body: previewText(body),
          },
        }).catch(() => null);
      }
    }
    return thread;
  }

  const now = new Date();
  const message = await prisma.adminChatMessage.create({
    data: {
      threadId: thread.id,
      senderUserId: ADMIN_CHAT_SYSTEM_SENDER_ID,
      kind: "SYSTEM",
      previewText: previewText(body),
      searchText: body,
      bodyText: body,
      metaJson: {
        senderName: ADMIN_CHAT_SYSTEM_SENDER_NAME,
        senderEmail: ADMIN_CHAT_SYSTEM_SENDER_EMAIL,
        systemCategory: "WELCOME",
      },
    },
  });

  await prisma.adminChatThread.update({
    where: { id: thread.id },
    data: {
      lastMessageAt: now,
    },
  });

  await prisma.adminChatParticipant.update({
    where: {
      threadId_userId: {
        threadId: thread.id,
        userId: args.mailboxUserId,
      },
    },
    data: {
      readAt: null,
      lastReadMessageId: null,
      isArchived: false,
    },
  });

  await createAdminNotification({
    userId: args.mailboxUserId,
    title: ADMIN_CHAT_WELCOME_SUBJECT,
    body: previewText(body),
    href: "/admin-internal/chat",
    kind: "HQ_CHAT_MESSAGE",
    tone: "WATCH",
    meta: {
      threadId: thread.id,
      messageId: message.id,
      senderUserId: ADMIN_CHAT_SYSTEM_SENDER_ID,
      systemCategory: "WELCOME",
    },
  }).catch(() => null);

  return thread;
}

async function getThreadParticipantsMap(threadIds: string[]) {
  const ids = Array.from(new Set(threadIds.map((value) => safeId(value)).filter(Boolean)));
  if (!ids.length) return new Map<string, Array<{ userId: string; staffId: string | null }>>();

  const participants = await prisma.adminChatParticipant.findMany({
    where: { threadId: { in: ids } },
    select: {
      threadId: true,
      userId: true,
      staffId: true,
    },
  });

  const out = new Map<string, Array<{ userId: string; staffId: string | null }>>();
  for (const participant of participants) {
    const bucket = out.get(participant.threadId) || [];
    bucket.push({ userId: participant.userId, staffId: participant.staffId || null });
    out.set(participant.threadId, bucket);
  }
  return out;
}

async function getUserMap(userIds: string[]) {
  const ids = Array.from(new Set(userIds.map((value) => safeId(value)).filter(Boolean)));
  if (!ids.length) return new Map<string, { id: string; email: string; username: string | null; displayName: string | null; fullName: string | null; avatarImage: string | null; avatarTone: string | null }>();

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      fullName: true,
      avatarImage: true,
      avatarTone: true,
    },
  });

  return new Map(users.map((user) => [user.id, user]));
}

async function getStaffDepartmentMap(userIds: string[]) {
  const ids = Array.from(new Set(userIds.map((value) => safeId(value)).filter(Boolean)));
  if (!ids.length) return new Map<string, string>();

  const staffRows = await prisma.staffProfile.findMany({
    where: {
      userId: { in: ids },
      status: "ACTIVE",
    },
    select: {
      userId: true,
      scopes: true,
      systemRole: true,
    },
  });

  return new Map(
    staffRows.map((row) => [
      row.userId,
      resolveAdminDepartment({
        scopes: row.scopes,
        systemRole: row.systemRole,
      }),
    ]),
  );
}

function canAccessBox(viewer: Viewer, box: { allowedDepartments: string[] }) {
  if (canOverseeMailbox(viewer)) {
    const viewerDepartment = oversightViewerDepartment(viewer);
    if (viewerDepartment === "COMMAND") return true;
    if (viewerDepartment === "HUMAN_RESOURCES") {
      return !Array.isArray(box.allowedDepartments) || !box.allowedDepartments.includes("COMMAND");
    }
  }
  const viewerDepartment = resolveAdminDepartment(viewer);
  return Array.isArray(box.allowedDepartments) && box.allowedDepartments.includes(viewerDepartment);
}

function threadIncludesCommandConversation(args: {
  box?: { allowedDepartments?: string[] | null } | null;
  threadParticipants: Array<{ userId: string }>;
  senderUserIds?: Array<string | null | undefined>;
  staffDepartmentMap: Map<string, string>;
}) {
  if (args.box && Array.isArray(args.box.allowedDepartments) && args.box.allowedDepartments.includes("COMMAND")) {
    return true;
  }

  if ((args.senderUserIds || []).some((userId) => {
    const normalized = safeId(userId);
    if (!normalized) return false;
    if (normalized === ADMIN_CHAT_SYSTEM_SENDER_ID) return true;
    return args.staffDepartmentMap.get(normalized) === "COMMAND";
  })) {
    return true;
  }

  return args.threadParticipants.some((participant) => args.staffDepartmentMap.get(participant.userId) === "COMMAND");
}

function canReviewThreadForViewer(args: {
  viewer: Viewer;
  requestedMailboxUserId?: string | null;
  box?: { allowedDepartments?: string[] | null } | null;
  threadParticipants: Array<{ userId: string }>;
  senderUserIds?: Array<string | null | undefined>;
  staffDepartmentMap: Map<string, string>;
}) {
  if (!isOversightReviewRequest(args.viewer, args.requestedMailboxUserId)) return true;

  const viewerDepartment = oversightViewerDepartment(args.viewer);
  if (viewerDepartment === "COMMAND") return true;
  if (viewerDepartment === "HUMAN_RESOURCES") {
    return !threadIncludesCommandConversation({
      box: args.box,
      threadParticipants: args.threadParticipants,
      senderUserIds: args.senderUserIds,
      staffDepartmentMap: args.staffDepartmentMap,
    });
  }

  return false;
}

export async function listAdminChatThreads(args: ChatThreadListArgs) {
  const mailboxUserId = await resolveMailboxUserId(args.viewer, args.mailboxUserId);
  await ensureMailboxOrgParticipants(args.viewer, mailboxUserId);

  const participants = await prisma.adminChatParticipant.findMany({
    where: {
      userId: mailboxUserId,
      ...(safeText(args.search, 120)
        ? {
            thread: {
              OR: [
                { subject: { contains: safeText(args.search, 120), mode: "insensitive" } },
                {
                  messages: {
                    some: {
                      OR: [
                        { previewText: { contains: safeText(args.search, 120), mode: "insensitive" } },
                        { searchText: { contains: safeText(args.search, 120), mode: "insensitive" } },
                      ],
                    },
                  },
                },
              ],
            },
          }
        : {}),
    },
    include: {
      thread: {
        include: {
          box: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              previewText: true,
              bodyText: true,
              senderUserId: true,
              createdAt: true,
              metaJson: true,
            },
          },
        },
      },
    },
    orderBy: {
      thread: { updatedAt: "desc" },
    },
    take: 200,
  });

  const visible = participants.filter((participant) => {
    if (!participant.thread.box) return true;
    return canAccessBox(args.viewer, participant.thread.box);
  });

  const threadIds = visible.map((participant) => participant.threadId);
  const participantMap = await getThreadParticipantsMap(threadIds);
  const userIds = Array.from(new Set([
    mailboxUserId,
    ...Array.from(participantMap.values()).flat().map((participant) => participant.userId),
  ]));
  const userMap = await getUserMap(userIds);
  const staffDepartmentMap = await getStaffDepartmentMap(userIds);
  const draftRows = await prisma.adminChatDraft.findMany({
    where: {
      userId: mailboxUserId,
      threadId: { in: threadIds },
    },
  });
  const draftsByThreadId = new Map(draftRows.map((draft) => [draft.threadId, draft]));
  const includeOrgBoxes = Boolean(args.includeOrgBoxes);
  const listableParticipants = visible.filter((participant) => {
    const threadParticipants = participantMap.get(participant.threadId) || [];
    const lastMessage = participant.thread.messages[0] || null;
    if (!canReviewThreadForViewer({
      viewer: args.viewer,
      requestedMailboxUserId: args.mailboxUserId,
      box: participant.thread.box,
      threadParticipants,
      senderUserIds: [lastMessage?.senderUserId || null],
      staffDepartmentMap,
    })) {
      return false;
    }
    if (!includeOrgBoxes && participant.thread.boxId) return false;
    const draft = draftsByThreadId.get(participant.threadId);
    return Boolean(lastMessage || draft?.body || draft?.attachmentIds?.length);
  });

  return listableParticipants.map((participant) => {
    const threadParticipants = participantMap.get(participant.threadId) || [];
    const lastMessage = participant.thread.messages[0] || null;
    const lastMessageMeta = lastMessage?.metaJson && typeof lastMessage.metaJson === "object" ? lastMessage.metaJson as Record<string, unknown> : null;
    const otherUsers = threadParticipants
      .filter((entry) => entry.userId !== mailboxUserId)
      .map((entry) => userMap.get(entry.userId))
      .filter(Boolean);
    const counterpartLabel = otherUsers.map((user) => user?.displayName || user?.fullName || user?.username || user?.email).filter(Boolean).join(", ")
      || safeText(lastMessageMeta?.senderName, 140);
    const senderUserId = lastMessage?.senderUserId || "";
    const senderUser = senderUserId ? userMap.get(senderUserId) : null;
    const senderDepartment = senderUserId === ADMIN_CHAT_SYSTEM_SENDER_ID
      ? "COMMAND"
      : (staffDepartmentMap.get(senderUserId) || null);
    const unread = Boolean(
      lastMessage
      && lastMessage.senderUserId !== mailboxUserId
      && (!participant.readAt || participant.readAt.getTime() < lastMessage.createdAt.getTime())
    );

    return {
      id: participant.thread.id,
      boxId: participant.thread.boxId,
      boxSlug: participant.thread.box?.slug || null,
      boxLabel: participant.thread.box?.label || null,
      isDirect: participant.thread.isDirect,
      starred: participant.isMuted,
      subject: participant.thread.subject,
      counterpartLabel: counterpartLabel || null,
      preview: lastMessage?.previewText || lastMessage?.bodyText || "",
      senderAvatarImage: senderUser?.avatarImage || null,
      senderAvatarTone: getDepartmentAvatarTone(senderDepartment),
      unread,
      archived: participant.isArchived,
      lastMessageAt: participant.thread.lastMessageAt?.toISOString() || participant.thread.updatedAt.toISOString(),
      lastAuthorUserId: lastMessage?.senderUserId || null,
      participantUserIds: threadParticipants.map((entry) => entry.userId),
      draftBody: draftsByThreadId.get(participant.threadId)?.body || null,
      draftUpdatedAt: draftsByThreadId.get(participant.threadId)?.updatedAt.toISOString() || null,
    };
  });
}

export async function getAdminChatThread(args: ChatThreadDetailArgs) {
  const mailboxUserId = await resolveMailboxUserId(args.viewer, args.mailboxUserId);
  await ensureMailboxOrgParticipants(args.viewer, mailboxUserId);

  const participant = await prisma.adminChatParticipant.findUnique({
    where: {
      threadId_userId: {
        threadId: safeId(args.threadId),
        userId: mailboxUserId,
      },
    },
    include: {
      thread: {
        include: {
          box: true,
        },
      },
    },
  });

  if (!participant?.thread) throw new Error("CHAT_THREAD_NOT_FOUND");
  if (participant.thread.box && !canAccessBox(args.viewer, participant.thread.box)) {
    throw new Error("CHAT_THREAD_FORBIDDEN");
  }

  const messages = await prisma.adminChatMessage.findMany({
    where: { threadId: participant.threadId },
    include: {
      attachments: true,
    },
    orderBy: [
      { createdAt: "asc" },
      { id: "asc" },
    ],
    take: 150,
  });

  const threadParticipants = await prisma.adminChatParticipant.findMany({
    where: { threadId: participant.threadId },
    select: {
      userId: true,
      staffId: true,
      role: true,
      readAt: true,
      isArchived: true,
    },
  });

  const userMap = await getUserMap(threadParticipants.map((entry) => entry.userId));
  const staffDepartmentMap = await getStaffDepartmentMap(threadParticipants.map((entry) => entry.userId));
  const draft = await prisma.adminChatDraft.findUnique({
    where: {
      threadId_userId: {
        threadId: participant.threadId,
        userId: mailboxUserId,
      },
    },
  });

  if (!canReviewThreadForViewer({
    viewer: args.viewer,
    requestedMailboxUserId: args.mailboxUserId,
    box: participant.thread.box,
    threadParticipants,
    senderUserIds: messages.map((message) => message.senderUserId),
    staffDepartmentMap,
  })) {
    throw new Error("CHAT_THREAD_FORBIDDEN");
  }

  return {
    id: participant.thread.id,
    subject: participant.thread.subject,
    boxSlug: participant.thread.box?.slug || null,
    boxLabel: participant.thread.box?.label || null,
    isDirect: participant.thread.isDirect,
    archived: participant.isArchived,
    participants: threadParticipants.map((entry) => {
      const user = userMap.get(entry.userId);
      return {
        userId: entry.userId,
        role: entry.role,
        name: user?.displayName || user?.fullName || user?.username || user?.email || "Staff",
        email: user?.email || "",
        avatarImage: user?.avatarImage || null,
        avatarTone: user?.avatarTone || null,
        readAt: entry.readAt?.toISOString() || null,
        archived: entry.isArchived,
      };
    }),
    messages: messages.map((message) => {
      const sender = userMap.get(message.senderUserId);
      const senderMeta = message.metaJson && typeof message.metaJson === "object" ? message.metaJson as Record<string, unknown> : null;
      return {
        id: message.id,
        senderUserId: message.senderUserId,
        senderName: safeText(senderMeta?.senderName, 120) || sender?.displayName || sender?.fullName || sender?.username || sender?.email || "Staff",
        senderEmail: safeText(senderMeta?.senderEmail, 180) || sender?.email || "",
        senderAvatarImage: sender?.avatarImage || null,
        senderAvatarTone: sender?.avatarTone || null,
        kind: message.kind,
        body: message.bodyText || message.searchText || "",
        bodyHtml: sanitizeChatHtml(senderMeta?.bodyHtml, 60_000) || null,
        fontFamily: normalizeChatFontFamily(senderMeta?.fontFamily) || null,
        preview: message.previewText || "",
        createdAt: message.createdAt.toISOString(),
        attachments: message.attachments.map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          sizeBytes: Number(attachment.sizeBytes || 0),
        })),
      };
    }),
    draft: {
      body: draft?.body || "",
      attachmentIds: draft?.attachmentIds || [],
      updatedAt: draft?.updatedAt.toISOString() || null,
    },
  };
}

export async function ensureDirectAdminChatThread(args: {
  viewer: Viewer;
  participantUserIds: string[];
  subject?: string | null;
}) {
  const participantUserIds = Array.from(new Set([args.viewer.userId, ...args.participantUserIds.map((value) => safeId(value))].filter(Boolean)));
  if (participantUserIds.length < 2) throw new Error("CHAT_PARTICIPANTS_REQUIRED");

  const directKey = directKeyForUsers(participantUserIds);
  const existing = await prisma.adminChatThread.findUnique({
    where: { directKey },
  });
  if (existing) {
    return existing;
  }

  const viewerStaff = await getStaffProfileByUserId(args.viewer.userId);
  if (!isStaffActive(viewerStaff)) throw new Error("CHAT_STAFF_REQUIRED");
  const activeViewerStaff = viewerStaff;

  const userMap = await getUserMap(participantUserIds);
  const subject = safeText(
    args.subject
      || participantUserIds
        .filter((value) => value !== args.viewer.userId)
        .map((value) => {
          const user = userMap.get(value);
          return user?.displayName || user?.fullName || user?.username || user?.email || "Staff";
        })
        .join(", "),
    180,
  ) || "Direct thread";

  const thread = await prisma.adminChatThread.create({
    data: {
      subject,
      isDirect: true,
      directKey,
      createdByUserId: args.viewer.userId,
      createdByStaffId: activeViewerStaff.id,
    },
  });

  for (const userId of participantUserIds) {
    const staff = await getStaffProfileByUserId(userId);
    if (!isStaffActive(staff)) continue;
    const activeStaff = staff;
    await prisma.adminChatParticipant.create({
      data: {
        threadId: thread.id,
        userId,
        staffId: activeStaff.id,
        role: userId === args.viewer.userId ? "OWNER" : "MEMBER",
      },
    });
  }

  return thread;
}

export async function saveAdminChatDraft(args: {
  viewer: Viewer;
  threadId: string;
  mailboxUserId?: string | null;
  body?: string | null;
  attachmentIds?: string[];
}) {
  const mailboxUserId = await resolveMailboxUserId(args.viewer, args.mailboxUserId);
  const body = safeText(args.body, 12000);
  const attachmentIds = Array.isArray(args.attachmentIds)
    ? args.attachmentIds.map((value) => safeId(value)).filter(Boolean)
    : [];

  if (!body && !attachmentIds.length) {
    await prisma.adminChatDraft.deleteMany({
      where: {
        threadId: safeId(args.threadId),
        userId: mailboxUserId,
      },
    });
    return null;
  }

  return prisma.adminChatDraft.upsert({
    where: {
      threadId_userId: {
        threadId: safeId(args.threadId),
        userId: mailboxUserId,
      },
    },
    update: {
      body,
      attachmentIds,
    },
    create: {
      threadId: safeId(args.threadId),
      userId: mailboxUserId,
      body,
      attachmentIds,
    },
  });
}

export async function markAdminChatThreadRead(args: {
  viewer: Viewer;
  threadId: string;
  mailboxUserId?: string | null;
}) {
  const mailboxUserId = await resolveMailboxUserId(args.viewer, args.mailboxUserId);
  const lastMessage = await prisma.adminChatMessage.findFirst({
    where: { threadId: safeId(args.threadId) },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });

  return prisma.adminChatParticipant.update({
    where: {
      threadId_userId: {
        threadId: safeId(args.threadId),
        userId: mailboxUserId,
      },
    },
    data: {
      readAt: lastMessage?.createdAt || new Date(),
      lastReadMessageId: lastMessage?.id || null,
    },
  });
}

export async function archiveAdminChatThread(args: {
  viewer: Viewer;
  threadId: string;
  archived: boolean;
  mailboxUserId?: string | null;
}) {
  const mailboxUserId = await resolveMailboxUserId(args.viewer, args.mailboxUserId);
  return prisma.adminChatParticipant.update({
    where: {
      threadId_userId: {
        threadId: safeId(args.threadId),
        userId: mailboxUserId,
      },
    },
    data: {
      isArchived: Boolean(args.archived),
    },
  });
}

export async function setAdminChatThreadStarred(args: {
  viewer: Viewer;
  threadId: string;
  starred: boolean;
  mailboxUserId?: string | null;
}) {
  const mailboxUserId = await resolveMailboxUserId(args.viewer, args.mailboxUserId);
  return prisma.adminChatParticipant.update({
    where: {
      threadId_userId: {
        threadId: safeId(args.threadId),
        userId: mailboxUserId,
      },
    },
    data: {
      isMuted: Boolean(args.starred),
    },
  });
}

export async function postAdminChatMessage(args: {
  viewer: Viewer;
  threadId: string;
  body: string;
  bodyHtml?: string | null;
  fontFamily?: string | null;
  attachments?: ChatAttachmentInput[];
}) {
  const threadId = safeId(args.threadId);
  const body = safeText(args.body, 20000);
  const bodyHtml = sanitizeChatHtml(args.bodyHtml, 60_000);
  const fontFamily = normalizeChatFontFamily(args.fontFamily);
  const attachments = Array.isArray(args.attachments) ? args.attachments : [];
  if (!threadId || (!body && !attachments.length)) throw new Error("CHAT_MESSAGE_REQUIRED");
  if (attachments.length && !adminR2Configured()) {
    throw new Error("CHAT_ATTACHMENTS_R2_REQUIRED");
  }

  const viewerStaff = await getStaffProfileByUserId(args.viewer.userId);
  if (!isStaffActive(viewerStaff)) throw new Error("CHAT_STAFF_REQUIRED");
  const activeViewerStaff = viewerStaff;

  const participant = await prisma.adminChatParticipant.findUnique({
    where: {
      threadId_userId: {
        threadId,
        userId: args.viewer.userId,
      },
    },
    include: {
      thread: {
        include: {
          box: true,
        },
      },
    },
  });

  if (!participant?.thread) throw new Error("CHAT_THREAD_NOT_FOUND");
  if (participant.thread.box?.slug) {
    await ensureOrgParticipantsForThread(threadId, participant.thread.box.slug);
  }

  let bodyStorage: "INLINE" | "R2" = "INLINE";
  let bodyR2Key: string | null = null;
  if (adminR2Configured() && body && body.length > 1200) {
    bodyStorage = "R2";
    bodyR2Key = `cavchat/messages/${threadId}/${Date.now()}-${randomBytes(6).toString("hex")}.txt`;
    await putAdminR2Object({
      objectKey: bodyR2Key,
      body: Buffer.from(body, "utf8"),
      contentType: "text/plain; charset=utf-8",
      contentLength: Buffer.byteLength(body, "utf8"),
    });
  }

  const now = new Date();
  const message = await prisma.adminChatMessage.create({
    data: {
      threadId,
      senderUserId: args.viewer.userId,
      senderStaffId: activeViewerStaff.id,
      kind: participant.thread.box?.slug === "broadcasts" ? "BROADCAST" : "MESSAGE",
      bodyStorage,
      bodyText: body || null,
      searchText: body || null,
      previewText: previewText(body),
      bodyR2Key,
      metaJson: bodyHtml || fontFamily
        ? {
            ...(bodyHtml ? { bodyHtml } : {}),
            ...(fontFamily ? { fontFamily } : {}),
          }
        : undefined,
    },
  });

  const createdAttachments = [];
  for (const attachment of attachments) {
    const buffer = attachment.body;
    const objectKey = `cavchat/attachments/${threadId}/${message.id}-${randomBytes(6).toString("hex")}-${safeText(attachment.fileName, 120) || "file"}`;
    if (adminR2Configured()) {
      await putAdminR2Object({
        objectKey,
        body: buffer,
        contentType: attachment.contentType,
        contentLength: buffer.byteLength,
      });
    }
    const created = await prisma.adminChatAttachment.create({
      data: {
        messageId: message.id,
        uploadedByUserId: args.viewer.userId,
        fileName: safeText(attachment.fileName, 191) || "attachment",
        contentType: safeText(attachment.contentType, 120) || "application/octet-stream",
        sizeBytes: BigInt(buffer.byteLength),
        objectKey,
      },
    });
    createdAttachments.push(created);
  }

  await prisma.adminChatThread.update({
    where: { id: threadId },
    data: {
      lastMessageAt: now,
    },
  });

  await prisma.adminChatParticipant.update({
    where: {
      threadId_userId: {
        threadId,
        userId: args.viewer.userId,
      },
    },
    data: {
      readAt: now,
      lastReadMessageId: message.id,
      isArchived: false,
    },
  });

  const recipients = await prisma.adminChatParticipant.findMany({
    where: {
      threadId,
      userId: { not: args.viewer.userId },
    },
    select: {
      userId: true,
    },
  });

  for (const recipient of recipients) {
    await prisma.adminChatParticipant.update({
      where: {
        threadId_userId: {
          threadId,
          userId: recipient.userId,
        },
      },
      data: {
        isArchived: false,
      },
    });
    await createAdminNotification({
      userId: recipient.userId,
      title: participant.thread.subject,
      body: previewText(body),
      href: "/admin-internal/chat",
      kind: "HQ_CHAT_MESSAGE",
      tone: "WATCH",
      meta: {
        threadId,
        messageId: message.id,
        senderUserId: args.viewer.userId,
      },
    });
  }

  await prisma.adminChatDraft.deleteMany({
    where: {
      threadId,
      userId: args.viewer.userId,
    },
  });

  return {
    ...message,
    attachments: createdAttachments,
  };
}

export async function getAdminChatUnreadCount(args: {
  viewer: Viewer;
  mailboxUserId?: string | null;
  includeOrgBoxes?: boolean;
}) {
  const mailboxUserId = await resolveMailboxUserId(args.viewer, args.mailboxUserId);
  await ensureMailboxOrgParticipants(args.viewer, mailboxUserId);

  const participants = await prisma.adminChatParticipant.findMany({
    where: {
      userId: mailboxUserId,
      isArchived: false,
      thread: {
        lastMessageAt: { not: null },
      },
    },
    include: {
      thread: {
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              senderUserId: true,
              previewText: true,
              createdAt: true,
            },
          },
          box: true,
        },
      },
    },
  });

  const includeOrgBoxes = Boolean(args.includeOrgBoxes);
  const visible = participants.filter((participant) => {
    if (!includeOrgBoxes && participant.thread.boxId) return false;
    if (!participant.thread.box) return true;
    return canAccessBox(args.viewer, participant.thread.box);
  });

  const threadIds = visible.map((participant) => participant.threadId);
  const participantMap = await getThreadParticipantsMap(threadIds);
  const userIds = Array.from(new Set([
    mailboxUserId,
    ...Array.from(participantMap.values()).flat().map((participant) => participant.userId),
  ]));
  const staffDepartmentMap = await getStaffDepartmentMap(userIds);

  const unreadItems = visible.filter((participant) => {
    const lastMessage = participant.thread.messages[0];
    if (!lastMessage) return false;
    const threadParticipants = participantMap.get(participant.threadId) || [];
    if (!canReviewThreadForViewer({
      viewer: args.viewer,
      requestedMailboxUserId: args.mailboxUserId,
      box: participant.thread.box,
      threadParticipants,
      senderUserIds: [lastMessage.senderUserId],
      staffDepartmentMap,
    })) {
      return false;
    }
    if (lastMessage.senderUserId === mailboxUserId) return false;
    return !participant.readAt || participant.readAt.getTime() < lastMessage.createdAt.getTime();
  });

  const latest = unreadItems
    .map((participant) => ({
      threadId: participant.threadId,
      subject: participant.thread.subject,
      preview: participant.thread.messages[0]?.previewText || "",
      createdAt: participant.thread.messages[0]?.createdAt.toISOString() || null,
    }))
    .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""))[0] || null;

  return {
    unreadCount: unreadItems.length,
    latest,
  };
}

export async function getAdminBroadcastThread() {
  const seeded = await ensureChatBoxes();
  const broadcasts = seeded.find((item) => item.box.slug === "broadcasts");
  if (!broadcasts) throw new Error("CHAT_BROADCASTS_BOX_MISSING");
  await ensureOrgParticipantsForThread(broadcasts.thread.id, "broadcasts");
  return broadcasts.thread;
}
