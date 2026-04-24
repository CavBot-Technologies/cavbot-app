// lib/db.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

declare global {
  var __cavbotPrisma: PrismaClient | undefined;
  var __cavbotPgPool: pg.Pool | undefined;
}

function createPgPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 30_000,
  });

  pool.on("error", (error) => {
    console.error("[db] pg pool idle client error", error);
  });

  return pool;
}

function makePrisma() {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("DATABASE_URL is missing");

  const pool = global.__cavbotPgPool || createPgPool(url);

  global.__cavbotPgPool = pool;

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: ["error", "warn"],
  });
}

export const prisma = global.__cavbotPrisma || makePrisma();

if (process.env.NODE_ENV !== "production") {
  global.__cavbotPrisma = prisma;
}
