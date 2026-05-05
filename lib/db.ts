// lib/db.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { createLoggedPgPool } from "@/lib/pgPool.server";

declare global {
  var __cavbotPrisma: PrismaClient | undefined;
  var __cavbotPgPool: pg.Pool | undefined;
}

function createPgPool(connectionString: string) {
  return createLoggedPgPool(connectionString, "db");
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

global.__cavbotPrisma = prisma;
