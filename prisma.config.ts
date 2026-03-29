// prisma.config.ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

const directUrl = String(process.env.DIRECT_URL || "").trim();
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const fallbackUrl = "postgresql://cavbot:placeholder@127.0.0.1:5432/cavbot";
const resolvedDatasourceUrl = directUrl || databaseUrl || fallbackUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Use DIRECT_URL (non-pooled) for migrations/DDL when available.
    // DATABASE_URL may point to a pooled/proxied endpoint that doesn't support migrations.
    // In CI build-only contexts, allow a safe placeholder URL so `prisma generate` can run.
    url: resolvedDatasourceUrl,
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
