import "server-only";
import { prisma } from "@/lib/prisma";

export async function resolveProjectForAccount(opts: {
  accountId: string;
  projectId?: number;
  projectSlug?: string;
}) {
  const { accountId, projectId, projectSlug } = opts;

  const project = projectId
    ? await prisma.project.findFirst({
        where: { id: projectId, accountId, isActive: true },
        select: { id: true, slug: true, name: true, serverKeyEnc: true, serverKeyEncIv: true },
      })
    : projectSlug
    ? await prisma.project.findFirst({
        where: { slug: projectSlug, accountId, isActive: true },
        select: { id: true, slug: true, name: true, serverKeyEnc: true, serverKeyEncIv: true },
      })
    : await prisma.project.findFirst({
        where: { accountId, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, slug: true, name: true, serverKeyEnc: true, serverKeyEncIv: true },
      });

  if (!project) throw new Error("PROJECT_NOT_FOUND");
  if (!project.serverKeyEnc || !project.serverKeyEncIv) throw new Error("PROJECT_KEY_MISSING");

  return project;
}