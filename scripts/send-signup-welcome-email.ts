import { config as loadEnv } from "dotenv";
import { sendAdHocSignupWelcomeEmail } from "../lib/signupWelcomeEmail.server";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env.production.local", override: true });

function readArg(argv: string[], name: string) {
  const exact = `--${name}`;
  const prefix = `--${name}=`;
  const exactIndex = argv.findIndex((arg) => arg === exact);
  if (exactIndex >= 0) {
    const next = argv[exactIndex + 1];
    return next && !next.startsWith("--") ? next : "";
  }
  const direct = argv.find((arg) => arg.startsWith(prefix));
  return direct ? direct.slice(prefix.length) : "";
}

async function main() {
  const to = String(readArg(process.argv.slice(2), "to") || "").trim().toLowerCase();
  if (!to) {
    throw new Error("Missing --to email.");
  }

  const result = await sendAdHocSignupWelcomeEmail(to);
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[signup][welcome][test] ${reason}`);
  process.exit(1);
});
