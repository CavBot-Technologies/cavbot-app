// lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as {
  __cavbot_prisma__?: PrismaClient;
  __cavbot_pg_pool__?: pg.Pool;
};

function getPool() {
  if (globalForPrisma.__cavbot_pg_pool__) return globalForPrisma.__cavbot_pg_pool__;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is missing.");

  const pool = new pg.Pool({ connectionString: url });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__cavbot_pg_pool__ = pool;
  }

  return pool;
}

function createClient() {
  const adapter = new PrismaPg(getPool());
  return new PrismaClient({
    adapter,
    log: ["error", "warn"],
  });
}

export const prisma = globalForPrisma.__cavbot_prisma__ ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__cavbot_prisma__ = prisma;
}
