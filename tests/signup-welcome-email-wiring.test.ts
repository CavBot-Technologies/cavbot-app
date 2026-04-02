import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SIGNUP_WELCOME_TEMPLATE_ALIAS,
  backfillSignupWelcomeEmailsWithStore,
  buildSignupWelcomeIdempotencyKey,
  resolveSignupWelcomeMailConfig,
  sendSignupWelcomeEmailWithStore,
  type SignupWelcomeStore,
} from "../lib/signupWelcomeEmail.server";

type DeliveryRow = {
  email: string;
  templateRef: string;
  status: "PENDING" | "PROCESSING" | "SENT" | "FAILED";
  attemptCount: number;
  sentAt: Date | null;
  failureReason: string | null;
  processingStartedAt: Date | null;
  processingToken: string | null;
  resendMessageId: string | null;
};

class InMemorySignupWelcomeStore implements SignupWelcomeStore {
  private readonly users = new Map<string, string>();

  private readonly deliveries = new Map<string, DeliveryRow>();

  addUser(userId: string, email: string) {
    this.users.set(userId, email);
  }

  async beginAttempt(args: {
    userId: string;
    email: string;
    templateRef: string;
    staleWindowMs: number;
  }) {
    const existing = this.deliveries.get(args.userId);
    const now = new Date();
    const staleBefore = now.getTime() - args.staleWindowMs;

    if (existing?.sentAt) {
      return {
        shouldSend: false as const,
        reason: "already_sent" as const,
      };
    }

    if (
      existing?.status === "PROCESSING" &&
      existing.processingStartedAt &&
      existing.processingStartedAt.getTime() >= staleBefore
    ) {
      return {
        shouldSend: false as const,
        reason: "in_progress" as const,
      };
    }

    const processingToken = `tok_${args.userId}_${existing?.attemptCount || 0}`;

    this.deliveries.set(args.userId, {
      email: args.email,
      templateRef: args.templateRef,
      status: "PROCESSING",
      attemptCount: (existing?.attemptCount || 0) + 1,
      sentAt: existing?.sentAt || null,
      failureReason: null,
      processingStartedAt: now,
      processingToken,
      resendMessageId: existing?.resendMessageId || null,
    });

    return {
      shouldSend: true as const,
      processingToken,
    };
  }

  async markSent(args: {
    userId: string;
    processingToken: string;
    resendMessageId: string | null;
  }) {
    const existing = this.deliveries.get(args.userId);
    if (!existing || existing.processingToken !== args.processingToken) return;
    existing.status = "SENT";
    existing.sentAt = new Date();
    existing.failureReason = null;
    existing.processingStartedAt = null;
    existing.processingToken = null;
    existing.resendMessageId = args.resendMessageId;
  }

  async markFailed(args: {
    userId: string;
    processingToken: string;
    failureReason: string;
  }) {
    const existing = this.deliveries.get(args.userId);
    if (!existing || existing.processingToken !== args.processingToken) return;
    existing.status = "FAILED";
    existing.failureReason = args.failureReason;
    existing.processingStartedAt = null;
    existing.processingToken = null;
  }

  async listBackfillCandidates(args: {
    limit: number;
    email?: string | null;
    userId?: string | null;
    onlyFailed?: boolean;
    staleWindowMs: number;
  }) {
    const entries = [...this.users.entries()]
      .filter(([userId, email]) => {
        if (args.userId && args.userId !== userId) return false;
        if (args.email && args.email !== email) return false;

        const existing = this.deliveries.get(userId);
        if (existing?.sentAt) return false;
        if (args.onlyFailed && existing?.status !== "FAILED") return false;
        if (
          existing?.status === "PROCESSING" &&
          existing.processingStartedAt &&
          existing.processingStartedAt.getTime() >= Date.now() - args.staleWindowMs
        ) {
          return false;
        }
        return true;
      })
      .slice(0, args.limit)
      .map(([userId, email]) => ({ userId, email }));

    return entries;
  }
}

test("signup welcome config uses the dedicated key and hosted template alias by default", () => {
  const config = resolveSignupWelcomeMailConfig({
    RESEND_SIGNUP_API_KEY: "signup_key",
    RESEND_API_KEY: "security_key",
  });

  assert.equal(config.apiKey, "signup_key");
  assert.equal(config.templateRef, DEFAULT_SIGNUP_WELCOME_TEMPLATE_ALIAS);
});

