import { config as loadEnv } from "dotenv";
import { backfillSignupWelcomeEmails } from "../lib/signupWelcomeEmail.server";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env.production.local", override: true });

type ParsedArgs = {
  limit: number;
  dryRun: boolean;
  onlyFailed: boolean;
  email: string | null;
  userId: string | null;
};

function readFlag(argv: string[], name: string) {
  const exact = `--${name}`;
  const prefix = `--${name}=`;
  const direct = argv.find((arg) => arg === exact || arg.startsWith(prefix));
  if (!direct) return null;
  if (direct === exact) return "true";
  return direct.slice(prefix.length);
}

function readValue(argv: string[], name: string) {
  const exact = `--${name}`;
  const exactIndex = argv.findIndex((arg) => arg === exact);
  if (exactIndex >= 0) {
    const next = argv[exactIndex + 1];
    return next && !next.startsWith("--") ? next : "";
  }
  return readFlag(argv, name);
}

function parseArgs(argv: string[]): ParsedArgs {
  const limitRaw = readValue(argv, "limit");
  const limit = Number.parseInt(String(limitRaw || "100"), 10);

  return {
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(limit, 500)) : 100,
    dryRun: readFlag(argv, "dry-run") !== null,
    onlyFailed: readFlag(argv, "only-failed") !== null,
    email: (readValue(argv, "email") || "").trim().toLowerCase() || null,
    userId: (readValue(argv, "user-id") || "").trim() || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await backfillSignupWelcomeEmails(args);

  console.log(JSON.stringify(result, null, 2));

  if (!args.dryRun && result.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[signup][welcome][backfill] ${reason}`);
  process.exit(1);
});
