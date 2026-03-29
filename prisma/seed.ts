// prisma/seed.ts
import { config as loadEnv } from "dotenv";
import { PrismaClient, PlanTier, MemberRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import crypto from "crypto";
import { normalizeUsername } from "../lib/username";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const PBKDF2_ITERATIONS = 310_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256" as const;

function pbkdf2Base64(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return { saltB64: salt.toString("base64"), hashB64: hash.toString("base64") };
}

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

type StringEnumRecord = Record<string, string>;

function pickEnumValue<T extends StringEnumRecord>(enumObj: T, preferred: string[]): T[keyof T] | null {
  for (const key of preferred) {
    if (key in enumObj) {
      return enumObj[key as keyof T];
    }
  }
  const vals = Object.values(enumObj).filter((value): value is T[keyof T] => typeof value === "string");
  return vals[0] ?? null;
}

async function upsertUserAuth(prisma: PrismaClient, userId: string, saltB64: string, hashB64: string) {
  const base = { passwordSalt: saltB64, passwordHash: hashB64 };

  // Some schemas have passwordIters; some don’t. Try with, then fallback.
  const withIters = { ...base, passwordIters: PBKDF2_ITERATIONS };

  try {
    return await prisma.userAuth.upsert({
      where: { userId },
      update: withIters,
      create: { userId, ...withIters },
      select: { userId: true },
    });
  } catch (error) {
    const msg = (() => {
      if (error instanceof Error) return error.message;
      return String(error);
    })();
    if (msg.includes("passwordIters") || msg.includes("Unknown arg")) {
      return await prisma.userAuth.upsert({
        where: { userId },
        update: base,
        create: { userId, ...base },
        select: { userId: true },
      });
    }
    throw error;
  }
}

function makeSeedClient() {
  const url = String(process.env.DIRECT_URL || process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("DIRECT_URL/DATABASE_URL is missing for seed.");

  const pool = new pg.Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter, log: ["error", "warn"] });

  return { prisma, pool };
}

async function main() {
  const { prisma, pool } = makeSeedClient();

  try {
    const email = String(process.env.CAVBOT_CONSOLE_EMAIL || process.env.CAVBOT_OWNER_EMAIL || "")
      .trim()
      .toLowerCase();

    const password = String(process.env.CAVBOT_CONSOLE_PASSWORD || process.env.CAVBOT_OWNER_PASSWORD || "").trim();

    if (!email || !password) throw new Error("Missing console email/password env vars.");

    // 1) User
    const ownerUsername = String(process.env.CAVBOT_OWNER_USERNAME || "").trim();
    const normalizedOwnerUsername = ownerUsername ? normalizeUsername(ownerUsername) : "";

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        ...(normalizedOwnerUsername ? { username: normalizedOwnerUsername } : {}),
      },
      select: { id: true, email: true },
    });

    if (normalizedOwnerUsername) {
      await prisma.user.update({
        where: { id: user.id },
        data: { username: normalizedOwnerUsername },
      });
    }

    // 2) Auth (fresh salt each run)
    const { saltB64, hashB64 } = pbkdf2Base64(password);
    await upsertUserAuth(prisma, user.id, saltB64, hashB64);

    // 3) Default Account (Workspace) + Membership
    const tier =
      pickEnumValue(PlanTier, ["FREE", "STARTER", "BASIC"]) ??
      pickEnumValue(PlanTier, []) ??
      PlanTier.FREE;

    const role =
      pickEnumValue(MemberRole, ["OWNER", "ADMIN"]) ??
      pickEnumValue(MemberRole, []) ??
      MemberRole.OWNER;

    const DEFAULT_ACCOUNT_SLUG = "Cavbot";
    const DEFAULT_ACCOUNT_NAME = "Cavbot Admin";

    const account =
      (await prisma.account.findUnique({
        where: { slug: DEFAULT_ACCOUNT_SLUG },
        select: { id: true, slug: true },
      })) ||
      (await prisma.account.create({
        data: { slug: DEFAULT_ACCOUNT_SLUG, name: DEFAULT_ACCOUNT_NAME, tier },
        select: { id: true, slug: true },
      }));

    const membership = await prisma.membership.findFirst({
      where: { accountId: account.id, userId: user.id },
      select: { id: true },
    });

    if (!membership) {
      await prisma.membership.create({
        data: { accountId: account.id, userId: user.id, role },
        select: { id: true },
      });
    }

   // ---------- DEFAULT PROJECT (so you can add sites immediately) ----------
const DEFAULT_PROJECT_SLUG = "default";
const DEFAULT_PROJECT_NAME = "Default Project";

let project = await prisma.project.findFirst({
  where: { accountId: account.id, slug: DEFAULT_PROJECT_SLUG },
  select: { id: true, slug: true },
});

if (!project) {
  // generate a dev server key and store ONLY its hash + last4 in DB
  const serverKeyPlain = `dev_${crypto.randomBytes(32).toString("base64url")}`;
  const serverKeyHash = sha256Hex(serverKeyPlain);
  const serverKeyLast4 = serverKeyPlain.slice(-4);

  project = await prisma.project.create({
    data: {
      accountId: account.id,
      name: DEFAULT_PROJECT_NAME,
      slug: DEFAULT_PROJECT_SLUG,
      serverKeyHash,
      serverKeyLast4, // REQUIRED by your schema
    },
    select: { id: true, slug: true },
  });
} else {
  // optional: if you ever had an older row missing last4 (shouldn’t happen if field is required)
  // you can leave this empty
}

    console.log("Seed complete");
    console.log("User:", user.email);
    console.log("Account:", account.slug);
    console.log("Project:", project!.slug);
  } finally {
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
