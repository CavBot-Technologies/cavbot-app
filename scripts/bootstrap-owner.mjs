// scripts/bootstrap-owner.mjs
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pgPkg from "pg";
import { createHash, randomBytes, pbkdf2Sync } from "crypto";

const { Pool } = pgPkg;

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is missing");

const pool = new Pool({ connectionString: url });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function base64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

function hashPasswordBase64url(password, iters = 210_000) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, iters, 32, "sha256");
  return {
    algo: "pbkdf2_sha256",
    iters,
    salt: base64urlEncode(salt),
    hash: base64urlEncode(hash),
  };
}

function requireEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`${name} is missing`);
  return v;
}

function normalizeStaffCode(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  return `CAV-${digits.padStart(6, "0").slice(-6)}`;
}

function isRetiredStaffCode(value) {
  return normalizeStaffCode(value) === "CAV-000001";
}

function parseStaffCodeNumber(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return 0;
  return Math.max(0, Number.parseInt(digits, 10) || 0);
}

async function main() {
  const email = requireEnv("CAVBOT_OWNER_EMAIL").toLowerCase();
  const password = requireEnv("CAVBOT_OWNER_PASSWORD");
  const iters = Number(process.env.CAVBOT_PBKDF2_ITERS || 210_000);
  const ownerStaffCode = normalizeStaffCode(process.env.CAVBOT_ADMIN_STAFF_CODE || "");
  if (!ownerStaffCode || isRetiredStaffCode(ownerStaffCode)) {
    throw new Error("CAVBOT_ADMIN_STAFF_CODE must be set to a non-retired staff code.");
  }
  const ownerStaffFloor = parseStaffCodeNumber(ownerStaffCode) || 1;
  const ownerPositionTitle = String(process.env.ADMIN_OWNER_POSITION_TITLE || process.env.CAVBOT_OWNER_POSITION_TITLE || "Founder & CEO").trim() || "Founder & CEO";

  // 1) User
  let user = await prisma.user.findUnique({
    where: { email },
    include: { auth: true, memberships: true },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        displayName: "CavBot Owner",
        lastLoginAt: new Date(),
        emailVerifiedAt: new Date(),
      },
      include: { auth: true, memberships: true },
    });
  } else {
    // ensure verified
    if (!user.emailVerifiedAt) {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }
  }

  // 2) UserAuth (reset to env value)
  const pass = hashPasswordBase64url(password, iters);

  if (!user.auth) {
    await prisma.userAuth.create({
      data: {
        userId: user.id,
        passwordAlgo: pass.algo,
        passwordIters: pass.iters,
        passwordSalt: pass.salt,
        passwordHash: pass.hash,
      },
    });
  } else {
    await prisma.userAuth.update({
      where: { userId: user.id },
      data: {
        passwordAlgo: pass.algo,
        passwordIters: pass.iters,
        passwordSalt: pass.salt,
        passwordHash: pass.hash,
      },
    });
  }

  // 3) Account + Membership (OWNER)
  let membership = user.memberships?.[0] || null;
  let accountId = membership?.accountId || null;

  if (!accountId) {
    const slug = "cavbot-owner";
    const account = await prisma.account.create({
      data: {
        name: "CavBot Owner Account",
        slug,
        tier: "PREMIUM",
        trialSeatActive: false,
        trialEverUsed: false,
        trialStartedAt: null,
        trialEndsAt: null,
      },
    });

    await prisma.membership.create({
      data: { accountId: account.id, userId: user.id, role: "OWNER" },
    });

    accountId = account.id;
  } else {
    // Force PREMIUM for your owner tenant (forever)
    await prisma.account.update({
      where: { id: accountId },
      data: {
        tier: "PREMIUM",
        trialSeatActive: false,
      },
    });
  }

  const existingStaffSequence = await prisma.staffSequence.findUnique({
    where: { key: "staff" },
    select: { lastValue: true },
  });
  if (!existingStaffSequence) {
    await prisma.staffSequence.create({
      data: {
        key: "staff",
        lastValue: ownerStaffFloor,
      },
    });
  } else if (existingStaffSequence.lastValue < ownerStaffFloor) {
    await prisma.staffSequence.update({
      where: { key: "staff" },
      data: {
        lastValue: ownerStaffFloor,
      },
    });
  }

  await prisma.staffProfile.upsert({
    where: { userId: user.id },
    update: {
      staffCode: ownerStaffCode,
      systemRole: "OWNER",
      positionTitle: ownerPositionTitle,
      status: "ACTIVE",
      onboardingStatus: "COMPLETED",
      invitedEmail: user.email,
      invitedByUserId: user.id,
      createdByUserId: user.id,
      metadataJson: {
        founder: true,
        immutableFounderId: true,
      },
    },
    create: {
      userId: user.id,
      staffCode: ownerStaffCode,
      systemRole: "OWNER",
      positionTitle: ownerPositionTitle,
      status: "ACTIVE",
      onboardingStatus: "COMPLETED",
      invitedEmail: user.email,
      invitedByUserId: user.id,
      createdByUserId: user.id,
      metadataJson: {
        founder: true,
        immutableFounderId: true,
      },
    },
  });

  // 4) Subscription record (optional, but nice for consistency)
  // Keep one ACTIVE premium subscription row (no provider required yet).
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  await prisma.subscription
    .create({
      data: {
        accountId,
        status: "ACTIVE",
        tier: "PREMIUM",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    })
    .catch(() => {});

  // 5) Ensure at least 1 Project
  let project = await prisma.project.findFirst({
    where: { accountId, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  let serverKeyRaw = null;

  if (!project) {
    serverKeyRaw = `cavbot_sk_${randomBytes(24).toString("hex")}`;
    const serverKeyHash = sha256Hex(serverKeyRaw);
    const serverKeyLast4 = serverKeyRaw.slice(-4);

    project = await prisma.project.create({
      data: {
        accountId,
        name: "Primary Project",
        slug: "primary",
        serverKeyHash,
        serverKeyLast4,
        isActive: true,
      },
    });
  }

  console.log("BOOTSTRAP_OK");
  console.log("email:", email);
  console.log("userId:", user.id);
  console.log("accountId:", accountId);
  console.log("staffCode:", ownerStaffCode);
  console.log("projectId:", project.id);
  if (serverKeyRaw) console.log("serverKey (SAVE THIS NOW):", serverKeyRaw);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("BOOTSTRAP_FAILED:", e);
  try { await prisma.$disconnect(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});
