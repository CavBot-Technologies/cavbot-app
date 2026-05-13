// lib/db.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

declare global {
  var __cavbotPrisma: PrismaClient | undefined;
  var __cavbotPgPool: pg.Pool | undefined;
}

function makePrisma() {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("DATABASE_URL is missing");

  const pool =
    global.__cavbotPgPool ||
    new pg.Pool({
      connectionString: url,
      max: Number(process.env.CAVBOT_PG_POOL_MAX || 3),
      idleTimeoutMillis: Number(process.env.CAVBOT_PG_IDLE_TIMEOUT_MS || 10_000),
      connectionTimeoutMillis: Number(process.env.CAVBOT_PG_CONNECT_TIMEOUT_MS || 5_000),
    });

  global.__cavbotPgPool = pool;

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: ["error", "warn"],
  });
}

export const prisma = global.__cavbotPrisma || makePrisma();

global.__cavbotPrisma = prisma;
