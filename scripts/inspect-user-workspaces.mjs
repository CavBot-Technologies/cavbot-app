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

const { prisma } = await import("../lib/prisma.ts");

const emails = process.argv.slice(2);

const rows = await prisma.user.findMany({
  where: emails.length ? { email: { in: emails } } : undefined,
  select: {
    email: true,
    username: true,
    displayName: true,
    fullName: true,
    memberships: {
      where: { role: "OWNER" },
      select: {
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

console.log(JSON.stringify(rows, null, 2));

await prisma.$disconnect();
