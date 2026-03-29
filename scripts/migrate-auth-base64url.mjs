import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pgPkg from "pg";

const { Pool } = pgPkg;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is missing");

const pool = new Pool({ connectionString: url });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });


function looksClassicBase64(s) {
  // classic base64 typically has + / or = padding
  return /[+/=]/.test(String(s || ""));
}

function toBase64urlFromBase64(s) {
  // works even if padding is missing
  return Buffer.from(String(s), "base64").toString("base64url");
}

async function main() {
  const rows = await prisma.userAuth.findMany({
    select: { userId: true, passwordSalt: true, passwordHash: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const r of rows) {
    const salt = String(r.passwordSalt || "").trim();
    const hash = String(r.passwordHash || "").trim();

    if (!salt || !hash) {
      skipped++;
      continue;
    }

    // If either field looks like classic base64, convert BOTH to base64url
    if (looksClassicBase64(salt) || looksClassicBase64(hash)) {
      const nextSalt = toBase64urlFromBase64(salt);
      const nextHash = toBase64urlFromBase64(hash);

      // sanity: PBKDF2 salt should be 16 bytes, hash typically 32 bytes (but don’t hard fail)
      const saltLen = Buffer.from(nextSalt, "base64url").length;
      const hashLen = Buffer.from(nextHash, "base64url").length;

      if (saltLen === 0 || hashLen === 0) {
        console.log("SKIP (decode failed):", r.userId);
        skipped++;
        continue;
      }

      await prisma.userAuth.update({
        where: { userId: r.userId },
        data: { passwordSalt: nextSalt, passwordHash: nextHash },
      });

      updated++;
    } else {
      skipped++;
    }
  }

  console.log(` Migration complete. Updated ${updated}, skipped ${skipped}.`);
}

main()
  .catch((e) => {
    console.error("MIGRATION_FAILED:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });