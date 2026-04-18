import "server-only";

import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

const DEFAULT_PROJECT_NAME = "Primary Project";
const DEFAULT_PROJECT_SLUG = "primary";

const PROJECT_SELECT = {
  id: true,
  accountId: true,
  name: true,
  slug: true,
  serverKeyLast4: true,
  isActive: true,
} as const;

function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function last4(input: string) {
  const value = String(input || "").trim();
  return value.length >= 4 ? value.slice(-4) : value;
}

async function findFirstActiveWorkspaceProject(accountId: string) {
  return prisma.project.findFirst({
    where: { accountId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: PROJECT_SELECT,
  });
}

async function makeUniqueDefaultProjectSlug(accountId: string) {
  for (let i = 1; i <= 25; i += 1) {
    const candidate = i === 1 ? DEFAULT_PROJECT_SLUG : `${DEFAULT_PROJECT_SLUG}-${i}`;
    const hit = await prisma.project.findFirst({
      where: { accountId, slug: candidate },
      select: { id: true },
    });
    if (!hit) return candidate;
  }

  return `${DEFAULT_PROJECT_SLUG}-${randomBytes(2).toString("hex")}`;
}

export async function ensureActiveWorkspaceProject(accountId: string) {
  const existing = await findFirstActiveWorkspaceProject(accountId);
  if (existing) return existing;

  const serverKeyRaw = `cavbot_sk_${randomBytes(24).toString("hex")}`;
  const slug = await makeUniqueDefaultProjectSlug(accountId);

  try {
    return await prisma.project.create({
      data: {
        accountId,
        name: DEFAULT_PROJECT_NAME,
        slug,
        serverKeyHash: sha256Hex(serverKeyRaw),
        serverKeyLast4: last4(serverKeyRaw),
        isActive: true,
      },
      select: PROJECT_SELECT,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const retry = await findFirstActiveWorkspaceProject(accountId);
      if (retry) return retry;
    }
    throw error;
  }
}
