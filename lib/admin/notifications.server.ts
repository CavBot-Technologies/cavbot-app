import "server-only";

import type { NoticeTone, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

function safeId(value: unknown) {
  return String(value || "").trim();
}

function safeText(value: unknown, max: number) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  return normalized.slice(0, Math.max(1, max));
}

export async function createAdminNotification(args: {
  userId: string;
  accountId?: string | null;
  title: string;
  body?: string | null;
  href?: string | null;
  kind: string;
  tone?: NoticeTone;
  meta?: Prisma.JsonObject | null;
}) {
  const userId = safeId(args.userId);
  const title = safeText(args.title, 160);
  if (!userId || !title) return null;

  return prisma.notification.create({
    data: {
      userId,
      accountId: safeId(args.accountId) || null,
      title,
      body: safeText(args.body, 600) || null,
      href: safeId(args.href) || null,
      kind: safeText(args.kind, 64) || "GENERIC",
      tone: args.tone || "GOOD",
      metaJson: args.meta || undefined,
    },
    select: {
      id: true,
      userId: true,
    },
  });
}

export async function createManyAdminNotifications(
  rows: Array<{
    userId: string;
    accountId?: string | null;
    title: string;
    body?: string | null;
    href?: string | null;
    kind: string;
    tone?: NoticeTone;
    meta?: Prisma.JsonObject | null;
  }>,
) {
  const data = rows
    .map((row) => ({
      userId: safeId(row.userId),
      accountId: safeId(row.accountId) || null,
      title: safeText(row.title, 160),
      body: safeText(row.body, 600) || null,
      href: safeId(row.href) || null,
      kind: safeText(row.kind, 64) || "GENERIC",
      tone: row.tone || "GOOD",
      metaJson: row.meta || undefined,
    }))
    .filter((row) => row.userId && row.title);

  if (!data.length) return 0;
  const result = await prisma.notification.createMany({
    data,
  });
  return result.count;
}
