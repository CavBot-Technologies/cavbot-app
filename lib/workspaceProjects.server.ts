import "server-only";

import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { isPermissionDeniedError, isSchemaMismatchError } from "@/lib/dbSchemaGuard";
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

const WORKSPACE_BOOTSTRAP_SCHEMA_HINTS: {
  tables: string[];
  columns: string[];
  fields: string[];
} = {
  tables: ["Project", "Site", "SiteAllowedOrigin", "ProjectNotice"],
  columns: [
    "accountId",
    "isActive",
    "topSiteId",
    "retentionDays",
    "region",
    "serverKeyHash",
    "serverKeyLast4",
  ],
  fields: ["project", "site", "siteAllowedOrigin", "projectNotice"],
};

const WORKSPACE_BOOTSTRAP_ACCESS_HINTS = ["Project", "Site", "SiteAllowedOrigin", "ProjectNotice"];

export type WorkspaceBootstrapErrorCode =
  | "DB_SCHEMA_OUT_OF_DATE"
  | "DB_PERMISSION_DENIED"
  | "WORKSPACE_BOOTSTRAP_FAILED";

export function classifyWorkspaceBootstrapError(error: unknown): {
  error: WorkspaceBootstrapErrorCode;
  status: number;
  retryable: boolean;
} {
  if (isPermissionDeniedError(error, WORKSPACE_BOOTSTRAP_ACCESS_HINTS)) {
    return { error: "DB_PERMISSION_DENIED", status: 503, retryable: false };
  }

  if (isSchemaMismatchError(error, WORKSPACE_BOOTSTRAP_SCHEMA_HINTS)) {
    return { error: "DB_SCHEMA_OUT_OF_DATE", status: 409, retryable: false };
  }

  return { error: "WORKSPACE_BOOTSTRAP_FAILED", status: 503, retryable: true };
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

export async function findAccountWorkspaceProject<T extends Prisma.ProjectSelect>(args: {
  accountId: string;
  projectId: number | null | undefined;
  select: T;
  includeInactive?: boolean;
}) {
  if (!args.projectId) return null;

  return prisma.project.findFirst({
    where: {
      id: args.projectId,
      accountId: args.accountId,
      ...(args.includeInactive ? {} : { isActive: true }),
    },
    select: args.select,
  }) as Promise<Prisma.ProjectGetPayload<{ select: T }> | null>;
}

export async function resolveAccountWorkspaceProject<T extends Prisma.ProjectSelect>(args: {
  accountId: string;
  select: T;
  requestedProjectId?: number | null;
  fallbackProjectId?: number | null;
  includeInactive?: boolean;
  ensureActive?: boolean;
}) {
  const candidateIds = Array.from(
    new Set(
      [args.requestedProjectId, args.fallbackProjectId].filter(
        (value): value is number => Number.isInteger(value) && Number(value) > 0
      )
    )
  );

  for (const projectId of candidateIds) {
    const ownedProject = await findAccountWorkspaceProject({
      accountId: args.accountId,
      projectId,
      select: args.select,
      includeInactive: args.includeInactive,
    });
    if (ownedProject) return ownedProject;
  }

  const firstProject = (await prisma.project.findFirst({
    where: {
      accountId: args.accountId,
      ...(args.includeInactive ? {} : { isActive: true }),
    },
    orderBy: { createdAt: "asc" },
    select: args.select,
  })) as Prisma.ProjectGetPayload<{ select: T }> | null;

  if (firstProject) return firstProject;
  if (args.ensureActive === false) return null;

  const ensured = await ensureActiveWorkspaceProject(args.accountId);
  return findAccountWorkspaceProject({
    accountId: args.accountId,
    projectId: ensured.id,
    select: args.select,
    includeInactive: args.includeInactive,
  });
}
