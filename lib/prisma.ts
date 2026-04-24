// lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { createLoggedPgPool } from "@/lib/pgPool.server";

const globalForPrisma = globalThis as unknown as {
  __cavbot_prisma__?: PrismaClient;
  __cavbot_pg_pool__?: pg.Pool;
};

const DEV_PRISMA_MODEL_PROP = /^[a-z][A-Za-z0-9_]*$/;

function createPgPool(connectionString: string) {
  return createLoggedPgPool(connectionString, "prisma");
}

function getPool() {
  if (globalForPrisma.__cavbot_pg_pool__) return globalForPrisma.__cavbot_pg_pool__;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is missing.");

  const pool = createPgPool(url);
  globalForPrisma.__cavbot_pg_pool__ = pool;

  return pool;
}

function createClient() {
  const adapter = new PrismaPg(getPool());
  return new PrismaClient({
    adapter,
    log: ["error", "warn"],
  });
}

function replaceCachedPrismaClient() {
  const nextClient = createClient();
  const previousClient = globalForPrisma.__cavbot_prisma__;
  globalForPrisma.__cavbot_prisma__ = nextClient;

  if (previousClient && previousClient !== nextClient) {
    void previousClient.$disconnect().catch(() => null);
  }

  return nextClient;
}

function getOrCreatePrismaClient() {
  if (globalForPrisma.__cavbot_prisma__) return globalForPrisma.__cavbot_prisma__;

  const client = createClient();
  globalForPrisma.__cavbot_prisma__ = client;
  return client;
}

export function getPrismaClient() {
  return getOrCreatePrismaClient();
}

function shouldRefreshDevClientForProp(client: PrismaClient, prop: PropertyKey) {
  if (process.env.NODE_ENV === "production") return false;
  if (!globalForPrisma.__cavbot_prisma__) return false;
  if (typeof prop !== "string" || prop.startsWith("$")) return false;
  if (!DEV_PRISMA_MODEL_PROP.test(prop)) return false;
  return !Reflect.has(client as object, prop);
}

function getLivePrismaClient(prop: PropertyKey) {
  const client = getOrCreatePrismaClient();
  return shouldRefreshDevClientForProp(client, prop) ? replaceCachedPrismaClient() : client;
}

// Lazily initialize Prisma so importing modules (for example /auth page bundles)
// doesn't crash worker startup when DB env is absent in a given environment.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getLivePrismaClient(prop);
    const value = Reflect.get(client as object, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as PrismaClient;
