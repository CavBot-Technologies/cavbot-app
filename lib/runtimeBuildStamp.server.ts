import fs from "node:fs";
import path from "node:path";

const BUILD_STAMP_MAX_LENGTH = 120;

let cachedBuildStamp: string | null | undefined;

function sanitizeBuildStamp(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, BUILD_STAMP_MAX_LENGTH);
}

function readNextBuildId(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return "";
  }
}

export function resolveRuntimeBuildStamp(): string | null {
  if (typeof cachedBuildStamp !== "undefined") return cachedBuildStamp;

  const raw =
    process.env.NEXT_PUBLIC_CAVBOT_BUILD_ID ||
    process.env.CAVBOT_BUILD_ID ||
    process.env.NEXT_BUILD_ID ||
    process.env.BUILD_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.GITHUB_SHA ||
    process.env.SOURCE_VERSION ||
    readNextBuildId() ||
    process.env.npm_package_version ||
    "";

  const normalized = sanitizeBuildStamp(raw);
  cachedBuildStamp = normalized || null;
  return cachedBuildStamp;
}

