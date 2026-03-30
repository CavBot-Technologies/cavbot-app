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

function getOrCreatePrismaClient() {
  if (globalForPrisma.__cavbot_prisma__) return globalForPrisma.__cavbot_prisma__;

  const client = createClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__cavbot_prisma__ = client;
  }
  return client;
}

export function getPrismaClient() {
  return getOrCreatePrismaClient();
}

// Lazily initialize Prisma so importing modules (for example /auth page bundles)
// doesn't crash worker startup when DB env is absent in a given environment.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getOrCreatePrismaClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as PrismaClient;
