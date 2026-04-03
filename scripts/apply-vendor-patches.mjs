#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FAST_XML_PARSER_ROOTS = [
  "node_modules/@aws-sdk/core/node_modules/fast-xml-parser/lib",
  ".open-next/server-functions/default/node_modules/@aws-sdk/core/node_modules/fast-xml-parser/lib",
  ".open-next/pages-deploy/server-functions/default/node_modules/@aws-sdk/core/node_modules/fast-xml-parser/lib",
];

const FAST_XML_PARSER_FILES = [
  "fxp.cjs",
  "fxp.min.js",
  "fxparser.min.js",
];

const GENERATED_HANDLER_FILES = [
  ".open-next/server-functions/default/handler.mjs",
  ".open-next/pages-deploy/server-functions/default/handler.mjs",
];

const NEGATIVE_ZERO_PATTERNS = [
  {
    pattern: /0===([A-Za-z_$][\w$]*)\|\|-0===\1/g,
    replacement: "0===$1||Object.is($1,-0)",
  },
  {
    pattern: /([A-Za-z_$][\w$]*)===0\|\|\1===-0/g,
    replacement: "$1===0||Object.is($1,-0)",
  },
];

function patchNegativeZeroComparisons(source) {
  let patched = source;
  for (const { pattern, replacement } of NEGATIVE_ZERO_PATTERNS) {
    patched = patched.replace(pattern, replacement);
  }
  return patched;
}

async function patchFastXmlParser(rootDir) {
  for (const relativeRoot of FAST_XML_PARSER_ROOTS) {
    for (const fileName of FAST_XML_PARSER_FILES) {
      const absolutePath = path.join(rootDir, relativeRoot, fileName);
      let source;
      try {
        source = await readFile(absolutePath, "utf8");
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          continue;
        }
        throw error;
      }
      const patched = patchNegativeZeroComparisons(source);
      if (patched !== source) {
        await writeFile(absolutePath, patched, "utf8");
      }
    }
  }
}

async function patchGeneratedHandlers(rootDir) {
  for (const relativePath of GENERATED_HANDLER_FILES) {
    const absolutePath = path.join(rootDir, relativePath);
    let source;
    try {
      source = await readFile(absolutePath, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    const patched = patchNegativeZeroComparisons(source);
    if (patched !== source) {
      await writeFile(absolutePath, patched, "utf8");
    }
  }
}

export async function applyVendorPatches(rootDir = process.cwd()) {
  await patchFastXmlParser(rootDir);
  await patchGeneratedHandlers(rootDir);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await applyVendorPatches();
}
