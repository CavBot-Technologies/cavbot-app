// lib/prisma.ts
import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

// Cloudflare Next-on-Pages exposes env via getRequestContext()
let _getRequestContext: undefined | (() => any);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  _getRequestContext = require("@opennextjs/cloudflare").getRequestContext;
} catch {
  _getRequestContext = undefined;
}

type D1DatabaseLike = any;

function getD1Binding(): D1DatabaseLike | null {
  try {
    if (!_getRequestContext) return null;
    const ctx = _getRequestContext();
    const env = ctx?.env;
    return env?.DB || null; // Binding name: DB
  } catch {
    return null;
  }
}

function createClient(): PrismaClient {
  const d1 = getD1Binding();

  // If DB binding exists, we are in Cloudflare D1 runtime.
  if (d1) {
    return new PrismaClient({
      adapter: new PrismaD1(d1),
      log: ["error", "warn"],
    });
  }

  // Otherwise, default Node/local sqlite (DATABASE_URL="file:./dev.db")
  return new PrismaClient({ log: ["error", "warn"] });
}

// Global cache to prevent dev reload spawning many clients
const globalForPrisma = globalThis as unknown as { __cavbot_prisma__?: PrismaClient };

function getClient(): PrismaClient {
  const d1 = getD1Binding();

  // Edge/D1: create per runtime isolate (safe)
  if (d1) return createClient();

  // Node/local: reuse global singleton
  if (!globalForPrisma.__cavbot_prisma__) {
    globalForPrisma.__cavbot_prisma__ = createClient();
  }
  return globalForPrisma.__cavbot_prisma__!;
}

// Keep your existing import style working:
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = getClient() as any;
    return c[prop];
  },
}) as PrismaClient;