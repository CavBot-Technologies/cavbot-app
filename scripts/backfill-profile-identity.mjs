import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const cwd = process.cwd();
for (const file of [".env.local", ".env"]) {
  const fullPath = path.join(cwd, file);
  if (!fs.existsSync(fullPath)) continue;
  const parsed = dotenv.parse(fs.readFileSync(fullPath));
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) process.env[key] = value;
  }
}

const [
  { prisma },
  {
    buildAutoWorkspaceSlugCandidates,
    buildPersonalWorkspaceName,
    buildPreferredPersonalWorkspaceSlug,
  },
] = await Promise.all([
  import("../lib/prisma.ts"),
  import("../lib/profileIdentity.ts"),
]);

function buildAutoWorkspaceNameCandidates(input) {
  const values = new Set();
  const emailLocal = String(input.email ?? "")
    .trim()
    .toLowerCase()
    .split("@")[0]
    ?.trim();

  const push = (value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) return;
    values.add(buildPersonalWorkspaceName(normalized));
  };

  push(input.displayName);
  push(input.fullName);
  push(input.username);
  push(emailLocal);
  return values;
}

async function findAvailablePersonalAccountSlug(requested, excludeAccountIds = []) {
  let slug = requested;

  for (let i = 0; i < 10; i++) {
    const exists = await prisma.account.findFirst({
      where: {
        slug,
        ...(excludeAccountIds.length ? { id: { notIn: excludeAccountIds } } : {}),
      },
      select: { id: true },
    });
    if (!exists) return slug;
    slug = `${requested}-${Math.random().toString(16).slice(2, 8)}`;
  }

  return `${requested}-${Math.random().toString(16).slice(2, 10)}`;
}

const users = await prisma.user.findMany({
  where: {
    OR: [{ fullName: { not: null } }, { displayName: { not: null } }, { username: { not: null } }],
  },
  select: {
    id: true,
    email: true,
    username: true,
    displayName: true,
    fullName: true,
    memberships: {
      where: { role: "OWNER" },
      select: {
        accountId: true,
            account: {
              select: {
                id: true,
                name: true,
                slug: true,
                _count: { select: { members: true } },
              },
            },
          },
    },
  },
});

let updatedUsers = 0;
let updatedAccounts = 0;
let updatedSlugs = 0;

for (const user of users) {
  const fullName = String(user.fullName || "").trim();
  const effectiveName = fullName || String(user.displayName || "").trim();
  if (!effectiveName && !String(user.username || "").trim()) continue;

  if (fullName && String(user.displayName || "").trim() !== fullName) {
    await prisma.user.update({
      where: { id: user.id },
      data: { displayName: fullName },
    });
    updatedUsers += 1;
  }

  const oldWorkspaceNames = buildAutoWorkspaceNameCandidates(user);
  const nextWorkspaceName = buildPersonalWorkspaceName(effectiveName);

  const renameableAccountIds = user.memberships
    .filter((membership) => {
      const accountName = String(membership.account.name || "").trim();
      return accountName && oldWorkspaceNames.has(accountName) && membership.account._count.members <= 1;
    })
    .map((membership) => membership.account.id);

  if (renameableAccountIds.length > 0) {
    const result = await prisma.account.updateMany({
      where: { id: { in: renameableAccountIds } },
      data: { name: nextWorkspaceName },
    });
    updatedAccounts += result.count;
  }

  const oldWorkspaceSlugs = buildAutoWorkspaceSlugCandidates(user);
  const desiredSlug = buildPreferredPersonalWorkspaceSlug(user);

  for (const membership of user.memberships) {
    const currentSlug = String(membership.account.slug || "").trim().toLowerCase();
    if (!currentSlug) continue;
    if (!oldWorkspaceSlugs.has(currentSlug)) continue;
    if (membership.account._count.members > 1) continue;
    if (currentSlug === desiredSlug) continue;

    const nextSlug = await findAvailablePersonalAccountSlug(desiredSlug, [membership.account.id]);
    await prisma.account.update({
      where: { id: membership.account.id },
      data: { slug: nextSlug },
    });
    updatedSlugs += 1;
  }
}

console.log(JSON.stringify({ updatedUsers, updatedAccounts, updatedSlugs }, null, 2));

await prisma.$disconnect();
