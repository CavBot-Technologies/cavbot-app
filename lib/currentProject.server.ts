// lib/currentProject.server.ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { createProjectKeyMaterial } from "@/lib/projectKeyMaterial.server";

function env(name: string) {
  return (process.env[name] || "").trim();
}

/**
 * Multi-tenant:
 * - Pass accountId to scope correctly.
 * - Optional projectId/projectSlug to select the active project within tenant.
 *
 * Legacy fallback:
 * - If no opts/accountId, uses your prior "system account bootstrap" behavior.
 */
export async function getCurrentProject(opts?: {
  accountId?: string;
  projectId?: number;
  projectSlug?: string;
}) {
  // ==========================
  // MULTI-TENANT MODE (preferred)
  // ==========================
  if (opts?.accountId) {
    const accountId = opts.accountId;
    const projectId = opts.projectId;
    const projectSlug = (opts.projectSlug || "").trim();

    type ProjectSummary = {
      id: number;
      accountId: string;
      name: string;
      slug: string;
      serverKeyLast4: string;
      isActive: boolean;
    };

    type ProjectRow = Omit<ProjectSummary, "name"> & { name: string | null };

    const normalizeProject = (p: ProjectRow): ProjectSummary => ({
      ...p,
      name: p.name ?? "Project",
    });

    let project: ProjectRow | null = null;

    if (projectId != null) {
      project = await prisma.project.findFirst({
        where: { id: projectId, accountId, isActive: true },
        select: {
          id: true,
          accountId: true,
          name: true,
          slug: true,
          serverKeyLast4: true,
          isActive: true,
        },
      });
      if (!project) throw new Error("Project not found");
      return normalizeProject(project);
    }

    if (projectSlug) {
      project = await prisma.project.findFirst({
        where: { slug: projectSlug, accountId, isActive: true },
        select: {
          id: true,
          accountId: true,
          name: true,
          slug: true,
          serverKeyLast4: true,
          isActive: true,
        },
      });
      if (!project) throw new Error("Project not found");
      return normalizeProject(project);
    }

    // Default: first active project for this tenant
    project = await prisma.project.findFirst({
      where: { accountId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        accountId: true,
        name: true,
        slug: true,
        serverKeyLast4: true,
        isActive: true,
      },
    });

    // If none exist, provision a default project (safe, no raw key returned)
    if (!project) {
      const { serverKeyHash, serverKeyLast4, serverKeyEnc, serverKeyEncIv } =
        await createProjectKeyMaterial();

      const created = await prisma.project.create({
        data: {
          accountId,
          name: "Primary Project",
          slug: "primary",
          serverKeyHash,
          serverKeyLast4,
          serverKeyEnc,
          serverKeyEncIv,
          isActive: true,
        },
        select: {
          id: true,
          accountId: true,
          name: true,
          slug: true,
          serverKeyLast4: true,
          isActive: true,
        },
      });

      return normalizeProject(created);
    }

    return normalizeProject(project);
  }

  // ==========================
  // LEGACY SYSTEM BOOTSTRAP MODE (backward compatible)
  // ==========================
  // Treat as server secret (sk_) going forward
  const rawSecret = env("CAVBOT_SECRET_KEY") || env("CAVBOT_PROJECT_KEY");

  if (!rawSecret) {
    throw new Error("Missing env: CAVBOT_PROJECT_KEY (server secret key) or CAVBOT_SECRET_KEY");
  }

  const { serverKeyHash, serverKeyLast4, serverKeyEnc, serverKeyEncIv } =
    await createProjectKeyMaterial(rawSecret);

  // “System account” bootstrap (single-project mode)
  const accountSlug = env("CAVBOT_SYSTEM_ACCOUNT_SLUG") || "cavbot";
  const accountName = env("CAVBOT_SYSTEM_ACCOUNT_NAME") || "CavBot";

  const projectSlug = env("CAVBOT_DEFAULT_PROJECT_SLUG") || "default";
  const projectName = env("CAVBOT_DEFAULT_PROJECT_NAME") || "CavBot";

  const account = await prisma.account.upsert({
    where: { slug: accountSlug },
    update: { name: accountName },
    create: { slug: accountSlug, name: accountName },
    select: { id: true, slug: true, name: true, tier: true },
  });

  // Upsert project by unique serverKeyHash
  const project = await prisma.project.upsert({
    where: { serverKeyHash },
    update: {
      serverKeyLast4,
      serverKeyEnc,
      serverKeyEncIv,
      isActive: true,
      name: projectName,
      slug: projectSlug,
      accountId: account.id,
    },
    create: {
      accountId: account.id,
      name: projectName,
      slug: projectSlug,
      serverKeyHash,
      serverKeyLast4,
      serverKeyEnc,
      serverKeyEncIv,
      isActive: true,
    },
    select: {
      id: true,
      accountId: true,
      name: true,
      slug: true,
      serverKeyLast4: true,
      isActive: true,
    },
  });

  return { ...project, name: project.name ?? projectName };
}
