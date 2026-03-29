import { prisma } from "@/lib/prisma";
export { getCurrentProject } from "@/lib/currentProject.server";

/**
 * Multi-tenant safe:
 * - If accountId is provided, project must belong to that account.
 * - Only returns active projects.
 * - Keeps return shape with `keyLast4` even though DB field is `serverKeyLast4`.
 */
export async function getProjectById(projectId: number, accountId?: string) {
  const project = await prisma.project.findFirst({
    where: accountId
      ? { id: projectId, accountId, isActive: true }
      : { id: projectId, isActive: true },
    select: { id: true, name: true, serverKeyLast4: true },
  });

  if (!project) return null;

  // Preserve your existing API contract: { keyLast4 }
  return {
    id: project.id,
    name: project.name,
    keyLast4: project.serverKeyLast4,
  };
}