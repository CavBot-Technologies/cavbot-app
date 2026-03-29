#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node scripts/check-no-localstorage.mjs <file> [file...]");
  process.exit(2);
}

const browserStorePattern = new RegExp(
  `\\b(?:window\\.)?(?:${["local", "Storage"].join("")}|${["session", "Storage"].join("")})\\b`
);

let failed = false;
for (const file of files) {
  const abs = path.resolve(file);
  let content = "";
  try {
    content = fs.readFileSync(abs, "utf8");
  } catch {
    console.error(`Missing file: ${file}`);
    failed = true;
    continue;
  }

  if (browserStorePattern.test(content)) {
    console.error(`Forbidden direct browser store usage found in ${file}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("No direct browser store references found in checked files.");