test("signup welcome config supports a template id when alias is not set", () => {
  const config = resolveSignupWelcomeMailConfig({
    RESEND_SIGNUP_API_KEY: "signup_key",
    RESEND_SIGNUP_TEMPLATE_ID: "tmpl_123",
  });

  assert.equal(config.templateRef, "tmpl_123");
});

test("signup welcome send is one-time and uses a stable idempotency key", async () => {
  const store = new InMemorySignupWelcomeStore();
  store.addUser("user_1", "person@example.com");

  const sends: Array<{ templateRef: string; idempotencyKey: string }> = [];
  const config = resolveSignupWelcomeMailConfig({
    RESEND_SIGNUP_API_KEY: "signup_key",
    RESEND_SIGNUP_TEMPLATE_ALIAS: "cavbot-sign-up",
  });

  const transport = async (args: {
    config: ReturnType<typeof resolveSignupWelcomeMailConfig>;
    idempotencyKey: string;
    recipient: {
      userId: string;
      email: string;
      source: string;
    };
  }) => {
    sends.push({
      templateRef: args.config.templateRef,
      idempotencyKey: args.idempotencyKey,
    });
    return {
      ok: true as const,
      resendMessageId: "email_1",
    };
  };

  const first = await sendSignupWelcomeEmailWithStore(
    store,
    {
      userId: "user_1",
      email: "person@example.com",
      source: "register",
    },
    { config, transport },
  );

  const second = await sendSignupWelcomeEmailWithStore(
    store,
    {
      userId: "user_1",
      email: "person@example.com",
      source: "register",
    },
    { config, transport },
  );

  assert.equal(first.ok, true);
  assert.equal(first.status, "sent");
  assert.equal(second.ok, true);
  assert.equal(second.status, "skipped");
  assert.equal(second.reason, "already_sent");
  assert.equal(sends.length, 1);
  assert.equal(sends[0]?.templateRef, "cavbot-sign-up");
  assert.equal(sends[0]?.idempotencyKey, buildSignupWelcomeIdempotencyKey("user_1"));
});

test("failed signup welcome sends can be backfilled once and remain idempotent", async () => {
  const store = new InMemorySignupWelcomeStore();
  store.addUser("user_2", "retry@example.com");

  const config = resolveSignupWelcomeMailConfig({
    RESEND_SIGNUP_API_KEY: "signup_key",
  });

  let attempts = 0;
  const transport = async () => {
    attempts += 1;
    if (attempts === 1) {
      return {
        ok: false as const,
        error: "provider_down",
      };
    }
    return {
      ok: true as const,
      resendMessageId: "email_retry",
    };
  };

  const first = await sendSignupWelcomeEmailWithStore(
    store,
    {
      userId: "user_2",
      email: "retry@example.com",
      source: "register",
    },
    { config, transport },
  );

  const backfill = await backfillSignupWelcomeEmailsWithStore(
    store,
    { limit: 10 },
    { config, transport },
  );

  const secondBackfill = await backfillSignupWelcomeEmailsWithStore(
    store,
    { limit: 10 },
    { config, transport },
  );

  assert.equal(first.ok, false);
  assert.equal(first.status, "failed");
  assert.equal(backfill.sent, 1);
  assert.equal(backfill.failed, 0);
  assert.equal(secondBackfill.examined, 0);
});

test("register, oauth callbacks, and the backfill runner are wired to the dedicated signup welcome flow", () => {
  const root = process.cwd();
  const registerRoute = fs.readFileSync(path.join(root, "app/api/auth/register/route.ts"), "utf8");
  const googleRoute = fs.readFileSync(path.join(root, "app/api/auth/oauth/google/callback/route.ts"), "utf8");
  const githubRoute = fs.readFileSync(path.join(root, "app/api/auth/oauth/github/callback/route.ts"), "utf8");
  const backfillScript = fs.readFileSync(path.join(root, "scripts/backfill-signup-welcome-email.ts"), "utf8");

  assert.equal(registerRoute.includes('sendSignupWelcomeEmail({'), true);
  assert.equal(registerRoute.includes('source: "register"'), true);
  assert.equal(registerRoute.includes('subject: "Welcome to CavBot"'), false);

  assert.equal(googleRoute.includes('source: "google_oauth"'), true);
  assert.equal(googleRoute.includes("createdUser"), true);

  assert.equal(githubRoute.includes('source: "github_oauth"'), true);
  assert.equal(githubRoute.includes("createdUser"), true);

  assert.equal(backfillScript.includes("backfillSignupWelcomeEmails"), true);
  assert.equal(backfillScript.includes('"dry-run"'), true);
});
