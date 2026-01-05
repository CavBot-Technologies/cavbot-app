// src/lib/site.ts
import { prisma } from "@/lib/prisma";

/**
 * Multi-tenant safe:
 * - If accountId is provided, ensures the project belongs to that account
 *   via relation scope: site -> project -> accountId.
 */
export async function getSites(projectId: number, accountId?: string) {
  return prisma.site.findMany({
    where: accountId
      ? { projectId, isActive: true, project: { accountId } }
      : { projectId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}