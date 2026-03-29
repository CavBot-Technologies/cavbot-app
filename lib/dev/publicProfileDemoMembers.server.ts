import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizeUsername } from "@/lib/username";

type DemoMember = {
  username: string;
  email: string;
  displayName: string;
  avatarTone: string;
  role: "ADMIN" | "MEMBER";
};

const DEMO_PUBLIC_PROFILE_MEMBERS: readonly DemoMember[] = [ // MUST DELETE
  { username: "orbit_ava", email: "orbit.ava.demo@cavbot.local", displayName: "Ava Orbit", avatarTone: "lime", role: "ADMIN" }, // MUST DELETE
  { username: "vector_ryan", email: "vector.ryan.demo@cavbot.local", displayName: "Ryan Vector", avatarTone: "blue", role: "ADMIN" }, // MUST DELETE
  { username: "nova_jules", email: "nova.jules.demo@cavbot.local", displayName: "Jules Nova", avatarTone: "violet", role: "ADMIN" }, // MUST DELETE
  { username: "atlas_mina", email: "atlas.mina.demo@cavbot.local", displayName: "Mina Atlas", avatarTone: "white", role: "MEMBER" }, // MUST DELETE
  { username: "echo_soren", email: "echo.soren.demo@cavbot.local", displayName: "Soren Echo", avatarTone: "navy", role: "MEMBER" }, // MUST DELETE
  { username: "pulse_ivy", email: "pulse.ivy.demo@cavbot.local", displayName: "Ivy Pulse", avatarTone: "lime", role: "MEMBER" }, // MUST DELETE
  { username: "spark_theo", email: "spark.theo.demo@cavbot.local", displayName: "Theo Spark", avatarTone: "blue", role: "MEMBER" }, // MUST DELETE
  { username: "zenith_kai", email: "zenith.kai.demo@cavbot.local", displayName: "Kai Zenith", avatarTone: "violet", role: "MEMBER" }, // MUST DELETE
  { username: "lumen_rhea", email: "lumen.rhea.demo@cavbot.local", displayName: "Rhea Lumen", avatarTone: "white", role: "MEMBER" }, // MUST DELETE
  { username: "delta_noah", email: "delta.noah.demo@cavbot.local", displayName: "Noah Delta", avatarTone: "navy", role: "MEMBER" }, // MUST DELETE
  { username: "quark_zoe", email: "quark.zoe.demo@cavbot.local", displayName: "Zoe Quark", avatarTone: "lime", role: "MEMBER" }, // MUST DELETE
  { username: "halo_marc", email: "halo.marc.demo@cavbot.local", displayName: "Marc Halo", avatarTone: "blue", role: "MEMBER" }, // MUST DELETE
]; // MUST DELETE

function s(value: unknown): string {
  return String(value ?? "").trim();
}

export async function seedPublicProfileDemoMembers(args: {
  accountId: string;
}): Promise<{ membershipIds: string[]; userIds: string[] }> {
  const accountId = s(args.accountId);
  if (!accountId) return { membershipIds: [], userIds: [] };
  if (process.env.NODE_ENV === "production") return { membershipIds: [], userIds: [] };

  const membershipIds: string[] = [];
  const userIds: string[] = [];

  for (const row of DEMO_PUBLIC_PROFILE_MEMBERS) {
    const email = s(row.email).toLowerCase();
    const username = normalizeUsername(row.username);
    const displayName = s(row.displayName) || username || "Demo Member";
    const avatarTone = s(row.avatarTone) || "lime";
    if (!email || !username) continue;

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        username,
        displayName,
        avatarTone,
      },
      create: {
        email,
        username,
        displayName,
        avatarTone,
      },
      select: { id: true },
    }).catch(() => null);
    if (!user?.id) continue;
    userIds.push(user.id);

    const membership = await prisma.membership.upsert({
      where: {
        accountId_userId: {
          accountId,
          userId: user.id,
        },
      },
      update: {
        role: row.role,
      },
      create: {
        accountId,
        userId: user.id,
        role: row.role,
      },
      select: {
        id: true,
      },
    }).catch(() => null);

    if (membership?.id) membershipIds.push(membership.id);
  }

  return {
    membershipIds,
    userIds,
  };
}
