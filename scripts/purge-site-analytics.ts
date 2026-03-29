#!/usr/bin/env tsx
import { runSitePurgeJob } from "@/lib/siteDeletion.server";

async function main() {
  const purged = await runSitePurgeJob();
  console.log(`[site-purge] processed ${purged.length} deletions`, purged);
}

main().catch((error) => {
  console.error("[site-purge] job failed", error);
  process.exit(1);
});
