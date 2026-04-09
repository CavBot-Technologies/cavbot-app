import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("billing ancillary routes avoid Prisma runtime imports on request paths", () => {
  const routePaths = [
    "app/api/billing/summary/route.ts",
    "app/api/billing/payment-method/route.ts",
    "app/api/billing/invoices/route.ts",
    "app/api/billing/invoices/[invoiceId]/download/route.ts",
    "app/api/billing/checkout/route.ts",
    "app/api/billing/checkout-embedded/route.ts",
    "app/api/stripe/checkout/route.ts",
    "app/api/stripe/portal/route.ts",
    "app/api/stripe/setup-intent/route.ts",
  ];

  for (const relPath of routePaths) {
    const source = read(relPath);
    assert.equal(
      source.includes('from "@/lib/prisma"'),
      false,
      `${relPath} should not import the Prisma runtime client`,
    );
    assert.equal(
      source.includes('from "@/lib/billingRuntime.server"') || source.includes('from "@/lib/authDb"'),
      true,
      `${relPath} should use runtime-safe billing/auth helpers`,
    );
  }
});

test("billing account resolution uses auth-db membership and account lookup only", () => {
  const source = read("lib/billingAccount.server.ts");

  assert.equal(source.includes('from "@/lib/prisma"'), false);
  assert.equal(source.includes("findAccountById"), true);
  assert.equal(source.includes("findMembershipsForUser"), true);
  assert.equal(source.includes("findSessionMembership"), true);
});

test("billing runtime store reads account state, subscriptions, usage counts, and invoice audit events through the auth pool", () => {
  const source = read("lib/billingRuntime.server.ts");

  assert.equal(source.includes("getAuthPool"), true);
  assert.equal(source.includes("inferBillingCycleFromSubscription"), true);
  assert.equal(source.includes("normalizeBillingCycleValue"), true);
  assert.equal(source.includes("planFromPriceId"), true);
  assert.equal(source.includes('FROM "Account"'), true);
  assert.equal(source.includes('UPDATE "Account"'), true);
  assert.equal(source.includes('FROM "Subscription"'), true);
  assert.equal(source.includes('FROM "Membership"'), true);
  assert.equal(source.includes('FROM "Invite"'), true);
  assert.equal(source.includes('FROM "Site" AS s'), true);
  assert.equal(source.includes('FROM "AuditLog"'), true);
  assert.equal(source.includes("isBillingRuntimeUnavailableError"), true);
  assert.equal(source.includes('COALESCE("metaJson"->>\'billing_event\', \'\') <> \'\'') || source.includes('COALESCE("metaJson"->>\'billing_event\','), true);
});

test("billing summary source-of-truth path avoids Prisma runtime reads and uses runtime-safe helpers", () => {
  const routeSource = read("app/api/billing/summary/route.ts");
  const planSource = read("lib/billingPlan.server.ts");

  assert.equal(routeSource.includes('from "@/lib/prisma"'), false);
  assert.equal(routeSource.includes("readBillingAccount"), true);
  assert.equal(routeSource.includes("readLatestBillingSubscription"), true);
  assert.equal(routeSource.includes("readBillingUsageMetrics"), true);
  assert.equal(routeSource.includes("normalizeBillingCycleValue"), true);

  assert.equal(planSource.includes('from "@/lib/prisma"'), false);
  assert.equal(planSource.includes("getAuthPool"), true);
  assert.equal(planSource.includes('FROM "Account"'), true);
  assert.equal(planSource.includes('UPDATE "Account"'), true);
});

test("stripe client is lazy-loaded so billing route modules do not initialize the Stripe SDK at import time", () => {
  const source = read("lib/stripeClient.ts");

  assert.equal(source.includes('import Stripe from "stripe";'), false);
  assert.equal(source.includes('import type Stripe from "stripe";'), true);
  assert.equal(source.includes('await import("stripe")'), true);
  assert.equal(source.includes("stripeInstancePromise"), true);
});

test("billing read routes degrade ancillary data instead of surfacing 500s on runtime failures", () => {
  const paymentMethodSource = read("app/api/billing/payment-method/route.ts");
  const invoicesSource = read("app/api/billing/invoices/route.ts");
  const downloadSource = read("app/api/billing/invoices/[invoiceId]/download/route.ts");

  assert.equal(paymentMethodSource.includes("isBillingRuntimeUnavailableError"), true);
  assert.equal(paymentMethodSource.includes("return json(pmEmpty(), 200);"), true);
  assert.equal(invoicesSource.includes("degraded: true"), true);
  assert.equal(downloadSource.includes('error: "SERVICE_UNAVAILABLE"'), true);
});
