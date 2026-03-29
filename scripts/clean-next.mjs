// scripts/clean-next.mjs
//
// Dev helper: wipes `.next/` so Next.js can rebuild cleanly.
// Use when you hit missing chunk / vendor-chunk errors in dev.

import fs from "node:fs";
import path from "node:path";

const nextDir = path.join(process.cwd(), ".next");

try {
  fs.rmSync(nextDir, { recursive: true, force: true });
  console.log("[clean-next] removed .next");
} catch (err) {
  console.error("[clean-next] failed to remove .next:", err);
  process.exit(1);
}
