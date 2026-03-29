// prisma.config.ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";


export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Use DIRECT_URL (non-pooled) for migrations/DDL when available.
    // DATABASE_URL may point to a pooled/proxied endpoint that doesn't support migrations.
    url: env("DIRECT_URL") || env("DATABASE_URL"),
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
