// lib/currentProject.server.ts
import "server-only";
import { prisma } from "@/lib/prisma";

function env(name: string) {
  return (process.env[name] || "").trim();
}

function last4(s: string) {
  const x = (s || "").trim();
  return x.length >= 4 ? x.slice(-4) : x;
}

function bytesToHex(bytes: Uint8Array) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hash));
}

function randomToken(bytes = 24) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToHex(b);
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

    let project = null as any;

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
      return project;
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
      return project;
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
      const serverKeyRaw = `cavbot_sk_${randomToken(24)}`;
      const serverKeyHash = await sha256Hex(serverKeyRaw);
      const serverKeyLast4 = last4(serverKeyRaw);

      const created = await prisma.project.create({
        data: {
          accountId,
          name: "Primary Project",
          slug: "primary",
          serverKeyHash,
          serverKeyLast4,
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

      return created;
    }

    return project;
  }

  // ==========================
  // LEGACY SYSTEM BOOTSTRAP MODE (backward compatible)
  // ==========================
  // Treat as server secret (sk_) going forward
  const rawSecret = env("CAVBOT_SECRET_KEY") || env("CAVBOT_PROJECT_KEY");

  if (!rawSecret) {
    throw new Error("Missing env: CAVBOT_PROJECT_KEY (server secret key) or CAVBOT_SECRET_KEY");
  }

  const serverKeyHash = await sha256Hex(rawSecret);
  const serverKeyLast4 = last4(rawSecret);

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

  return project;
}